# SyncPlayer - 多人同步视频播放器

一个基于 WebSocket 的多人实时同步视频播放器，支持弹幕、聊天室等互动功能。

## 功能特性

### 视频同步
- 实时同步播放/暂停状态
- 同步播放进度（时间差超过2秒自动校正）
- 同步播放速度调节
- 支持本地视频文件和 URL 视频

### 弹幕系统
- 实时弹幕发送和接收
- 弹幕颜色自定义
- 弹幕大小可选（小/中/大）
- 10轨道弹幕系统，智能分配位置避免重叠
- 弹幕开关控制

### 聊天室
- 实时文字聊天
- 在线用户列表显示
- 弹幕消息同步显示到聊天室
- 用户加入/离开/改名通知

### 操作记录
- 记录所有用户的播放操作
- 显示操作时间和用户名

## 项目结构

```
player/
├── server.js           # WebSocket 服务器 (端口 3001)
├── web_server.js       # HTTP 静态文件服务器 (端口 3000)
├── package.json        # 项目配置和依赖
├── public/
│   ├── index.html      # 主页面 (HTML + CSS)
│   └── script.js       # 客户端逻辑
└── videos/             # 视频文件目录
    └── sample.mp4      # 示例视频
```

## 技术栈

- **后端**: Node.js + Express + ws (WebSocket)
- **前端**: 原生 HTML/CSS/JavaScript
- **通信**: WebSocket 双向实时通信

## 快速开始

### 环境要求

- Node.js >= 14.0.0
- npm >= 6.0.0

### 安装

```bash
# 克隆仓库
git clone https://github.com/your-username/sync-player.git
cd sync-player

# 安装依赖
npm install
```

### 启动

```bash
# 同时启动 WebSocket 服务器和 Web 服务器（推荐）
npm start

# 或者分别启动
npm run server  # 启动 WebSocket 服务器 (端口 3001)
npm run web     # 启动 Web 服务器 (端口 3000)

# 开发模式
npm run dev
```

### 访问

打开浏览器访问 `http://localhost:3000`

## 使用说明

### 加载视频

1. **本地文件**: 点击"选择文件"按钮，选择本地视频文件
2. **URL 加载**: 在输入框输入视频 URL，点击"加载视频"
3. **服务器视频**: 将视频放入 `videos/` 目录，输入 `/videos/文件名.mp4`

### 多人同步

1. 所有用户访问同一服务器地址
2. 输入昵称并连接服务器
3. 任一用户的播放操作会同步到所有人

### 发送弹幕

1. 在弹幕输入框输入内容
2. 可选择弹幕颜色和大小
3. 点击"发送"或按回车键发送
4. 弹幕会同时显示在视频上和聊天室中

## 端口说明

| 端口 | 服务 | 说明 |
|------|------|------|
| 3000 | HTTP | 静态文件服务，提供网页界面 |
| 3001 | WebSocket | 实时通信，同步播放状态和消息 |

## 消息协议

### 客户端 -> 服务器

| type | 说明 | 参数 |
|------|------|------|
| `play` | 播放 | - |
| `pause` | 暂停 | - |
| `seek` | 跳转 | `time`: 目标时间 |
| `ratechange` | 变速 | `rate`: 播放速率 |
| `chat` | 聊天 | `username`, `content`, `timestamp` |
| `danmaku` | 弹幕 | `content`, `color`, `size`, `sender`, `track` |
| `set_nickname` | 设置昵称 | `nickname` |

### 服务器 -> 客户端

| type | 说明 |
|------|------|
| `sync` | 同步播放状态 |
| `users_update` | 在线用户列表更新 |
| `user_joined` | 用户加入 |
| `user_left` | 用户离开 |
| `danmaku` | 弹幕消息 |
| `chat` | 聊天消息 |

## 开发

### 目录说明

- `server.js` - WebSocket 服务器，处理实时同步
- `web_server.js` - Express 静态文件服务器
- `public/script.js` - 客户端核心逻辑
- `public/index.html` - 页面结构和样式

### 添加新功能

1. 在 `server.js` 中添加消息处理
2. 在 `script.js` 中添加客户端逻辑
3. 在 `index.html` 中添加 UI 组件

## 注意事项

- 视频文件需要浏览器支持的格式（推荐 MP4）
- WebSocket 连接断开后需要手动重连

## License

MIT License
