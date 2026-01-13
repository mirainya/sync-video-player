const express = require('express');
const path = require('path');
const app = express();
const PORT = 3000;

// 设置静态文件目录
app.use(express.static(path.join(__dirname, 'public')));

// 主页路由
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 提供视频文件服务（假设视频放在videos目录下）
app.use('/videos', express.static(path.join(__dirname, 'videos')));

app.listen(PORT, () => {
  console.log(`HTTP服务器启动在端口 ${PORT}`);
  console.log(`访问 http://localhost:${PORT} 来使用视频播放器`);
});