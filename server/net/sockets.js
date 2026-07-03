'use strict';

const Competition = require('../engine/Competition');
const views = require('./views');
const persist = require('../state/persist');

const ADMIN_PIN = process.env.ADMIN_PIN || '1234';

/**
 * يربط طبقة Socket.IO بمحرّك اللعبة:
 *  - غرف: display / admin / group:<id>
 *  - بثّ مُفلتر حسب الدور
 *  - استقبال أوامر الأدمن وصفقات المتسابقين
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
    // نبضة خفيفة للمؤقّت فقط (بدون إعادة بثّ الحالة كاملة)
    io.emit('tick', { timeLeft, currentRound: engine.comp ? engine.comp.currentRound : 0 });
  });
  engine.on('round:open', ({ round }) => {
    io.emit('round:open', { round, durationSec: engine.comp.roundDurationSec });
  });
  engine.on('round:transition', ({ round, moves, news }) => {
    io.emit('round:transition', {
      round,
      moves,
      news,
      transitionMs: require('../engine/GameEngine').TRANSITION_MS,
    });
  });
  engine.on('competition:finished', ({ podium }) => {
    io.emit('competition:finished', { podium, name: engine.comp.name });
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
        socket.emit('auth:error', { error: 'رمز الأدمن غير صحيح' });
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
        socket.emit('auth:error', { error: 'كود المجموعة غير صحيح أو لا توجد منافسة نشطة' });
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

  // ------- أوامر المتسابق -------
  function registerPlayerHandlers(socket) {
    socket.on('player:trade', (payload, ack) => {
      const groupId = socket.data.groupId;
      const { stockId, side, qty } = payload || {};
      let result;
      try {
        result = engine.trade(groupId, stockId, side, qty);
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      if (typeof ack === 'function') {
        if (result.ok) {
          ack({ ok: true, cash: result.group.cash });
        } else {
          ack({ ok: false, error: result.error });
        }
      }
    });
  }

  // ------- أوامر الأدمن -------
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

    // إنشاء منافسة جديدة
    socket.on('admin:create', guard((opts) => {
      engine.newCompetition(opts);
      return { id: engine.comp.id };
    }));

    // تحديث الإعدادات العامة (قبل بدء المنافسة يفضَّل)
    socket.on('admin:updateSettings', guard((fields) => {
      const c = engine.requireComp();
      const allowed = ['name', 'rounds', 'roundDurationSec', 'initialCapital', 'pricingMode'];
      for (const k of allowed) {
        if (fields[k] !== undefined && fields[k] !== null && fields[k] !== '') {
          c[k] = k === 'name' || k === 'pricingMode' ? fields[k] : Number(fields[k]);
        }
      }
      engine.emit('state');
    }));

    // إدارة الأسهم
    socket.on('admin:stock:add', guard((f) => {
      const c = engine.requireComp();
      const stock = Competition.makeStock(f.name || 'سهم جديد', Number(f.price) || 10);
      c.stocks.push(stock);
      engine.emit('state');
      return { id: stock.id };
    }));
    socket.on('admin:stock:update', guard((f) => {
      const c = engine.requireComp();
      const s = Competition.findStock(c, f.id);
      if (!s) throw new Error('السهم غير موجود');
      if (f.name !== undefined) s.name = f.name;
      if (f.price !== undefined && f.price !== '') {
        const p = Number(f.price);
        // قبل بدء المنافسة: تعديل سعر البداية يعدّل السعر الحالي أيضًا
        if (c.currentRound === 0) {
          s.startPrice = p;
          s.price = p;
          s.prevPrice = p;
        } else {
          s.price = p;
        }
      }
      engine.emit('state');
    }));
    socket.on('admin:stock:remove', guard((f) => {
      const c = engine.requireComp();
      c.stocks = c.stocks.filter((s) => s.id !== f.id);
      // إزالة هذا السهم من محافظ المجموعات
      for (const g of c.groups) delete g.holdings[f.id];
      engine.emit('state');
    }));
    socket.on('admin:stock:manual', guard((f) => {
      const c = engine.requireComp();
      const s = Competition.findStock(c, f.id);
      if (!s) throw new Error('السهم غير موجود');
      if (Array.isArray(f.manualChanges)) {
        s.manualChanges = f.manualChanges.map((x) => Number(x) || 0);
      }
      engine.emit('state');
    }));

    // إدارة المجموعات
    socket.on('admin:group:add', guard((f) => {
      const c = engine.requireComp();
      const codes = new Set(c.groups.map((g) => g.code));
      const g = Competition.makeGroup(f.name || `المجموعة ${c.groups.length + 1}`, c.initialCapital, codes);
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

    // المال
    socket.on('admin:cash', guard((f) => {
      engine.adjustCash(f.groupId, f.amount);
    }));

    // التحكم في الجولات
    socket.on('admin:start', guard(() => engine.start()));
    socket.on('admin:pause', guard(() => engine.pause()));
    socket.on('admin:resume', guard(() => engine.resume()));
    socket.on('admin:endRound', guard(() => engine.endRoundNow()));
    socket.on('admin:nextRound', guard(() => engine.nextRound()));
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
