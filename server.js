const WebSocket = require('ws');

// 存储所有连接的客户端及其信息
const clients = new Map(); // 使用Map存储客户端与其相关信息
let clientIdCounter = 0; // 用于生成唯一ID
let adminClientId = null; // 管理员ID
let adminVotes = new Map(); // 存储投票: Map<candidateId, Set<voterId>>

// 当前播放状态
let currentPlayerState = {
  currentTime: 0,
  paused: true,
  playbackRate: 1.0,
  videoUrl: null,      // 当前播放的视频URL
  videoTitle: null,    // 当前播放的视频标题
  lastUpdateBy: null,  // 最后更新状态的客户端ID
  lastUpdateTime: Date.now()
};

// 获取客户端权重（数字越小权重越高）
function getClientWeight(clientId) {
  // 管理员权重最高
  if (clientId === adminClientId) {
    return 0;
  }
  // 其他用户按连接顺序，ID越小权重越高
  return clientId;
}

// 检查是否有权限更新状态
function canUpdateState(clientId) {
  // 如果没有其他客户端，总是允许
  if (clients.size <= 1) {
    return true;
  }

  // 获取当前客户端权重
  const currentWeight = getClientWeight(clientId);

  // 获取最后更新者的权重
  const lastUpdateWeight = currentPlayerState.lastUpdateBy
    ? getClientWeight(currentPlayerState.lastUpdateBy)
    : Infinity;

  // 只有权重更高或相等的客户端可以更新
  return currentWeight <= lastUpdateWeight;
}

// 投票给某个用户成为管理员
function voteForAdmin(voterId, candidateId) {
  // 初始化候选人的投票集合
  if (!adminVotes.has(candidateId)) {
    adminVotes.set(candidateId, new Set());
  }

  // 移除该投票者之前的所有投票
  adminVotes.forEach((voters, candidate) => {
    voters.delete(voterId);
  });

  // 添加新投票
  adminVotes.get(candidateId).add(voterId);

  // 检查是否达到多数票（超过50%）
  const totalVoters = clients.size;
  const votesNeeded = Math.floor(totalVoters / 2) + 1;
  const currentVotes = adminVotes.get(candidateId).size;

  if (currentVotes >= votesNeeded) {
    // 当选为管理员
    setAdmin(candidateId);
    return true;
  }

  return false;
}

// 设置管理员
function setAdmin(clientId) {
  const oldAdminId = adminClientId;
  adminClientId = clientId;

  // 清空投票
  adminVotes.clear();

  console.log(`管理员已更新: ${clientId}`);

  // 广播管理员变更
  broadcastToAll({
    type: 'admin_changed',
    adminId: adminClientId,
    oldAdminId: oldAdminId
  });
}

