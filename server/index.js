'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const { RoomManager } = require('./engine/RoomManager');
const { createRouter } = require('./net/routes');
const { attachSockets } = require('./net/sockets');
const persist = require('./state/persist');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });

// مدير الغرف (كل غرفة مسابقة مستقلة)
const roomManager = new RoomManager();

// طبقة Socket.IO (تُعيد دالة ربط الغرف الجديدة بالبثّ)
const { wireRoom } = attachSockets(io, roomManager);

// استعادة الغرف المحفوظة إن وُجدت
try {
  const restored = roomManager.restore(persist.loadRooms(), wireRoom);
  if (restored) console.log(`[boot] تم استعادة ${restored} غرفة محفوظة`);
} catch (err) {
  console.error('[boot] تعذّر استعادة الغرف:', err.message);
}

// REST (يمرّر wireRoom لربط الغرف المنشأة حديثًا)
app.use(createRouter(roomManager, wireRoom));

// ملفات ثابتة
app.use('/shared', express.static(path.join(PUBLIC_DIR, 'shared')));
app.use('/display', express.static(path.join(PUBLIC_DIR, 'display')));
app.use('/admin', express.static(path.join(PUBLIC_DIR, 'admin')));
app.use('/player', express.static(path.join(PUBLIC_DIR, 'player')));

app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'index.html')));
app.get('/display', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'display', 'index.html')));
app.get('/player', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'player', 'index.html')));

// تنظيف الغرف الخاملة دوريًا
const cleanupTimer = setInterval(() => roomManager.cleanupIdle(), 30 * 60 * 1000);
if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();

server.listen(PORT, () => {
  console.log('==================================================');
  console.log('  لعبة الأفخاخ — Team Trap Game (غرف مستقلة)');
  console.log('==================================================');
  console.log(`  الخادم يعمل على المنفذ: ${PORT}`);
  console.log(`  الصفحة الرئيسية: http://localhost:${PORT}/`);
  console.log('==================================================');
});

function shutdown() {
  persist.saveRoomsNow(roomManager.serialize());
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { app, server, roomManager };
