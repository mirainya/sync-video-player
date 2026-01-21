const axios = require('axios');
const cheerio = require('cheerio');
const { ParseFailedError, TimeoutError, extractVideoUrls, selectBestVideoUrl } = require('./utils');

/**
 * Parse video URL from page using Cheerio (fast HTML parsing)
 * Works well for static HTML pages
 */
async function parseWithCheerio(url) {
  const startTime = Date.now();

  try {
    // Fetch HTML with timeout
    const response = await axios.get(url, {
      timeout: 5000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const html = response.data;
    const $ = cheerio.load(html);

    const videoUrls = new Set();

    // 1. Check <video> and <source> tags
    $('video, source').each((i, elem) => {
      const src = $(elem).attr('src') || $(elem).attr('data-src') || $(elem).attr('data-video-url');
      if (src) {
        videoUrls.add(src);
      }
    });

    // 2. Check data attributes that might contain video URLs
    $('[data-src], [data-video-url], [data-video], [data-url]').each((i, elem) => {
      const src = $(elem).attr('data-src') || $(elem).attr('data-video-url') ||
                  $(elem).attr('data-video') || $(elem).attr('data-url');
      if (src && (src.includes('.m3u8') || src.includes('.mp4'))) {
        videoUrls.add(src);
      }
    });

    // 3. Search in <script> tags for video URLs
    $('script').each((i, elem) => {
      const scriptContent = $(elem).html();
      if (scriptContent) {
        const urls = extractVideoUrls(scriptContent);
        urls.forEach(url => videoUrls.add(url));
      }
    });

    // 4. Search in inline JavaScript (onclick, etc.)
    $('[onclick], [onload]').each((i, elem) => {
      const onclick = $(elem).attr('onclick') || $(elem).attr('onload');
      if (onclick) {
        const urls = extractVideoUrls(onclick);
        urls.forEach(url => videoUrls.add(url));
      }
    });

    // 5. Search entire HTML for video URLs as fallback
    const allUrls = extractVideoUrls(html);
    allUrls.forEach(url => videoUrls.add(url));

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
      method: 'cheerio',
      parseTime
    };

  } catch (error) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      throw new TimeoutError('页面加载超时');
    }
    if (error instanceof ParseFailedError || error instanceof TimeoutError) {
      throw error;
    }
    throw new ParseFailedError(`Cheerio解析失败: ${error.message}`);
  }
}

module.exports = { parseWithCheerio };