// 获取当前投票状态
function getVoteStatus() {
  const voteStatus = {};
  adminVotes.forEach((voters, candidateId) => {
    voteStatus[candidateId] = voters.size;
  });
  return voteStatus;
}

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
          const playClient = clients.get(ws);
          if (playClient && canUpdateState(playClient.id)) {
            currentPlayerState.paused = false;
            currentPlayerState.lastUpdateBy = playClient.id;
            currentPlayerState.lastUpdateTime = Date.now();
            // 广播完整的播放状态给其他客户端
            broadcastToOthers(ws, {
              type: 'sync',
              state: currentPlayerState
            });
          } else {
            console.log(`客户端 ${playClient?.id} 播放请求被拒绝 - 权限不足`);
          }
          break;

        case 'pause':
          const pauseClient = clients.get(ws);
          if (pauseClient && canUpdateState(pauseClient.id)) {
            currentPlayerState.paused = true;
            currentPlayerState.lastUpdateBy = pauseClient.id;
            currentPlayerState.lastUpdateTime = Date.now();
            // 广播完整的播放状态给其他客户端
            broadcastToOthers(ws, {
              type: 'sync',
              state: currentPlayerState
            });
          } else {
            console.log(`客户端 ${pauseClient?.id} 暂停请求被拒绝 - 权限不足`);
          }
          break;

        case 'seek':
          const seekClient = clients.get(ws);
          if (seekClient && canUpdateState(seekClient.id)) {
            currentPlayerState.currentTime = message.time;
            currentPlayerState.lastUpdateBy = seekClient.id;
            currentPlayerState.lastUpdateTime = Date.now();
            // 广播完整的播放状态给其他客户端
            broadcastToOthers(ws, {
              type: 'sync',
              state: currentPlayerState
            });
          } else {
            console.log(`客户端 ${seekClient?.id} 跳转请求被拒绝 - 权限不足`);
          }
          break;

        case 'ratechange':
          const rateClient = clients.get(ws);
          if (rateClient && canUpdateState(rateClient.id)) {
            currentPlayerState.playbackRate = message.rate;
            currentPlayerState.lastUpdateBy = rateClient.id;
            currentPlayerState.lastUpdateTime = Date.now();
            // 广播完整的播放状态给其他客户端
            broadcastToOthers(ws, {
              type: 'sync',
              state: currentPlayerState
            });
          } else {
            console.log(`客户端 ${rateClient?.id} 速度变更请求被拒绝 - 权限不足`);
          }
          break;

        case 'sync_request':
          // 客户端请求同步状态
          ws.send(JSON.stringify({
            type: 'sync',
            state: currentPlayerState
          }));
          break;

        case 'video_change':
          const videoClient = clients.get(ws);
          if (videoClient && canUpdateState(videoClient.id)) {
            // 更新当前播放的视频
            currentPlayerState.videoUrl = message.videoUrl;
            currentPlayerState.videoTitle = message.videoTitle || '网络视频';
            currentPlayerState.currentTime = 0;
            currentPlayerState.paused = true;
            currentPlayerState.lastUpdateBy = videoClient.id;
            currentPlayerState.lastUpdateTime = Date.now();

            console.log(`视频已更改: ${currentPlayerState.videoTitle} (${currentPlayerState.videoUrl})`);

            // 广播视频变更给所有其他客户端
            broadcastToOthers(ws, {
              type: 'video_change',
              videoUrl: currentPlayerState.videoUrl,
              videoTitle: currentPlayerState.videoTitle,
              state: currentPlayerState
            });
          } else {
            console.log(`客户端 ${videoClient?.id} 视频变更请求被拒绝 - 权限不足`);
          }
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

        case 'vote_admin':
          // 投票给某个用户成为管理员
          const voter = clients.get(ws);
          if (voter && message.candidateId) {
            const elected = voteForAdmin(voter.id, message.candidateId);

            // 广播投票状态更新
            broadcastToAll({
              type: 'vote_status_update',
              voteStatus: getVoteStatus(),
              totalVoters: clients.size,
              votesNeeded: Math.floor(clients.size / 2) + 1
            });

            if (elected) {
              const candidate = Array.from(clients.values()).find(c => c.id === message.candidateId);
              console.log(`${candidate?.nickname} (ID: ${message.candidateId}) 当选为管理员`);
            }
          }
          break;

        case 'request_vote_status':
          // 客户端请求当前投票状态
          const requester = clients.get(ws);
          if (requester) {
            ws.send(JSON.stringify({
              type: 'vote_status_update',
              voteStatus: getVoteStatus(),
              totalVoters: clients.size,
              votesNeeded: Math.floor(clients.size / 2) + 1,
              adminId: adminClientId
            }));
          }
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
// 但只在时间变化时才广播，减少不必要的网络流量
let lastBroadcastTime = 0;
setInterval(() => {
  if (!currentPlayerState.paused) {
    currentPlayerState.currentTime += 1;

    // 只在时间变化超过1秒时才广播（减少频繁广播）
    const now = Date.now();
    if (now - lastBroadcastTime >= 1000) {
      lastBroadcastTime = now;
      // 不广播，让客户端自己计算时间
      // 只在有实际操作时才同步
    }
  }
}, 1000);

console.log('等待客户端连接...');