// 全局变量
let socket;
let isConnected = false;
let nickname = '用户';
let onlineUsers = []; // 存储在线用户列表
let danmakuEnabled = true; // 是否开启弹幕
let hls = null; // HLS.js 实例
let adminId = null; // 当前管理员ID
let voteStatus = {}; // 投票状态
let isSyncing = false; // 标记是否正在被动同步，防止循环
let lastSyncTime = 0; // 最后一次同步的时间戳
let lastSeekTime = 0; // 最后一次跳转的时间戳
let localPlayStartTime = 0; // 本地播放开始时间
let localPlayStartPosition = 0; // 本地播放开始位置

// 弹幕轨道系统
const DANMAKU_TRACK_COUNT = 10; // 弹幕轨道数量
let danmakuTracks = []; // 存储每条轨道的占用结束时间
let danmakuTrackIndex = 0; // 当前分配的轨道索引

// 初始化弹幕轨道
function initDanmakuTracks() {
  danmakuTracks = new Array(DANMAKU_TRACK_COUNT).fill(0);
}
initDanmakuTracks();

// 获取可用的弹幕轨道
function getAvailableTrack() {
  const now = Date.now();

  // 优先找完全空闲的轨道
  for (let i = 0; i < DANMAKU_TRACK_COUNT; i++) {
    if (danmakuTracks[i] <= now) {
      return i;
    }
  }

  // 如果没有空闲轨道，找最早结束的轨道
  let minIndex = 0;
  let minTime = danmakuTracks[0];
  for (let i = 1; i < DANMAKU_TRACK_COUNT; i++) {
    if (danmakuTracks[i] < minTime) {
      minTime = danmakuTracks[i];
      minIndex = i;
    }
  }
  return minIndex;
}

// 标记轨道被占用
function occupyTrack(trackIndex, duration) {
  danmakuTracks[trackIndex] = Date.now() + duration * 1000;
}

// 获取DOM元素
const videoPlayer = document.getElementById('videoPlayer');
const playBtn = document.getElementById('playBtn');
const pauseBtn = document.getElementById('pauseBtn');
const currentTimeDisplay = document.getElementById('currentTime');
const durationDisplay = document.getElementById('duration');
const connectionStatus = document.getElementById('connectionStatus');
const playbackRateSelect = document.getElementById('playbackRate');
const nicknameInput = document.getElementById('nickname');
const wsServerInput = document.getElementById('wsServer');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const actionsList = document.getElementById('actionsList');
const currentVideoTitle = document.getElementById('currentVideoTitle');

// 断开当前连接
function disconnectFromServer() {
  if (socket && isConnected) {
    socket.close();
    isConnected = false;
  }
}

