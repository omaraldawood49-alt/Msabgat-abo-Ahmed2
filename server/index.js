'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const { GameEngine } = require('./engine/GameEngine');
const { createRouter } = require('./net/routes');
const { attachSockets, ADMIN_PIN } = require('./net/sockets');
const persist = require('./state/persist');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });

// محرّك اللعبة (مصدر الحقيقة الوحيد)
const engine = new GameEngine();

// استعادة منافسة محفوظة إن وُجدت
const saved = persist.load();
if (saved) {
  try {
    engine.loadCompetition(saved);
    console.log(`[boot] تم استعادة منافسة محفوظة: «${saved.name}» (الجولة ${saved.currentRound}/${saved.rounds})`);
  } catch (err) {
    console.error('[boot] تعذّر استعادة المنافسة المحفوظة:', err.message);
  }
}

// REST + Socket.IO
app.use(createRouter(engine));
attachSockets(io, engine);

// ملفات ثابتة
app.use('/shared', express.static(path.join(PUBLIC_DIR, 'shared')));
app.use('/display', express.static(path.join(PUBLIC_DIR, 'display')));
app.use('/admin', express.static(path.join(PUBLIC_DIR, 'admin')));
app.use('/player', express.static(path.join(PUBLIC_DIR, 'player')));

// صفحات الدخول الرئيسية
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'index.html')));
app.get('/display', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'display', 'index.html')));
app.get('/player', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'player', 'index.html')));

server.listen(PORT, () => {
  console.log('==================================================');
  console.log('  بورصة رواحل — Educational Stock Market');
  console.log('==================================================');
  console.log(`  الخادم يعمل على المنفذ: ${PORT}`);
  console.log(`  شاشة العرض:   http://localhost:${PORT}/display`);
  console.log(`  لوحة الأدمن:  http://localhost:${PORT}/admin   (الرمز: ${ADMIN_PIN})`);
  console.log(`  المتسابق:     http://localhost:${PORT}/player`);
  console.log('==================================================');
  if (ADMIN_PIN === '1234') {
    console.log('  ⚠️  تحذير: رمز الأدمن الافتراضي 1234 — غيّره عبر متغير البيئة ADMIN_PIN');
  }
});

// حفظ فوري عند الإيقاف
function shutdown() {
  persist.saveNow(engine.comp);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { app, server, engine };
