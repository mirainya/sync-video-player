const WebSocket = require('ws');

// 存储所有连接的客户端及其信息
const clients = new Map(); // 使用Map存储客户端与其相关信息
let clientIdCounter = 0; // 用于生成唯一ID

// 当前播放状态
let currentPlayerState = {
  currentTime: 0,
  paused: true,
  playbackRate: 1.0
};

// 创建WebSocket服务器（端口3001）
const wss = new WebSocket.Server({ port: 3001 }, () => {
  console.log('WebSocket服务器启动在端口 3001');
});

wss.on('connection', (ws) => {
  console.log('新客户端连接');

  // 生成唯一客户端ID
  const clientId = ++clientIdCounter;

  // 初始化客户端信息
  const clientInfo = {
    id: clientId,
    ws: ws,
    nickname: `用户${clientId}`, // 默认昵称
    connectedAt: new Date()
  };

  // 将新客户端添加到集合
  clients.set(ws, clientInfo);

  // 发送当前播放状态给新连接的客户端
  ws.send(JSON.stringify({
    type: 'sync',
    state: currentPlayerState
  }));

  // 发送当前在线用户列表给新连接的客户端
  ws.send(JSON.stringify({
    type: 'users_update',
    users: Array.from(clients.values()).map(client => ({
      id: client.id,
      nickname: client.nickname
    }))
  }));

  // 通知所有其他客户端有新用户加入
  broadcastToOthers(ws, {
    type: 'user_joined',
    user: {
      id: clientInfo.id,
      nickname: clientInfo.nickname
    }
  });

  // 监听消息
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());

      switch(message.type) {
        case 'play':
          currentPlayerState.paused = false;
          // 广播完整的播放状态给其他客户端
          broadcastToOthers(ws, {
            type: 'sync',
            state: currentPlayerState
          });
          break;

        case 'pause':
          currentPlayerState.paused = true;
          // 广播完整的播放状态给其他客户端
          broadcastToOthers(ws, {
            type: 'sync',
            state: currentPlayerState
          });
          break;

        case 'seek':
          currentPlayerState.currentTime = message.time;
          // 广播完整的播放状态给其他客户端
          broadcastToOthers(ws, {
            type: 'sync',
            state: currentPlayerState
          });
          break;

        case 'ratechange':
          currentPlayerState.playbackRate = message.rate;
          // 广播完整的播放状态给其他客户端
          broadcastToOthers(ws, {
            type: 'sync',
            state: currentPlayerState
          });
          break;

        case 'sync_request':
          // 客户端请求同步状态
          ws.send(JSON.stringify({
            type: 'sync',
            state: currentPlayerState
          }));
          break;

        case 'set_nickname':
          // 更新用户昵称
          const client = clients.get(ws);
          if (client) {
            const oldNickname = client.nickname;
            client.nickname = message.nickname || `用户${client.id}`;

            // 广播昵称更改
            broadcastToOthers(ws, {
              type: 'nickname_changed',
              userId: client.id,
              oldNickname: oldNickname,
              newNickname: client.nickname
            });

            // 发送更新后的用户列表
            broadcastUsersUpdate();
          }
          break;

        case 'chat':
        case 'action':
        case 'system':
          // 转发聊天、动作和系统消息给其他客户端，不包括发送者
          broadcastToOthers(ws, message);
          break;

        case 'danmaku':
          // 转发弹幕消息给其他客户端（不包括发送者，发送者在发送时已经显示）
          console.log(`收到弹幕消息，发送者: ${clients.get(ws)?.nickname}, 内容: ${message.content}`);
          console.log(`当前连接数: ${clients.size}`);
          broadcastToOthers(ws, message);
          break;
      }
    } catch (error) {
      console.error('解析消息时出错:', error);
    }
  });

  // 连接关闭时从集合中移除
  ws.on('close', () => {
    console.log('客户端断开连接');
    const clientInfo = clients.get(ws);
    if (clientInfo) {
      // 通知其他客户端有用户离开
      broadcastToOthers(ws, {
        type: 'user_left',
        userId: clientInfo.id
      });

      clients.delete(ws);
      // 发送更新后的用户列表
      broadcastUsersUpdate();
    }
  });

  // 错误处理
  ws.on('error', (error) => {
    console.error('WebSocket错误:', error);
    const clientInfo = clients.get(ws);
    if (clientInfo) {
      // 通知其他客户端有用户离开
      broadcastToOthers(ws, {
        type: 'user_left',
        userId: clientInfo.id
      });

      clients.delete(ws);
      // 发送更新后的用户列表
      broadcastUsersUpdate();
    }
  });
});

// 广播消息给所有客户端
function broadcastToAll(message) {
  const msgString = JSON.stringify(message);

  clients.forEach((clientInfo) => {
    if (clientInfo.ws.readyState === WebSocket.OPEN) {
      clientInfo.ws.send(msgString);
    }
  });
}

// 广播消息给其他客户端（不包括发送者）
function broadcastToOthers(sender, message) {
  const msgString = JSON.stringify(message);
  let sentCount = 0;

  clients.forEach((clientInfo) => {
    if (clientInfo.ws.readyState === WebSocket.OPEN && clientInfo.ws !== sender) {
      clientInfo.ws.send(msgString);
      sentCount++;
      if (message.type === 'danmaku') {
        console.log(`弹幕已发送给: ${clientInfo.nickname}`);
      }
    }
  });

  if (message.type === 'danmaku') {
    console.log(`弹幕消息已发送给 ${sentCount} 个客户端`);
  }
}

// 广播播放状态给所有客户端
function broadcastState() {
  const message = JSON.stringify({
    type: 'sync',
    state: currentPlayerState
  });

  clients.forEach((clientInfo) => {
    if (clientInfo.ws.readyState === WebSocket.OPEN) {
      clientInfo.ws.send(message);
    }
  });
}

// 广播用户列表更新给所有客户端
function broadcastUsersUpdate() {
  const users = Array.from(clients.values()).map(client => ({
    id: client.id,
    nickname: client.nickname
  }));

  const message = {
    type: 'users_update',
    users: users
  };

  clients.forEach((clientInfo) => {
    if (clientInfo.ws.readyState === WebSocket.OPEN) {
      clientInfo.ws.send(JSON.stringify(message));
    }
  });
}

// 每秒更新一次播放时间（当播放时）
setInterval(() => {
  if (!currentPlayerState.paused) {
    currentPlayerState.currentTime += 1;
    broadcastState();
  }
}, 1000);

console.log('等待客户端连接...');