// 连接到WebSocket服务器
function connectToServer() {
  // 先断开之前的连接（如果存在）
  if (socket) {
    disconnectFromServer();
  }

  // 获取用户输入的昵称和服务器地址
  nickname = nicknameInput.value.trim() || '用户';
  let userInput = wsServerInput.value.trim();

  // 如果输入为空，使用默认地址
  if (!userInput) {
    userInput = 'localhost:3001';
  }

  // 如果输入已经是完整的WebSocket URL，直接使用
  if (userInput.startsWith('ws://') || userInput.startsWith('wss://')) {
    var wsServer = userInput;
  } else {
    // 如果输入包含多个可能的地址（如 "frp-tip.com:47838/218.12.120.170:34101"）
    // 尝试提取第一个有效的地址部分
    let cleanInput = userInput;
    if (userInput.includes('/')) {
      // 分割并取第一个包含端口的部分
      const parts = userInput.split('/');
      for (let part of parts) {
        if (part.includes(':')) {
          cleanInput = part;
          break;
        }
      }
    }

    // 确保地址包含端口，否则添加默认端口
    if (!cleanInput.includes(':')) {
      cleanInput = cleanInput + ':3001';
    }

    // 根据页面协议选择ws://或wss://
    if (window.location.protocol === 'https:') {
      var wsServer = 'wss://' + cleanInput;
    } else {
      var wsServer = 'ws://' + cleanInput;
    }
  }

  // 检查是否意外添加了尾部斜杠
  if (wsServer.endsWith('/')) {
    wsServer = wsServer.slice(0, -1);
  }

  // 尝试连接到WebSocket服务器
  try {
    socket = new WebSocket(wsServer);
  } catch (e) {
    console.error('WebSocket连接失败:', e);
    alert('WebSocket连接失败，请检查服务器地址是否正确');
    return;
  }

  socket.onopen = function(event) {
    console.log('已连接到同步服务器');
    isConnected = true;
    connectionStatus.textContent = '已连接';
    connectionStatus.className = 'connected';

    // 发送用户昵称给服务器
    socket.send(JSON.stringify({
      type: 'set_nickname',
      nickname: nickname
    }));

    // 检查是否已经加载了视频，如果是，通知服务器
    if (videoPlayer.src && videoPlayer.src !== window.location.href) {
      const currentVideoUrl = videoPlayer.src;
      const currentTitle = currentVideoTitle.textContent || '网络视频';

      console.log('检测到已加载视频，通知服务器:', currentVideoUrl);

      socket.send(JSON.stringify({
        type: 'video_change',
        videoUrl: currentVideoUrl,
        videoTitle: currentTitle
      }));

      // 发送系统消息
      sendSystemMessageToServer(`${nickname} 更换了视频: ${currentTitle}`);
    }
  };

  socket.onmessage = function(event) {
    const message = JSON.parse(event.data);
    console.log('收到消息:', message.type, message);

    switch(message.type) {
      case 'sync':
        syncVideoState(message.state);
        break;
      case 'video_change':
        // 收到视频变更通知，自动加载新视频
        handleVideoChange(message);
        break;
      case 'chat':
        addChatMessage(message.username, message.content, message.timestamp);
        break;
      case 'action':
        addActionRecord(message.username, message.action, message.timestamp);
        break;
      case 'system':
        addSystemMessage(message.content, message.timestamp);
        break;
      case 'users_update':
        updateOnlineUsersList(message.users);
        break;
      case 'user_joined':
        handleUserJoined(message.user);
        break;
      case 'user_left':
        handleUserLeft(message.userId);
        break;
      case 'nickname_changed':
        handleNicknameChanged(message);
        break;

      case 'danmaku':
        console.log('收到弹幕消息:', message);
        handleDanmaku(message);
        break;

      case 'admin_changed':
        // 管理员变更通知
        handleAdminChanged(message);
        break;

      case 'vote_status_update':
        // 投票状态更新
        handleVoteStatusUpdate(message);
        break;
    }
  };

  socket.onclose = function(event) {
    console.log('与同步服务器断开连接');
    isConnected = false;
    connectionStatus.textContent = '未连接';
    connectionStatus.className = 'disconnected';

    // 清空在线用户列表
    onlineUsers = [];
    renderOnlineUsersList();

    // 尝试重连（可选，根据需求决定是否启用）
    // setTimeout(connectToServer, 3000);
  };

  socket.onerror = function(error) {
    console.error('WebSocket错误:', error);
    isConnected = false;
    connectionStatus.textContent = '连接错误';
    connectionStatus.className = 'disconnected';
  };
}


// 发送聊天消息
function sendMessage() {
  if (!isConnected) {
    alert('请先连接到服务器');
    return;
  }

  const message = chatInput.value.trim();
  if (message) {
    const chatMessage = {
      type: 'chat',
      username: nickname,
      content: message,
      timestamp: new Date().toLocaleTimeString()
    };

    // 先在本地显示消息
    addChatMessage(nickname, message, new Date().toLocaleTimeString());

    // 然后发送到服务器
    socket.send(JSON.stringify(chatMessage));
    chatInput.value = '';
  }
}

// 处理聊天输入框的回车事件
function handleChatKeyPress(event) {
  if (event.key === 'Enter') {
    sendMessage();
  }
}

// 添加聊天消息到界面
function addChatMessage(username, content, timestamp) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'chat-message';

  // 检查发送者是否是管理员
  const user = onlineUsers.find(u => u.nickname === username);
  const isAdmin = user && user.id === adminId;
  const adminBadge = isAdmin ? '<span class="admin-badge">👑</span>' : '';

  messageDiv.innerHTML = `
    <div>
      <span class="username">${username}${adminBadge}</span>
      <span class="timestamp" style="float: right; font-size: 0.8rem; color: #6c757d;">${timestamp}</span>
    </div>
    <div>${content}</div>
  `;

  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// 添加系统消息
