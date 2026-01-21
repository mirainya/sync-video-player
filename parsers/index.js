const { parseWithCheerio } = require('./cheerio-parser');
const { parseWithPuppeteer, closeBrowser } = require('./puppeteer-parser');
const { InvalidUrlError, isValidUrl, isDirectVideoUrl } = require('./utils');

/**
 * Main video parser orchestrator
 * Supports auto-detection, cheerio, and puppeteer methods
 */
async function parseVideo(url, method = 'auto') {
  // Validate URL
  if (!url || typeof url !== 'string') {
    throw new InvalidUrlError('请提供有效的URL');
  }

  const trimmedUrl = url.trim();

  if (!isValidUrl(trimmedUrl)) {
    throw new InvalidUrlError('URL格式无效');
  }

  // Skip parsing if already a direct video URL
  if (isDirectVideoUrl(trimmedUrl)) {
    return {
      success: true,
      videoUrl: trimmedUrl,
      method: 'direct',
      parseTime: 0
    };
  }

  // Parse based on method
  if (method === 'auto') {
    // Try Cheerio first (fast), fallback to Puppeteer (reliable)
    try {
      console.log(`[Parser] Trying Cheerio for: ${trimmedUrl}`);
      const result = await parseWithCheerio(trimmedUrl);
      console.log(`[Parser] Cheerio succeeded: ${result.videoUrl}`);
      return result;
    } catch (cheerioError) {
      console.log(`[Parser] Cheerio failed: ${cheerioError.message}, trying Puppeteer...`);
      try {
        const result = await parseWithPuppeteer(trimmedUrl);
        console.log(`[Parser] Puppeteer succeeded: ${result.videoUrl}`);
        return result;
      } catch (puppeteerError) {
        console.error(`[Parser] Both methods failed. Cheerio: ${cheerioError.message}, Puppeteer: ${puppeteerError.message}`);
        throw puppeteerError; // Throw the last error
      }
    }
  } else if (method === 'cheerio') {
    console.log(`[Parser] Using Cheerio for: ${trimmedUrl}`);
    return await parseWithCheerio(trimmedUrl);
  } else if (method === 'puppeteer') {
    console.log(`[Parser] Using Puppeteer for: ${trimmedUrl}`);
    return await parseWithPuppeteer(trimmedUrl);
  } else {
    throw new InvalidUrlError(`不支持的解析方法: ${method}`);
  }
}

module.exports = {
  parseVideo,
  closeBrowser
};
