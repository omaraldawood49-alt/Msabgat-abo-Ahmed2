'use strict';

const Competition = require('../engine/Competition');
const { TRANSITION_MS } = require('../engine/GameEngine');
const views = require('./views');
const persist = require('../state/persist');

/**
 * يربط Socket.IO بمدير الغرف (متعدد الغرف).
 * قنوات لكل غرفة: room:<id> (عام) ، display:<id> ، admin:<id> ، group:<groupId>
 */
function attachSockets(io, rm) {
  // ---------- البثّ لكل غرفة ----------
  function pushDisplay(id) {
    const r = rm.get(id);
    if (r) io.to('display:' + id).emit('state', views.displayState(r.engine.comp));
  }
  function pushAdmin(id) {
    const r = rm.get(id);
    if (r) io.to('admin:' + id).emit('state', views.adminState(r.engine.comp));
  }
  function pushGroups(id) {
    const r = rm.get(id);
    if (!r || !r.engine.comp) return;
    for (const g of r.engine.comp.groups) {
      io.to('group:' + g.id).emit('state', views.playerState(r.engine.comp, g));
    }
  }
  function pushAll(id) { pushDisplay(id); pushAdmin(id); pushGroups(id); }

  // ---------- ربط أحداث محرّك غرفة ----------
  function wire(room) {
    const id = room.id;
    const engine = room.engine;
    engine.on('state', () => { pushAll(id); rm.touch(id); persist.save(rm.snapshot()); });
    engine.on('tick', ({ timeLeft }) => {
      io.to('room:' + id).emit('tick', { timeLeft, currentRound: engine.comp ? engine.comp.currentRound : 0 });
    });
    engine.on('round:open', ({ round }) => {
      io.to('room:' + id).emit('round:open', { round, durationSec: engine.comp.roundDurationSec });
    });
    engine.on('round:transition', ({ round, moves, news }) => {
      io.to('room:' + id).emit('round:transition', { round, moves, news, transitionMs: TRANSITION_MS });
    });
    engine.on('competition:finished', ({ standings, podium }) => {
      io.to('room:' + id).emit('competition:finished', { standings, podium, name: engine.comp.name });
    });
  }
  for (const room of rm.rooms.values()) wire(room);
  rm.on('room:new', wire);
  rm.on('room:remove', (id) => { io.to('room:' + id).emit('room:closed', {}); });

  // ---------- الاتصال ----------
  io.on('connection', (socket) => {
    const auth = socket.handshake.auth || {};
    const role = auth.role;

    if (role === 'display') {
      const r = rm.get(auth.roomId);
      if (!r) { socket.emit('auth:error', { error: 'الغرفة غير موجودة أو انتهت' }); return socket.disconnect(true); }
      socket.data.roomId = r.id;
      socket.join('room:' + r.id);
      socket.join('display:' + r.id);
      rm.touch(r.id);
      socket.emit('auth:ok', { role: 'display', roomId: r.id });
      socket.emit('state', views.displayState(r.engine.comp));
      return;
    }

    if (role === 'player') {
      const found = rm.findByGroupCode(auth.code);
      if (!found) { socket.emit('auth:error', { error: 'كود المجموعة غير صحيح أو لا توجد غرفة نشطة' }); return socket.disconnect(true); }
      const { room, group } = found;
      socket.data.roomId = room.id;
      socket.data.groupId = group.id;
      socket.join('room:' + room.id);
      socket.join('group:' + group.id);
      rm.touch(room.id);
      socket.emit('auth:ok', { role: 'player', roomId: room.id, groupId: group.id, name: group.name });
      socket.emit('state', views.playerState(room.engine.comp, group));
      registerPlayer(socket);
      return;
    }

    if (role === 'admin') {
      // ربط بغرفة قائمة إن مُرِّر رمز التحكم
      if (auth.roomId && auth.hostKey) {
        const res = attachAdmin(socket, auth.roomId, auth.hostKey);
        if (res.ok) socket.emit('auth:ok', { role: 'admin', roomId: res.room.id });
        else socket.emit('auth:error', res);
      } else {
        socket.emit('auth:ok', { role: 'admin' }); // بلا غرفة بعد — سينشئ واحدة
      }
      registerAdmin(socket);
      return;
    }

    socket.emit('auth:error', { error: 'دور غير معروف' });
    socket.disconnect(true);
  });

  // ---------- مساعد ربط الأدمن بغرفة ----------
  function attachAdmin(socket, roomId, hostKey) {
    const r = rm.get(roomId);
    if (!r) return { ok: false, error: 'الغرفة غير موجودة' };
    if (String(r.hostKey) !== String(hostKey)) return { ok: false, error: 'رمز التحكم غير صحيح' };
    socket.data.roomId = r.id;
    socket.data.isHost = true;
    socket.join('room:' + r.id);
    socket.join('admin:' + r.id);
    socket.emit('state', views.adminState(r.engine.comp));
    return { ok: true, room: r };
  }

  // ---------- أوامر المتسابق ----------
  function registerPlayer(socket) {
    socket.on('player:trade', (payload, ack) => {
      const r = rm.get(socket.data.roomId);
      const { stockId, side, qty } = payload || {};
      let result;
      try { result = r ? r.engine.trade(socket.data.groupId, stockId, side, qty) : { ok: false, error: 'الغرفة غير متاحة' }; }
      catch (err) { result = { ok: false, error: err.message }; }
      if (typeof ack === 'function') {
        ack(result.ok ? { ok: true, cash: result.group.cash } : { ok: false, error: result.error });
      }
    });
  }

  // ---------- أوامر الأدمن ----------
  function registerAdmin(socket) {
    const guard = (fn) => (payload, ack) => {
      try {
        const r = fn(payload || {});
        if (typeof ack === 'function') ack({ ok: true, data: r });
      } catch (err) {
        if (typeof ack === 'function') ack({ ok: false, error: err.message });
        else socket.emit('admin:error', { error: err.message });
      }
    };
    // ينفّذ على محرّك غرفة الأدمن الحالية (لا بد أن يكون مالكها)
    const room = () => {
      const r = rm.get(socket.data.roomId);
      if (!r || !socket.data.isHost) throw new Error('لا توجد غرفة نشطة — أنشئ غرفة أولًا');
      return r;
    };
    const engine = () => room().engine;

    // إنشاء غرفة جديدة
    socket.on('admin:createRoom', guard((opts) => {
      const r = rm.createRoom(opts);
      socket.data.roomId = r.id;
      socket.data.isHost = true;
      socket.join('room:' + r.id);
      socket.join('admin:' + r.id);
      r.engine.emit('state');
      return { roomId: r.id, hostKey: r.hostKey };
    }));

    // الانضمام لغرفة قائمة (جهاز آخر) برمز التحكم
    socket.on('admin:attachRoom', guard((f) => {
      const res = attachAdmin(socket, f.roomId, f.hostKey);
      if (!res.ok) throw new Error(res.error);
      return { roomId: res.room.id };
    }));

    // إغلاق/حذف الغرفة
    socket.on('admin:closeRoom', guard(() => {
      const r = room();
      rm.remove(r.id);
      persist.save(rm.snapshot());
      socket.data.roomId = null; socket.data.isHost = false;
    }));

    // الإعدادات العامة
    socket.on('admin:updateSettings', guard((f) => {
      const c = engine().requireComp();
      const allowed = ['name', 'rounds', 'roundDurationSec', 'initialCapital', 'pricingMode'];
      for (const k of allowed) {
        if (f[k] !== undefined && f[k] !== null && f[k] !== '') {
          c[k] = (k === 'name' || k === 'pricingMode') ? f[k] : Number(f[k]);
        }
      }
      engine().emit('state');
    }));

    // الأسهم
    socket.on('admin:stock:add', guard((f) => {
      const c = engine().requireComp();
      const stock = Competition.makeStock(f.name || 'سهم جديد', Number(f.price) || 10);
      c.stocks.push(stock);
      engine().emit('state');
      return { id: stock.id };
    }));
    socket.on('admin:stock:update', guard((f) => {
      const c = engine().requireComp();
      const s = Competition.findStock(c, f.id);
      if (!s) throw new Error('السهم غير موجود');
      if (f.name !== undefined) s.name = f.name;
      if (f.price !== undefined && f.price !== '') {
        const p = Number(f.price);
        if (c.currentRound === 0) { s.startPrice = p; s.price = p; s.prevPrice = p; }
        else s.price = p;
      }
      engine().emit('state');
    }));
    socket.on('admin:stock:remove', guard((f) => {
      const c = engine().requireComp();
      c.stocks = c.stocks.filter((s) => s.id !== f.id);
      for (const g of c.groups) delete g.holdings[f.id];
      engine().emit('state');
    }));
    socket.on('admin:stock:manual', guard((f) => {
      const c = engine().requireComp();
      const s = Competition.findStock(c, f.id);
      if (!s) throw new Error('السهم غير موجود');
      if (Array.isArray(f.manualChanges)) s.manualChanges = f.manualChanges.map((x) => Number(x) || 0);
      engine().emit('state');
    }));

    // المجموعات (أكواد فريدة عبر كل الغرف)
    socket.on('admin:group:add', guard((f) => {
      const c = engine().requireComp();
      const codes = rm.allGroupCodes();
      const g = Competition.makeGroup(f.name || `المجموعة ${c.groups.length + 1}`, c.initialCapital, codes);
      c.groups.push(g);
      engine().emit('state');
      return { id: g.id, code: g.code };
    }));
    socket.on('admin:group:update', guard((f) => {
      const g = Competition.findGroup(engine().requireComp(), f.id);
      if (!g) throw new Error('المجموعة غير موجودة');
      if (f.name !== undefined) g.name = f.name;
      engine().emit('state');
    }));
    socket.on('admin:group:remove', guard((f) => {
      const c = engine().requireComp();
      c.groups = c.groups.filter((g) => g.id !== f.id);
      engine().emit('state');
    }));

    // المال
    socket.on('admin:cash', guard((f) => { engine().adjustCash(f.groupId, f.amount); }));

    // التحكم في الجولات
    socket.on('admin:start', guard(() => engine().start()));
    socket.on('admin:pause', guard(() => engine().pause()));
    socket.on('admin:resume', guard(() => engine().resume()));
    socket.on('admin:endRound', guard(() => engine().endRoundNow()));
    socket.on('admin:nextRound', guard(() => engine().nextRound()));
    socket.on('admin:finish', guard(() => engine().finishNow()));
    socket.on('admin:reset', guard(() => {
      // إعادة تعيين = إغلاق الغرفة الحالية
      const r = room();
      rm.remove(r.id);
      persist.save(rm.snapshot());
      socket.data.roomId = null; socket.data.isHost = false;
    }));
  }

  return { pushAll };
}

module.exports = { attachSockets };