function addSystemMessage(content, timestamp) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'chat-message';
  messageDiv.style.backgroundColor = '#d1ecf1';
  messageDiv.style.color = '#0c5460';
  messageDiv.style.textAlign = 'center';
  messageDiv.innerHTML = `
    <div>
      <span class="timestamp" style="font-size: 0.8rem;">${timestamp}</span>
    </div>
    <div>${content}</div>
  `;

  const chatMessages = document.getElementById('chatMessages');
  if (chatMessages) {
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

// 发送系统消息到服务器（让其他用户看到）
function sendSystemMessageToServer(content) {
  if (isConnected && socket) {
    const systemMessage = {
      type: 'system',
      content: content,
      timestamp: new Date().toLocaleTimeString()
    };

    socket.send(JSON.stringify(systemMessage));
  }
}

// 发送系统消息（仅本地显示）
function sendSystemMessage(content) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'chat-message';
  messageDiv.style.backgroundColor = '#d1ecf1';
  messageDiv.style.color = '#0c5460';
  messageDiv.style.textAlign = 'center';
  messageDiv.innerHTML = `
    <div>
      <span class="timestamp" style="font-size: 0.8rem;">${new Date().toLocaleTimeString()}</span>
    </div>
    <div>${content}</div>
  `;

  const chatMessages = document.getElementById('chatMessages');
  if (chatMessages) {
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}


// 更新在线用户列表
function updateOnlineUsersList(users) {
  onlineUsers = users;
  renderOnlineUsersList();
}

// 渲染在线用户列表到页面
function renderOnlineUsersList() {
  const onlineUsersContainer = document.getElementById('onlineUsersList');
  if (!onlineUsersContainer) return;

  // 清空现有列表
  onlineUsersContainer.innerHTML = '';

  // 添加在线用户
  onlineUsers.forEach(user => {
    const userDiv = document.createElement('div');
    userDiv.className = 'online-user';

    // 检查是否是管理员
    const isAdmin = user.id === adminId;
    const adminBadge = isAdmin ? '<span class="admin-badge">👑</span>' : '';

    // 获取该用户的投票数
    const votes = voteStatus[user.id] || 0;
    const voteDisplay = votes > 0 ? `<span class="vote-count">(${votes}票)</span>` : '';

    userDiv.innerHTML = `
      <div class="user-icon">👤</div>
      <div class="user-nickname">${user.nickname} ${adminBadge} ${voteDisplay}</div>
      ${!isAdmin ? `<button class="vote-btn" onclick="voteForAdmin(${user.id})" title="投票给此用户">🗳️</button>` : ''}
    `;
    onlineUsersContainer.appendChild(userDiv);
  });

  // 更新计数
  const countElement = document.getElementById('onlineUsersCount');
  if (countElement) {
    countElement.textContent = onlineUsers.length;
  }
}

// 处理用户加入
function handleUserJoined(user) {
  // 检查用户是否已存在于列表中
  const existingUserIndex = onlineUsers.findIndex(u => u.id === user.id);
  if (existingUserIndex !== -1) {
    // 如果用户已存在，更新其信息
    onlineUsers[existingUserIndex] = user;
  } else {
    // 如果用户不存在，添加到列表
    onlineUsers.push(user);
  }
  renderOnlineUsersList();
  addSystemMessage(`${user.nickname} 加入了房间`, new Date().toLocaleTimeString());
}

// 处理用户离开
function handleUserLeft(userId) {
  const userIndex = onlineUsers.findIndex(u => u.id === userId);
  if (userIndex !== -1) {
    const leftUser = onlineUsers[userIndex];
    onlineUsers.splice(userIndex, 1);
    renderOnlineUsersList();
    addSystemMessage(`${leftUser.nickname} 离开了房间`, new Date().toLocaleTimeString());
  }
}

// 处理昵称更改
function handleNicknameChanged(message) {
  const userIndex = onlineUsers.findIndex(u => u.id === message.userId);
  if (userIndex !== -1) {
    onlineUsers[userIndex].nickname = message.newNickname;
    renderOnlineUsersList();
    addSystemMessage(`${message.oldNickname} 更名为 ${message.newNickname}`, new Date().toLocaleTimeString());
  }
}

// 处理管理员变更
function handleAdminChanged(message) {
  adminId = message.adminId;

  // 查找新管理员的昵称
  const newAdmin = onlineUsers.find(u => u.id === message.adminId);
  const adminNickname = newAdmin ? newAdmin.nickname : `用户${message.adminId}`;

  addSystemMessage(`🎖️ ${adminNickname} 成为了房间管理员`, new Date().toLocaleTimeString());

  // 重新渲染用户列表以显示管理员标识
  renderOnlineUsersList();
}

// 处理投票状态更新
function handleVoteStatusUpdate(message) {
  voteStatus = message.voteStatus || {};
  adminId = message.adminId;

  // 重新渲染用户列表以显示投票数
  renderOnlineUsersList();
}

// 投票给某个用户成为管理员
function voteForAdmin(candidateId) {
  if (!isConnected || !socket) {
    alert('请先连接到服务器');
    return;
  }

  socket.send(JSON.stringify({
    type: 'vote_admin',
    candidateId: candidateId
  }));

  console.log(`已投票给用户 ${candidateId}`);
}

// 处理弹幕消息
function handleDanmaku(danmakuMsg) {
  console.log('处理弹幕, danmakuEnabled:', danmakuEnabled, 'content:', danmakuMsg.content);

  // 在聊天室显示弹幕（收到的）
  addDanmakuToChat(danmakuMsg.sender || '匿名', danmakuMsg.content, danmakuMsg.color || '#ffffff');

  if (danmakuEnabled) {
    // 使用发送方指定的轨道索引，确保所有用户看到弹幕在同一位置
    const trackIndex = danmakuMsg.track !== undefined ? danmakuMsg.track : null;
    showDanmaku(danmakuMsg.content, danmakuMsg.color || '#ffffff', danmakuMsg.size || 'normal', trackIndex);
  } else {
    console.log('弹幕已关闭，不显示');
  }
}

// 显示弹幕
// trackIndex: 指定轨道索引，如果为 null 则自动分配轨道
function showDanmaku(text, color, size, trackIndex = null) {
  console.log('showDanmaku 被调用:', text, color, size, trackIndex);

  // 创建弹幕元素
  const danmakuElement = document.createElement('div');
  danmakuElement.className = 'danmaku-item';
  danmakuElement.textContent = text;
  danmakuElement.style.color = color;

  // 根据size设置字体大小
  let fontSize = 18;
  if (size === 'small') {
    fontSize = 14;
  } else if (size === 'large') {
    fontSize = 22;
  }
  danmakuElement.style.fontSize = `${fontSize}px`;

  // 设置基本样式
  danmakuElement.style.position = 'absolute';
  danmakuElement.style.whiteSpace = 'nowrap';
  danmakuElement.style.userSelect = 'none';
  danmakuElement.style.textShadow = '1px 1px 2px rgba(0,0,0,0.8)';

  // 添加到弹幕容器但暂时隐藏
  const danmakuContainer = document.getElementById('danmakuContainer');
  if (!danmakuContainer) {
    console.error('弹幕容器不存在！');
    return null;
  }

  console.log('容器尺寸:', danmakuContainer.clientWidth, 'x', danmakuContainer.clientHeight);

  // 先添加到容器以计算宽度
  danmakuElement.style.visibility = 'hidden';
  danmakuContainer.appendChild(danmakuElement);

  // 获取元素的实际宽度
  const danmakuWidth = danmakuElement.offsetWidth;
  const containerWidth = danmakuContainer.clientWidth;
  const containerHeight = danmakuContainer.clientHeight;

  console.log('弹幕宽度:', danmakuWidth, '容器宽度:', containerWidth);

  // 计算动画持续时间（基于容器宽度和弹幕长度）
  const animationDuration = (containerWidth + danmakuWidth) / 150; // 每150px用1秒，稍快一些

  // 如果没有指定轨道，自动分配一个
  if (trackIndex === null) {
    trackIndex = getAvailableTrack();
  }

  // 标记轨道被占用
  occupyTrack(trackIndex, animationDuration);

  // 计算轨道对应的垂直位置
  const trackHeight = containerHeight / DANMAKU_TRACK_COUNT;
  const topOffset = trackIndex * trackHeight + (trackHeight - fontSize) / 2;
  danmakuElement.style.top = `${Math.max(0, topOffset)}px`;

  // 使用 left 而不是 right 来定位，更可靠
  danmakuElement.style.left = `${containerWidth}px`;
  danmakuElement.style.visibility = 'visible';

  console.log('弹幕初始位置 left:', containerWidth, 'top:', topOffset, '轨道:', trackIndex);

  // 开始动画 - 从右侧进入，移动到左侧外
  setTimeout(() => {
    danmakuElement.style.transition = `left ${animationDuration}s linear`;
    danmakuElement.style.left = `${-danmakuWidth}px`;
    console.log('动画开始，目标位置 left:', -danmakuWidth);
  }, 10);

  // 动画结束后移除弹幕元素
  setTimeout(() => {
    if (danmakuElement.parentNode) {
      danmakuElement.parentNode.removeChild(danmakuElement);
    }
  }, animationDuration * 1000 + 100);

  // 返回分配的轨道索引，用于同步
  return trackIndex;
}

// 发送弹幕
function sendDanmaku() {
  const danmakuInput = document.getElementById('danmakuInput');
  if (!danmakuInput || !isConnected) return;

  const content = danmakuInput.value.trim();
  if (!content) return;

  // 获取颜色和大小选项
  const colorPicker = document.getElementById('danmakuColor');
  const sizeSelector = document.getElementById('danmakuSize');

  const color = colorPicker ? colorPicker.value : '#ffffff';
  const size = sizeSelector ? sizeSelector.value : 'normal';

  // 本地显示弹幕并获取分配的轨道索引
  const trackIndex = showDanmaku(content, color, size);

  // 在聊天室显示弹幕（自己发送的）
  addDanmakuToChat(nickname, content, color);

  const danmakuMsg = {
    type: 'danmaku',
    content: content,
    color: color,
    size: size,
    sender: nickname,
    track: trackIndex // 包含轨道索引，让其他用户在同一轨道显示
  };

  // 发送到服务器 - 服务器会将其广播给其他用户（不包括发送者）
  socket.send(JSON.stringify(danmakuMsg));

  // 清空输入框
  danmakuInput.value = '';
}

// 处理弹幕输入框的回车事件
function handleDanmakuKeyPress(event) {
  if (event.key === 'Enter') {
    sendDanmaku();
  }
}

// 在聊天室显示弹幕消息
function addDanmakuToChat(username, content, color) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'chat-message danmaku-message';

  // 检查发送者是否是管理员
  const user = onlineUsers.find(u => u.nickname === username);
  const isAdmin = user && user.id === adminId;
  const adminBadge = isAdmin ? '<span class="admin-badge">👑</span>' : '';

  messageDiv.innerHTML = `
    <div>
      <span class="username" style="color: ${color}">[弹幕] ${username}${adminBadge}</span>
      <span class="timestamp" style="float: right; font-size: 0.8rem; color: #6c757d;">${new Date().toLocaleTimeString()}</span>
    </div>
    <div style="color: ${color}">${content}</div>
  `;

  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// 切换弹幕显示
function toggleDanmaku() {
  danmakuEnabled = !danmakuEnabled;
  const toggleBtn = document.getElementById('danmakuToggle');
  if (toggleBtn) {
    toggleBtn.textContent = danmakuEnabled ? '关闭弹幕' : '开启弹幕';
    toggleBtn.classList.toggle('active', danmakuEnabled);
  }
}

// 添加动作记录
function addActionRecord(username, action, timestamp) {
  const actionDiv = document.createElement('div');
  actionDiv.className = 'action-item';

  // 检查发送者是否是管理员
  const user = onlineUsers.find(u => u.nickname === username);
  const isAdmin = user && user.id === adminId;
  const adminBadge = isAdmin ? '<span class="admin-badge">👑</span>' : '';

  actionDiv.innerHTML = `
    <div class="timestamp">${timestamp}</div>
    <div class="action">${username}${adminBadge}: ${action}</div>
  `;

  actionsList.appendChild(actionDiv);
  actionsList.scrollTop = actionsList.scrollHeight;
}

// 发送动作记录
function sendActionRecord(action) {
  if (isConnected) {
    const actionMessage = {
      type: 'action',
      username: nickname,
      action: action,
      timestamp: new Date().toLocaleTimeString()
    };

    socket.send(JSON.stringify(actionMessage));
  }
}

// 同步视频状态
function syncVideoState(state) {
  const now = Date.now();

  // 防止频繁同步：如果距离上次同步不到500ms，忽略
  if (now - lastSyncTime < 500) {
    return;
  }
  lastSyncTime = now;

  // 设置同步标志，防止触发事件发送到服务器
  isSyncing = true;

  try {
    // 如果有视频URL且与当前不同，自动加载新视频
    if (state.videoUrl && videoPlayer.src !== state.videoUrl) {
      console.log('检测到视频URL变化，自动加载:', state.videoUrl);
      loadVideoFromUrl(state.videoUrl, state.videoTitle || '网络视频', false); // false 表示不通知服务器
    }

    // 计算预期的当前时间（考虑网络延迟和本地播放）
    let expectedTime = state.currentTime;
    if (!state.paused) {
      // 如果正在播放，根据最后更新时间估算当前应该在的位置
      const timeSinceUpdate = (now - state.lastUpdateTime) / 1000;
      expectedTime = state.currentTime + timeSinceUpdate * state.playbackRate;
    }

    // 更新播放时间 - 增加容忍度到3秒，避免频繁跳转
    const timeDiff = Math.abs(videoPlayer.currentTime - expectedTime);
    if (timeDiff > 3) {
      console.log(`时间差异过大 (${timeDiff.toFixed(2)}秒)，执行跳转到 ${expectedTime.toFixed(2)}`);
      videoPlayer.currentTime = expectedTime;
      lastSeekTime = now; // 记录跳转时间
    }

    // 更新播放/暂停状态 - 无论当前状态如何，都要设置为服务器状态
    if (state.paused && !videoPlayer.paused) {
      videoPlayer.pause();
    } else if (!state.paused && videoPlayer.paused) {
      videoPlayer.play().catch(e => console.log("自动播放被阻止:", e));
    }

    // 特殊情况：如果服务器状态是暂停，但视频仍在播放（可能由于浏览器策略），强制暂停
    if (state.paused) {
      if (!videoPlayer.paused) {
        videoPlayer.pause();
      }
    }

    // 更新播放速度
    if (Math.abs(videoPlayer.playbackRate - state.playbackRate) > 0.01) {
      videoPlayer.playbackRate = state.playbackRate;
    }

    // 更新UI显示
    updateTimeDisplay();
  } finally {
    // 延迟重置同步标志，确保所有事件都已处理
    // 增加延迟时间到500ms，确保所有相关事件都被忽略
    setTimeout(() => {
      isSyncing = false;
    }, 500);
  }
}

// 处理视频变更消息
function handleVideoChange(message) {
  console.log('收到视频变更通知:', message);

  // 自动加载新视频
  if (message.videoUrl) {
    loadVideoFromUrl(message.videoUrl, message.videoTitle || '网络视频', false); // false 表示不通知服务器

    // 显示系统消息
    addSystemMessage(`房间视频已更换: ${message.videoTitle || '网络视频'}`, new Date().toLocaleTimeString());
  }
}

// 播放视频
function playVideo() {
  videoPlayer.play()
    .then(() => {
      if (isConnected) {
        socket.send(JSON.stringify({ type: 'play' }));
        sendActionRecord('开始播放');
      }
    })
    .catch(e => console.log("播放失败:", e));
}

// 暂停视频
function pauseVideo() {
  videoPlayer.pause();
  if (isConnected) {
    socket.send(JSON.stringify({ type: 'pause' }));
    sendActionRecord('暂停播放');
  }
}

// 跳转到指定时间
function seekVideo(time) {
  videoPlayer.currentTime = time;
  if (isConnected) {
    socket.send(JSON.stringify({
      type: 'seek',
      time: time
    }));
    sendActionRecord(`跳转到 ${formatTime(time)}`);
  }
}

// 改变播放速度
function changePlaybackRate() {
  const rate = parseFloat(playbackRateSelect.value);
  videoPlayer.playbackRate = rate;

  if (isConnected) {
    socket.send(JSON.stringify({
      type: 'ratechange',
      rate: rate
    }));
    sendActionRecord(`播放速度改为 ${rate}x`);
  }
}

// 同步时间到服务器
function syncTime() {
  if (isConnected) {
    socket.send(JSON.stringify({
      type: 'sync_request'
    }));
    sendActionRecord('请求同步时间');
  }
}

// 切换全屏
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    videoPlayer.requestFullscreen().catch(err => {
      console.log(`无法进入全屏模式: ${err.message}`);
    });
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  }
}

