// URL validation and utility functions

class InvalidUrlError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidUrlError';
  }
}

class ParseFailedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ParseFailedError';
  }
}

class TimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Validate if a string is a valid URL
 */
function isValidUrl(urlString) {
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

/**
 * Check if URL is a direct video URL
 */
function isDirectVideoUrl(url) {
  const videoExtensions = ['.m3u8', '.mp4', '.webm', '.ogg', '.avi', '.mov', '.flv', '.mkv'];
  const lowerUrl = url.toLowerCase();
  return videoExtensions.some(ext => lowerUrl.includes(ext));
}

/**
 * Extract video URLs from text using regex patterns
 */
function extractVideoUrls(text) {
  const patterns = [
    // M3U8 URLs
    /https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi,
    // MP4 URLs
    /https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/gi,
    // Other video formats
    /https?:\/\/[^\s"'<>]+\.(webm|ogg|avi|mov|flv|mkv)[^\s"'<>]*/gi
  ];

  const urls = new Set();

  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) {
      matches.forEach(url => {
        // Clean up the URL (remove trailing quotes, brackets, etc.)
        const cleaned = url.replace(/['")\]}>]+$/, '');
        if (isValidUrl(cleaned)) {
          urls.add(cleaned);
        }
      });
    }
  }

  return Array.from(urls);
}

/**
 * Select the best video URL from a list
 * Prefers: m3u8 > mp4 > others, and longer URLs (usually higher quality)
 */
function selectBestVideoUrl(urls) {
  if (!urls || urls.length === 0) return null;

  // Sort by preference
  const sorted = urls.sort((a, b) => {
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();

    // Prefer m3u8
    if (aLower.includes('.m3u8') && !bLower.includes('.m3u8')) return -1;
    if (!aLower.includes('.m3u8') && bLower.includes('.m3u8')) return 1;

    // Then prefer mp4
    if (aLower.includes('.mp4') && !bLower.includes('.mp4')) return -1;
    if (!aLower.includes('.mp4') && bLower.includes('.mp4')) return 1;

    // Finally prefer longer URLs (often indicate higher quality)
    return b.length - a.length;
  });

  return sorted[0];
}

module.exports = {
  InvalidUrlError,
  ParseFailedError,
  TimeoutError,
  isValidUrl,
  isDirectVideoUrl,
  extractVideoUrls,
  selectBestVideoUrl
};
