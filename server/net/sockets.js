'use strict';

const Competition = require('../engine/Competition');
const views = require('./views');
const persist = require('../state/persist');

/**
 * طبقة Socket.IO المدركة للغرف:
 *  - كل غرفة لها قنواتها: room:<code> (عام) / display:<code> / admin:<code> / group:<code>:<gid>
 *  - المضيف يتحقّق برمز الغرفة + رمز المضيف السري (hostToken)
 *  - المشارك يتحقّق برمز الغرفة + كود مجموعته
 */
function attachSockets(io, roomManager) {
  function broadcast(code) {
    const room = roomManager.getRoom(code);
    if (!room) return;
    const comp = room.engine.comp;
    io.to('display:' + code).emit('state', views.displayState(comp));
    io.to('admin:' + code).emit('state', views.adminState(comp));
    for (const g of comp.groups) io.to('group:' + code + ':' + g.id).emit('state', views.playerState(comp, g));
  }

  // يربط أحداث محرّك غرفة معيّنة بالبثّ لقنواتها
  function wireRoom(code, engine) {
    engine.on('state', () => {
      roomManager.touch(code);
      broadcast(code);
      persist.saveRooms(roomManager.serialize());
    });
    engine.on('tick', ({ timeLeft }) => io.to('room:' + code).emit('tick', { timeLeft }));
    engine.on('question:open', () => io.to('room:' + code).emit('question:open', {}));
    engine.on('question:pick', () => io.to('room:' + code).emit('question:pick', {}));
    engine.on('question:reveal', () => io.to('room:' + code).emit('question:reveal', {}));
    engine.on('competition:finished', ({ standings, podium }) =>
      io.to('room:' + code).emit('competition:finished', { standings, podium, name: engine.comp.name }));
  }

  io.on('connection', (socket) => {
    const auth = socket.handshake.auth || {};
    const role = auth.role;
    const room = roomManager.getRoom(auth.room);
    if (!room) {
      socket.emit('auth:error', { error: 'الغرفة غير موجودة أو انتهت' });
      socket.disconnect(true);
      return;
    }
    const code = room.code;
    const engine = room.engine;
    socket.data.room = code;
    socket.join('room:' + code);

    if (role === 'display') {
      socket.join('display:' + code);
      socket.emit('state', views.displayState(engine.comp));
      return;
    }

    if (role === 'admin') {
      if (String(auth.hostToken || '') !== String(room.hostToken)) {
        socket.emit('auth:error', { error: 'لست مضيف هذه اللعبة' });
        socket.disconnect(true);
        return;
      }
      socket.join('admin:' + code);
      socket.emit('auth:ok', { role: 'admin', room: code });
      socket.emit('state', views.adminState(engine.comp));
      registerAdminHandlers(socket, engine, code);
      return;
    }

    if (role === 'player') {
      const group = Competition.findGroupByCode(engine.comp, auth.code);
      if (!group) {
        socket.emit('auth:error', { error: 'انتهت جلستكم — أعيدوا الدخول' });
        socket.disconnect(true);
        return;
      }
      socket.data.groupId = group.id;
      socket.join('group:' + code + ':' + group.id);
      socket.emit('auth:ok', { role: 'player', room: code, groupId: group.id, name: group.name });
      socket.emit('state', views.playerState(engine.comp, group));
      registerPlayerHandlers(socket, engine);
      return;
    }

    socket.emit('auth:error', { error: 'دور غير معروف' });
    socket.disconnect(true);
  });

  // ------- أوامر المشارك -------
  function registerPlayerHandlers(socket, engine) {
    socket.on('player:lie', (payload, ack) => {
      let r;
      try { r = engine.submitLie(socket.data.groupId, (payload || {}).text); }
      catch (err) { r = { ok: false, error: err.message }; }
      if (typeof ack === 'function') ack(r);
    });
    socket.on('player:pick', (payload, ack) => {
      let r;
      try { r = engine.submitPick(socket.data.groupId, (payload || {}).optionId); }
      catch (err) { r = { ok: false, error: err.message }; }
      if (typeof ack === 'function') ack(r);
    });
  }

  // ------- أوامر المضيف -------
  function registerAdminHandlers(socket, engine, code) {
    const guard = (fn) => (payload, ack) => {
      try {
        const r = fn(payload || {});
        if (typeof ack === 'function') ack({ ok: true, data: r });
      } catch (err) {
        if (typeof ack === 'function') ack({ ok: false, error: err.message });
        else socket.emit('admin:error', { error: err.message });
      }
    };

    socket.on('admin:updateSettings', guard((f) => {
      const c = engine.requireComp();
      if (f.name !== undefined && f.name !== '') c.name = String(f.name);
      if (f.defaultTimeSec !== undefined && f.defaultTimeSec !== '') c.defaultTimeSec = Math.max(5, Math.min(300, Number(f.defaultTimeSec) || 45));
      if (f.defaultPoints !== undefined && f.defaultPoints !== '') c.defaultPoints = Math.max(0, Math.min(100000, Number(f.defaultPoints) || 1000));
      if (f.speedBonus !== undefined) c.speedBonus = !!f.speedBonus;
      engine.emit('state');
    }));

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
      if (f.answer !== undefined) q.answer = String(f.answer).trim();
      if (f.category !== undefined) q.category = String(f.category);
      if (f.timeLimitSec !== undefined && f.timeLimitSec !== '') q.timeLimitSec = Math.max(5, Math.min(300, Number(f.timeLimitSec) || c.defaultTimeSec));
      if (f.points !== undefined && f.points !== '') q.points = Math.max(0, Math.min(100000, Number(f.points) || c.defaultPoints));
      engine.emit('state');
    }));
    // إضافة دفعة أسئلة: كل سطر «السؤال | الجواب» (فاصل | أو = أو تبويب)، أو «السؤال؟ الجواب»
    socket.on('admin:question:addBulk', guard((f) => {
      const c = engine.requireComp();
      const lines = String(f.text || '').split(/\r?\n/);
      let added = 0;
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        let text = null;
        let answer = null;
        const sep = line.match(/^(.*?)\s*[|=\t]\s*(.+)$/);
        if (sep) { text = sep[1].trim(); answer = sep[2].trim(); }
        else {
          const q = line.match(/^(.*[؟?])\s*(.+)$/); // ينتهي السؤال بعلامة استفهام ثم الجواب
          if (q) { text = q[1].trim(); answer = q[2].trim(); }
        }
        if (!text || !answer) continue;
        if (!/[؟?]$/.test(text)) text += '؟';
        c.questions.push(Competition.makeQuestion(
          { text: text, answer: answer, category: f.category || 'أسئلتي' },
          { defaultTimeSec: c.defaultTimeSec, defaultPoints: c.defaultPoints }
        ));
        added += 1;
      }
      if (added) engine.emit('state');
      return { added: added };
    }));
    socket.on('admin:question:remove', guard((f) => {
      const c = engine.requireComp();
      const idx = c.questions.findIndex((q) => q.id === f.id);
      if (idx < 0) return;
      c.questions.splice(idx, 1);
      if (c.currentIndex >= c.questions.length) c.currentIndex = c.questions.length - 1;
      engine.emit('state');
    }));
    socket.on('admin:question:move', guard((f) => {
      const c = engine.requireComp();
      const idx = c.questions.findIndex((q) => q.id === f.id);
      if (idx < 0) throw new Error('السؤال غير موجود');
      const target = idx + (f.dir === 'up' ? -1 : 1);
      if (target < 0 || target >= c.questions.length) return;
      const [q] = c.questions.splice(idx, 1);
      c.questions.splice(target, 0, q);
      engine.emit('state');
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
    socket.on('admin:score', guard((f) => engine.adjustScore(f.groupId, f.amount)));

    socket.on('admin:start', guard(() => engine.start()));
    socket.on('admin:pause', guard(() => engine.pause()));
    socket.on('admin:resume', guard(() => engine.resume()));
    socket.on('admin:toPick', guard(() => engine.toPick()));
    socket.on('admin:reveal', guard(() => engine.revealNow()));
    socket.on('admin:next', guard(() => engine.nextQuestion()));
    socket.on('admin:finish', guard(() => engine.finishNow()));
    socket.on('admin:restart', guard(() => engine.restart()));
    socket.on('admin:close', guard(() => {
      io.to('room:' + code).emit('room:closed', {});
      roomManager.removeRoom(code);
      persist.saveRooms(roomManager.serialize());
    }));
  }

  return { wireRoom, broadcast };
}

module.exports = { attachSockets };