// 加载视频（通过URL）
function loadVideo() {
  const videoUrl = document.getElementById('videoUrl').value.trim();
  if (!videoUrl) {
    alert('请输入视频URL');
    return;
  }

  const fileName = videoUrl.split('/').pop().split('?')[0] || '网络视频';
  loadVideoFromUrl(videoUrl, fileName, true); // true 表示通知服务器
}

// 通用的视频加载函数
function loadVideoFromUrl(videoUrl, videoTitle, notifyServer = true) {
  if (!videoUrl) {
    console.error('视频URL为空');
    return;
  }

  // 清理之前的 HLS 实例
  if (hls) {
    hls.destroy();
    hls = null;
  }

  // 检测是否是 HLS 流媒体 (m3u8)
  const isHLS = videoUrl.toLowerCase().includes('.m3u8');

  if (isHLS) {
    // HLS 流媒体处理
    if (Hls.isSupported()) {
      // 使用 HLS.js 加载
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90
      });

      hls.loadSource(videoUrl);
      hls.attachMedia(videoPlayer);

      hls.on(Hls.Events.MANIFEST_PARSED, function() {
        console.log('HLS manifest 加载成功');
        // 视频准备就绪，可以播放
      });

      hls.on(Hls.Events.ERROR, function(event, data) {
        console.error('HLS 错误:', data);
        if (data.fatal) {
          switch(data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.error('网络错误，尝试恢复...');
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.error('媒体错误，尝试恢复...');
              hls.recoverMediaError();
              break;
            default:
              console.error('无法恢复的错误');
              hls.destroy();
              alert('视频加载失败：' + data.type);
              break;
          }
        }
      });

      console.log('使用 HLS.js 加载流媒体');
    } else if (videoPlayer.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari 原生支持 HLS
      videoPlayer.src = videoUrl;
      videoPlayer.load();
      console.log('使用原生 HLS 支持');
    } else {
      alert('您的浏览器不支持 HLS 流媒体播放');
      return;
    }
  } else {
    // 普通视频文件，直接加载
    videoPlayer.src = videoUrl;
    videoPlayer.load();
    console.log('加载普通视频文件');
  }

  // 更新视频标题
  updateVideoTitle(videoTitle || '网络视频');

  // 如果连接到服务器且需要通知，则广播视频变更
  if (notifyServer && isConnected && socket) {
    socket.send(JSON.stringify({
      type: 'video_change',
      videoUrl: videoUrl,
      videoTitle: videoTitle || '网络视频'
    }));

    // 发送系统消息
    sendSystemMessageToServer(`${nickname} 更换了视频: ${videoTitle || '网络视频'}`);
  }
}

