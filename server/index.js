'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const { GameEngine } = require('./engine/GameEngine');
const { createRouter } = require('./net/routes');
const { attachSockets, ADMIN_PIN, REQUIRE_PIN } = require('./net/sockets');
const persist = require('./state/persist');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });

// محرّك اللعبة (مصدر الحقيقة الوحيد)
const engine = new GameEngine();

// استعادة مسابقة محفوظة إن وُجدت (مع تجاهل اللقطات القديمة غير المتوافقة مع نمط اللغم)
const saved = persist.load();
const compatible = saved && Array.isArray(saved.questions) && Array.isArray(saved.groups)
  && (saved.questions.length === 0 || typeof saved.questions[0].answer === 'string');
if (compatible) {
  try {
    engine.loadCompetition(saved);
    console.log(`[boot] تم استعادة مسابقة محفوظة: «${saved.name}» (${saved.questions.length} سؤالًا)`);
  } catch (err) {
    console.error('[boot] تعذّر استعادة المسابقة المحفوظة:', err.message);
  }
} else if (saved) {
  console.warn('[boot] لقطة محفوظة غير متوافقة — تم تجاهلها.');
  persist.clear();
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
  console.log('  مسابقة الألغام — Team Trivia Bluff Game');
  console.log('==================================================');
  console.log(`  الخادم يعمل على المنفذ: ${PORT}`);
  console.log(`  شاشة العرض:   http://localhost:${PORT}/display`);
  console.log(`  شاشة المقدّم: http://localhost:${PORT}/admin   (${REQUIRE_PIN ? 'الرمز: ' + ADMIN_PIN : 'بدون رمز'})`);
  console.log(`  جوال المجموعة: http://localhost:${PORT}/player`);
  console.log('==================================================');
  if (!REQUIRE_PIN) {
    console.log('  ℹ️  شاشة المقدّم تفتح بلا رمز. لتفعيل رمز سري اضبط متغيّر البيئة ADMIN_PIN.');
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
