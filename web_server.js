const express = require('express');
const path = require('path');
const { parseVideo, closeBrowser } = require('./parsers');

const app = express();
const PORT = 3000;

// 解析JSON请求体
app.use(express.json());

// 设置静态文件目录
app.use(express.static(path.join(__dirname, 'public')));

// 视频解析API
app.post('/api/parse-video', async (req, res) => {
  try {
    const { url, method = 'auto' } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: '请提供视频URL'
      });
    }

    console.log(`[API] Parse request: ${url} (method: ${method})`);
    const result = await parseVideo(url, method);
    console.log(`[API] Parse success: ${result.videoUrl}`);

    res.json(result);

  } catch (error) {
    console.error('[API] Parse error:', error);

    const statusCode = error.name === 'InvalidUrlError' ? 400 : 500;
    res.status(statusCode).json({
      success: false,
      error: error.message
    });
  }
});

// 主页路由
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 提供视频文件服务（假设视频放在videos目录下）
app.use('/videos', express.static(path.join(__dirname, 'videos')));

const server = app.listen(PORT, () => {
  console.log(`HTTP服务器启动在端口 ${PORT}`);
  console.log(`访问 http://localhost:${PORT} 来使用视频播放器`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n正在关闭服务器...');
  await closeBrowser();
  server.close(() => {
    console.log('服务器已关闭');
    process.exit(0);
  });
});

process.on('SIGTERM', async () => {
  console.log('\n正在关闭服务器...');
  await closeBrowser();
  server.close(() => {
    console.log('服务器已关闭');
    process.exit(0);
  });
});