// 解析视频URL并加载
async function parseAndLoadVideo() {
  const input = document.getElementById('videoUrl');
  const pageUrl = input.value.trim();

  if (!pageUrl) {
    showParseStatus('请输入视频页面URL', 'error');
    return;
  }

  // 跳过解析如果已经是直接视频URL
  if (pageUrl.includes('.m3u8') || pageUrl.includes('.mp4') || pageUrl.includes('.webm')) {
    loadVideo();
    return;
  }

  // 显示加载状态
  setParseLoadingState(true);
  showParseStatus('正在解析视频链接...', 'loading');

  try {
    const response = await fetch('/api/parse-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: pageUrl, method: 'auto' })
    });

    const data = await response.json();

    if (data.success) {
      // 更新输入框为提取的视频URL
      input.value = data.videoUrl;
      showParseStatus(`✅ 解析成功 (${data.method}, ${data.parseTime}ms)`, 'success');

      // 短暂延迟后自动加载视频
      setTimeout(() => loadVideo(), 500);
    } else {
      showParseStatus(`❌ 解析失败: ${data.error}`, 'error');
    }
  } catch (error) {
    console.error('Parse request failed:', error);
    showParseStatus('❌ 网络错误: ' + error.message, 'error');
  } finally {
    setParseLoadingState(false);
  }
}

