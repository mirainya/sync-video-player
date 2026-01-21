const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { ParseFailedError, TimeoutError, selectBestVideoUrl } = require('./utils');

// Add stealth plugin to bypass anti-bot detection
puppeteer.use(StealthPlugin());

// Keep browser instance alive for better performance
let browserInstance = null;
let activePagesCount = 0;
const MAX_CONCURRENT_PAGES = 3;

/**
 * Get or create browser instance
 */
async function getBrowser() {
  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920x1080'
      ]
    });
  }
  return browserInstance;
}

/**
 * Parse video URL from page using Puppeteer (browser automation)
 * Works well for JavaScript-heavy dynamic pages
 */
async function parseWithPuppeteer(url) {
  const startTime = Date.now();

  // Check concurrent limit
  if (activePagesCount >= MAX_CONCURRENT_PAGES) {
    throw new ParseFailedError('服务器繁忙，请稍后重试');
  }

  let page = null;

  try {
    activePagesCount++;
    const browser = await getBrowser();
    page = await browser.newPage();

    // Set viewport and user agent
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Block unnecessary resources to speed up loading
    await page.setRequestInterception(true);
    const videoUrls = new Set();

    page.on('request', (request) => {
      const resourceType = request.resourceType();
      const requestUrl = request.url();

      // Block images, fonts, stylesheets to speed up
      if (['image', 'font', 'stylesheet'].includes(resourceType)) {
        request.abort();
      } else {
        request.continue();
      }
    });

    // Intercept network responses to capture video URLs
    page.on('response', async (response) => {
      const responseUrl = response.url();
      const contentType = response.headers()['content-type'] || '';

      // Capture video URLs from network requests
      if (
        responseUrl.includes('.m3u8') ||
        responseUrl.includes('.mp4') ||
        responseUrl.includes('.webm') ||
        contentType.includes('video') ||
        contentType.includes('application/vnd.apple.mpegurl') ||
        contentType.includes('application/x-mpegURL')
      ) {
        videoUrls.add(responseUrl);
      }
    });

    // Navigate to page with timeout
    try {
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 15000
      });
    } catch (error) {
      // If navigation times out, continue anyway - we might have captured URLs
      if (!error.message.includes('timeout') && !error.message.includes('Navigation')) {
        throw error;
      }
    }

    // Wait a bit for any delayed video loading
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Fallback: Extract video URLs from DOM
    const domVideoUrls = await page.evaluate(() => {
      const urls = [];

      // Check ArtPlayer instances (common video player)
      try {
        // Check global ArtPlayer instances
        if (window.art && window.art.option && window.art.option.url) {
          urls.push(window.art.option.url);
        }
        if (window.player && window.player.option && window.player.option.url) {
          urls.push(window.player.option.url);
        }
        // Check for ArtPlayer in common variable names
        ['artplayer', 'player', 'videoPlayer', 'art'].forEach(name => {
          if (window[name] && window[name].option) {
            if (window[name].option.url) urls.push(window[name].option.url);
            if (window[name].option.video && window[name].option.video.url) {
              urls.push(window[name].option.video.url);
            }
          }
        });
      } catch (e) {
        console.log('ArtPlayer check failed:', e);
      }

      // Check video and source elements
      document.querySelectorAll('video, source').forEach(elem => {
        const src = elem.src || elem.getAttribute('src') ||
                    elem.getAttribute('data-src') ||
                    elem.getAttribute('data-video-url');
        if (src) urls.push(src);
      });

      // Check data attributes
      document.querySelectorAll('[data-src], [data-video-url], [data-video], [data-url]').forEach(elem => {
        const src = elem.getAttribute('data-src') ||
                    elem.getAttribute('data-video-url') ||
                    elem.getAttribute('data-video') ||
                    elem.getAttribute('data-url');
        if (src && (src.includes('.m3u8') || src.includes('.mp4'))) {
          urls.push(src);
        }
      });

      // Search all script tags for video URLs
      document.querySelectorAll('script').forEach(script => {
        const content = script.textContent || script.innerHTML;
        if (content) {
          // Look for m3u8 URLs in scripts
          const m3u8Matches = content.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/gi);
          if (m3u8Matches) {
            m3u8Matches.forEach(url => urls.push(url.replace(/['")\]}>]+$/, '')));
          }
          // Look for mp4 URLs in scripts
          const mp4Matches = content.match(/https?:\/\/[^\s"']+\.mp4[^\s"']*/gi);
          if (mp4Matches) {
            mp4Matches.forEach(url => urls.push(url.replace(/['")\]}>]+$/, '')));
          }
        }
      });

      return urls;
    });

    domVideoUrls.forEach(url => videoUrls.add(url));

    // Convert relative URLs to absolute
    const absoluteUrls = Array.from(videoUrls).map(videoUrl => {
      try {
        return new URL(videoUrl, url).href;
      } catch (e) {
        return videoUrl;
      }
    }).filter(videoUrl => videoUrl.startsWith('http'));

    if (absoluteUrls.length === 0) {
      throw new ParseFailedError('未找到视频链接');
    }

    const bestUrl = selectBestVideoUrl(absoluteUrls);
    const parseTime = Date.now() - startTime;

    return {
      success: true,
      videoUrl: bestUrl,
      method: 'puppeteer',
      parseTime
    };

  } catch (error) {
    if (error.message.includes('timeout') || error.message.includes('Navigation timeout')) {
      throw new TimeoutError('页面加载超时');
    }
    if (error instanceof ParseFailedError || error instanceof TimeoutError) {
      throw error;
    }
    throw new ParseFailedError(`Puppeteer解析失败: ${error.message}`);
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
    activePagesCount--;
  }
}

/**
 * Close browser instance (call on server shutdown)
 */
async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

module.exports = { parseWithPuppeteer, closeBrowser };
