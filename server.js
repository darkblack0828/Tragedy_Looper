// 慘劇 Tragedy 線上對戰中繼伺服器
// 使用方式：
//   1. 安裝 Node.js（https://nodejs.org/）
//   2. 在此資料夾執行：npm install ws
//   3. 啟動：node server.js
//   4. 瀏覽器開：http://localhost:8765

const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8765;

// HTTP 靜態檔案伺服器（同 port）
const httpServer = http.createServer((req, res) => {
  let url = req.url.split('?')[0];
  if (url === '/') url = '/game.html';
  const filePath = path.join(__dirname, url);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(url).toLowerCase();
    const types = { '.html':'text/html;charset=utf-8', '.js':'application/javascript;charset=utf-8', '.css':'text/css;charset=utf-8' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain' });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server: httpServer });
const rooms = new Map();

function genCode() {
  let c;
  do { c = Math.random().toString(36).slice(2, 7).toUpperCase(); } while (rooms.has(c));
  return c;
}

function safeSend(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw); } catch { return; }

    if (data.type === 'create') {
      const code = genCode();
      rooms.set(code, { mastermind: ws, player: null, pendingMSubmit: null });
      ws.roomCode = code; ws.role = 'mastermind';
      safeSend(ws, { type: 'lobby', code, role: 'mastermind', state: 'waiting' });
    }
    else if (data.type === 'join') {
      const room = rooms.get((data.code || '').toUpperCase());
      if (!room) return safeSend(ws, { type: 'error', msg: '房間不存在' });
      if (room.player) return safeSend(ws, { type: 'error', msg: '房間已滿' });
      room.player = ws;
      ws.roomCode = data.code.toUpperCase(); ws.role = 'player';
      safeSend(ws, { type: 'lobby', code: ws.roomCode, role: 'player', state: 'paired' });
      safeSend(room.mastermind, { type: 'lobby', code: ws.roomCode, role: 'mastermind', state: 'paired' });
    }
    else if (data.type === 'msg') {
      const room = rooms.get(ws.roomCode);
      if (!room) return;
      const payload = data.payload || {};
      const opp = ws.role === 'mastermind' ? room.player : room.mastermind;

      // 隱私過濾：劇作家送出時，伺服器暫存全部牌；對玩家僅公開目標位置
      if (payload.action === 'mSubmit' && ws.role === 'mastermind') {
        room.pendingMSubmit = payload;
        if (opp) {
          const targets = (payload.plays || []).map(p => p.target);
          safeSend(opp, { type: 'msg', from: 'mastermind', payload: { action: 'mTargets', targets } });
        }
        return;
      }
      // 玩家送出：先把玩家全部出牌轉給劇作家；同時把暫存的劇作家全部出牌公開給玩家
      if (payload.action === 'pSubmit' && ws.role === 'player') {
        if (opp) safeSend(opp, { type: 'msg', from: 'player', payload });
        if (room.player && room.pendingMSubmit) {
          safeSend(room.player, { type: 'msg', from: 'mastermind', payload: { action: 'mFullReveal', plays: room.pendingMSubmit.plays || [] } });
          room.pendingMSubmit = null;
        }
        return;
      }
      // 其他事件：直接轉發
      if (opp) safeSend(opp, { type: 'msg', from: ws.role, payload });
    }
  });

  ws.on('close', () => {
    const code = ws.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    const other = ws.role === 'mastermind' ? room.player : room.mastermind;
    safeSend(other, { type: 'opponentDisconnected' });
    rooms.delete(code);
  });
});

httpServer.listen(PORT, () => {
  console.log('===========================================');
  console.log(' 慘劇 Tragedy 線上對戰伺服器');
  console.log(' 開啟瀏覽器：http://localhost:' + PORT);
  console.log('===========================================');
});