// 设置解析按钮加载状态
function setParseLoadingState(loading) {
  const btn = document.getElementById('parseBtn');
  const text = document.getElementById('parseBtnText');
  const spinner = document.getElementById('parseBtnSpinner');

  if (btn) btn.disabled = loading;
  if (text) text.style.display = loading ? 'none' : 'inline';
  if (spinner) spinner.style.display = loading ? 'inline' : 'none';
}

// 显示解析状态消息
function showParseStatus(message, type) {
  const status = document.getElementById('parseStatus');
  if (!status) return;

  status.textContent = message;
  status.style.display = 'block';

  const colors = {
    'success': { bg: '#d4edda', text: '#155724' },
    'error': { bg: '#f8d7da', text: '#721c24' },
    'loading': { bg: '#d1ecf1', text: '#0c5460' }
  };

  const color = colors[type] || colors.loading;
  status.style.background = color.bg;
  status.style.color = color.text;

  // 自动隐藏成功消息
  if (type === 'success') {
    setTimeout(() => status.style.display = 'none', 5000);
  }
}

// 加载本地视频文件
function loadLocalVideo() {
  const fileInput = document.getElementById('videoFile');
  const file = fileInput.files[0];

  if (file) {
    // 清理之前的 HLS 实例
    if (hls) {
      hls.destroy();
      hls = null;
    }

    const url = URL.createObjectURL(file);
    videoPlayer.src = url;
    videoPlayer.load();

    // 清空URL输入框
    document.getElementById('videoUrl').value = '';

    // 更新视频标题
    updateVideoTitle(file.name);

    // 显示文件名
    console.log('已加载文件:', file.name);
  } else {
    alert('请选择一个视频文件');
  }
}

