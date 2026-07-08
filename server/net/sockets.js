'use strict';

const Competition = require('../engine/Competition');
const views = require('./views');
const persist = require('../state/persist');

const ADMIN_PIN = process.env.ADMIN_PIN || '1234';

/**
 * يربط طبقة Socket.IO بمحرّك اللعبة:
 *  - غرف: display / admin / group:<id>
 *  - بثّ مُفلتر حسب الدور
 *  - استقبال أوامر المقدّم وإجابات المجموعات
 */
function attachSockets(io, engine) {
  // ------- دوال البثّ -------
  function pushDisplay() {
    io.to('display').emit('state', views.displayState(engine.comp));
  }
  function pushAdmin() {
    io.to('admin').emit('state', views.adminState(engine.comp));
  }
  function pushGroups() {
    if (!engine.comp) return;
    for (const g of engine.comp.groups) {
      io.to(`group:${g.id}`).emit('state', views.playerState(engine.comp, g));
    }
  }
  function pushAll() {
    pushDisplay();
    pushAdmin();
    pushGroups();
  }

  // ------- الاشتراك في أحداث المحرّك -------
  engine.on('state', () => {
    pushAll();
    persist.save(engine.comp);
  });
  engine.on('tick', ({ timeLeft }) => {
    io.emit('tick', { timeLeft, currentIndex: engine.comp ? engine.comp.currentIndex : -1 });
  });
  engine.on('question:open', ({ index }) => {
    io.emit('question:open', { index });
  });
  engine.on('question:reveal', ({ index, correctIndex }) => {
    io.emit('question:reveal', { index, correctIndex });
  });
  engine.on('competition:finished', ({ standings, podium }) => {
    io.emit('competition:finished', { standings, podium, name: engine.comp.name });
  });

  // ------- الاتصال -------
  io.on('connection', (socket) => {
    const auth = socket.handshake.auth || {};
    const role = auth.role;

    if (role === 'display') {
      socket.join('display');
      socket.emit('state', views.displayState(engine.comp));
      return;
    }

    if (role === 'admin') {
      if (String(auth.pin) !== String(ADMIN_PIN)) {
        socket.emit('auth:error', { error: 'رمز المقدّم غير صحيح' });
        socket.disconnect(true);
        return;
      }
      socket.join('admin');
      socket.emit('auth:ok', { role: 'admin' });
      socket.emit('state', views.adminState(engine.comp));
      registerAdminHandlers(socket);
      return;
    }

    if (role === 'player') {
      const group = Competition.findGroupByCode(engine.comp, auth.code);
      if (!group) {
        socket.emit('auth:error', { error: 'كود المجموعة غير صحيح أو لا توجد مسابقة نشطة' });
        socket.disconnect(true);
        return;
      }
      socket.data.groupId = group.id;
      socket.join(`group:${group.id}`);
      socket.emit('auth:ok', { role: 'player', groupId: group.id, name: group.name });
      socket.emit('state', views.playerState(engine.comp, group));
      registerPlayerHandlers(socket);
      return;
    }

    socket.emit('auth:error', { error: 'دور غير معروف' });
    socket.disconnect(true);
  });

  // ------- أوامر المجموعة -------
  function registerPlayerHandlers(socket) {
    socket.on('player:answer', (payload, ack) => {
      const groupId = socket.data.groupId;
      const { optionIndex } = payload || {};
      let result;
      try {
        result = engine.submitAnswer(groupId, optionIndex);
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      if (typeof ack === 'function') ack(result);
    });
  }

  // ------- أوامر المقدّم -------
  function registerAdminHandlers(socket) {
    const guard = (fn) => (payload, ack) => {
      try {
        const r = fn(payload || {});
        if (typeof ack === 'function') ack({ ok: true, data: r });
      } catch (err) {
        if (typeof ack === 'function') ack({ ok: false, error: err.message });
        else socket.emit('admin:error', { error: err.message });
      }
    };

    // إنشاء مسابقة جديدة
    socket.on('admin:create', guard((opts) => {
      engine.newCompetition(opts);
      return { id: engine.comp.id };
    }));

    // تحديث الإعدادات العامة
    socket.on('admin:updateSettings', guard((fields) => {
      const c = engine.requireComp();
      if (fields.name !== undefined && fields.name !== '') c.name = String(fields.name);
      if (fields.defaultTimeSec !== undefined && fields.defaultTimeSec !== '') {
        c.defaultTimeSec = Math.max(5, Math.min(300, Number(fields.defaultTimeSec) || 20));
      }
      if (fields.defaultPoints !== undefined && fields.defaultPoints !== '') {
        c.defaultPoints = Math.max(0, Math.min(100000, Number(fields.defaultPoints) || 1000));
      }
      if (fields.speedBonus !== undefined) c.speedBonus = !!fields.speedBonus;
      engine.emit('state');
    }));

    // إدارة الأسئلة
    socket.on('admin:question:add', guard((f) => {
      const c = engine.requireComp();
      const q = Competition.makeQuestion(f, { defaultTimeSec: c.defaultTimeSec, defaultPoints: c.defaultPoints });
      c.questions.push(q);
      engine.emit('state');
      return { id: q.id };
    }));
    socket.on('admin:question:update', guard((f) => {
      const c = engine.requireComp();
      const q = Competition.findQuestion(c, f.id);
      if (!q) throw new Error('السؤال غير موجود');
      if (f.text !== undefined) q.text = String(f.text);
      if (f.category !== undefined) q.category = String(f.category);
      if (f.options !== undefined || f.correctIndex !== undefined) {
        const sane = Competition.sanitizeOptions(
          f.options !== undefined ? f.options : q.options,
          f.correctIndex !== undefined ? f.correctIndex : q.correctIndex
        );
        q.options = sane.options;
        q.correctIndex = sane.correctIndex;
      }
      if (f.timeLimitSec !== undefined && f.timeLimitSec !== '') {
        q.timeLimitSec = Math.max(5, Math.min(300, Number(f.timeLimitSec) || c.defaultTimeSec));
      }
      if (f.points !== undefined && f.points !== '') {
        q.points = Math.max(0, Math.min(100000, Number(f.points) || c.defaultPoints));
      }
      engine.emit('state');
    }));
    socket.on('admin:question:remove', guard((f) => {
      const c = engine.requireComp();
      const idx = c.questions.findIndex((q) => q.id === f.id);
      if (idx < 0) return;
      c.questions.splice(idx, 1);
      // ضبط المؤشّر الحالي إن لزم
      if (c.currentIndex >= c.questions.length) c.currentIndex = c.questions.length - 1;
      engine.emit('state');
    }));
    socket.on('admin:question:move', guard((f) => {
      const c = engine.requireComp();
      const idx = c.questions.findIndex((q) => q.id === f.id);
      if (idx < 0) throw new Error('السؤال غير موجود');
      const dir = f.dir === 'up' ? -1 : 1;
      const target = idx + dir;
      if (target < 0 || target >= c.questions.length) return;
      const [q] = c.questions.splice(idx, 1);
      c.questions.splice(target, 0, q);
      engine.emit('state');
    }));

    // إدارة المجموعات (يمكن الإضافة في أي وقت حتى أثناء اللعب)
    socket.on('admin:group:add', guard((f) => {
      const c = engine.requireComp();
      const codes = new Set(c.groups.map((g) => g.code));
      const g = Competition.makeGroup(f.name || `المجموعة ${c.groups.length + 1}`, codes);
      c.groups.push(g);
      engine.emit('state');
      return { id: g.id, code: g.code };
    }));
    socket.on('admin:group:update', guard((f) => {
      const c = engine.requireComp();
      const g = Competition.findGroup(c, f.id);
      if (!g) throw new Error('المجموعة غير موجودة');
      if (f.name !== undefined) g.name = f.name;
      engine.emit('state');
    }));
    socket.on('admin:group:remove', guard((f) => {
      const c = engine.requireComp();
      c.groups = c.groups.filter((g) => g.id !== f.id);
      engine.emit('state');
    }));

    // النقاط (منح/خصم يدوي)
    socket.on('admin:score', guard((f) => {
      engine.adjustScore(f.groupId, f.amount);
    }));

    // التحكم في اللعبة
    socket.on('admin:start', guard(() => engine.start()));
    socket.on('admin:pause', guard(() => engine.pause()));
    socket.on('admin:resume', guard(() => engine.resume()));
    socket.on('admin:reveal', guard(() => engine.revealNow()));
    socket.on('admin:next', guard(() => engine.nextQuestion()));
    socket.on('admin:finish', guard(() => engine.finishNow()));
    socket.on('admin:reset', guard(() => {
      persist.clear();
      engine.setCompetition(null);
    }));

    // الرابط الأساسي
    socket.on('admin:setBaseUrl', guard((f) => {
      engine.baseUrl = (f.baseUrl || '').trim() || null;
      engine.emit('state');
    }));
  }

  return { pushAll };
}

module.exports = { attachSockets, ADMIN_PIN };
