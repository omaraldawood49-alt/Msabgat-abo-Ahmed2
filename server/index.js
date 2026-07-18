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
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });

// مدير الغرف (عدة منافسات متزامنة)
const rm = new RoomManager();

// Socket.IO أولًا حتى تُربط الغرف المُستعادة، ثم REST، ثم استعادة الغرف
attachSockets(io, rm);
app.use(createRouter(rm));

try {
  rm.restore(persist.load());
  if (rm.count() > 0) console.log(`[boot] تم استعادة ${rm.count()} غرفة محفوظة`);
} catch (err) {
  console.error('[boot] تعذّر استعادة الغرف:', err.message);
}

// ملفات ثابتة
app.use('/shared', express.static(path.join(PUBLIC_DIR, 'shared')));
app.use('/display', express.static(path.join(PUBLIC_DIR, 'display')));
app.use('/admin', express.static(path.join(PUBLIC_DIR, 'admin')));
app.use('/player', express.static(path.join(PUBLIC_DIR, 'player')));

app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'index.html')));
app.get('/display', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'display', 'index.html')));
app.get('/player', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'player', 'index.html')));

// تنظيف دوري للغرف الخاملة
setInterval(() => rm.cleanup(), 30 * 60 * 1000);

server.listen(PORT, () => {
  console.log('==================================================');
  console.log('  بورصة الأسهم — Educational Stock Market (غرف متعددة)');
  console.log('==================================================');
  console.log(`  الخادم يعمل على المنفذ: ${PORT}`);
  console.log(`  الصفحة الرئيسية: http://localhost:${PORT}/`);
  console.log(`  إنشاء غرفة (أدمن): http://localhost:${PORT}/admin`);
  console.log('==================================================');
});

function shutdown() {
  persist.saveNow(rm.snapshot());
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { app, server, rm };