// 更新视频标题显示
function updateVideoTitle(title) {
  if (currentVideoTitle) {
    currentVideoTitle.textContent = title || '无';
  }
}

// 格式化时间为 MM:SS
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// 更新时间显示
function updateTimeDisplay() {
  currentTimeDisplay.textContent = formatTime(videoPlayer.currentTime);
  durationDisplay.textContent = videoPlayer.duration ? formatTime(videoPlayer.duration) : '--:--';
}

// 监听视频事件
videoPlayer.addEventListener('timeupdate', updateTimeDisplay);
videoPlayer.addEventListener('loadedmetadata', updateTimeDisplay);
videoPlayer.addEventListener('play', function() {
  // 如果正在被动同步，不发送事件到服务器
  if (isSyncing) return;

  if (isConnected) {
    socket.send(JSON.stringify({ type: 'play' }));
    sendActionRecord('开始播放');
  }
});
videoPlayer.addEventListener('pause', function() {
  // 如果正在被动同步，不发送事件到服务器
  if (isSyncing) return;

  if (isConnected) {
    socket.send(JSON.stringify({ type: 'pause' }));
    sendActionRecord('暂停播放');
  }
});
videoPlayer.addEventListener('seeked', function() {
  const now = Date.now();

  // 如果正在被动同步，不发送事件到服务器
  if (isSyncing) return;

  // 如果是最近500ms内由同步触发的跳转，不发送到服务器
  if (now - lastSeekTime < 500) {
    console.log('忽略同步触发的seeked事件');
    return;
  }

  if (isConnected) {
    socket.send(JSON.stringify({
      type: 'seek',
      time: videoPlayer.currentTime
    }));
    sendActionRecord(`跳转到 ${formatTime(videoPlayer.currentTime)}`);
  }
});

// 页面加载完成后连接服务器
window.onload = function() {
  // 添加示例视频URL
  document.getElementById('videoUrl').value = '/videos/sample.mp4';

  // 设置默认昵称
  nicknameInput.value = '用户' + Math.floor(Math.random() * 1000);

  // 监听昵称输入变化
  nicknameInput.addEventListener('change', function() {
    if (isConnected && socket) {
      nickname = nicknameInput.value.trim() || '用户';
      socket.send(JSON.stringify({
        type: 'set_nickname',
        nickname: nickname
      }));
    } else {
      nickname = nicknameInput.value.trim() || '用户';
    }
  });
};