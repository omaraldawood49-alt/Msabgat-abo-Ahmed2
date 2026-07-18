'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { RoomManager } = require('../server/engine/RoomManager');

test('room codes are unique and group codes are globally unique across rooms', () => {
  const rm = new RoomManager();
  const a = rm.createRoom({ groupCount: 3, stockCount: 3 });
  const b = rm.createRoom({ groupCount: 3, stockCount: 3 });
  assert.notStrictEqual(a.id, b.id, 'room ids differ');
  const codesA = a.engine.comp.groups.map((g) => g.code);
  const codesB = b.engine.comp.groups.map((g) => g.code);
  const overlap = codesA.filter((c) => codesB.includes(c));
  assert.strictEqual(overlap.length, 0, 'group codes unique across rooms');
});

test('findByGroupCode routes to the correct room', () => {
  const rm = new RoomManager();
  const a = rm.createRoom({ groupCount: 2, stockCount: 2 });
  const b = rm.createRoom({ groupCount: 2, stockCount: 2 });
  const codeB = b.engine.comp.groups[0].code;
  const found = rm.findByGroupCode(codeB);
  assert.ok(found, 'group found');
  assert.strictEqual(found.room.id, b.id, 'routed to room B');
});

test('snapshot/restore preserves room, host key, and group progress (survives restart)', () => {
  const rm = new RoomManager();
  const room = rm.createRoom({ groupCount: 1, stockCount: 2, initialCapital: 10000 });
  const comp = room.engine.comp;
  const g = comp.groups[0];
  const s = comp.stocks[0];
  // نحاكي جولة جارية وشراءً
  comp.status = 'running'; comp.currentRound = 2; comp.roundState = 'open';
  room.engine._setPaused(false);
  const r = room.engine.trade(g.id, s.id, 'buy', 5);
  assert.ok(r.ok, 'trade ok');
  const cashAfter = g.cash;

  // نحاكي إعادة تشغيل الخادم: لقطة ثم مدير غرف جديد يستعيد منها
  const snap = rm.snapshot();
  const rm2 = new RoomManager();
  rm2.restore(snap);

  const room2 = rm2.get(room.id);
  assert.ok(room2, 'room restored after restart');
  assert.strictEqual(room2.hostKey, room.hostKey, 'host key preserved');
  const g2 = room2.engine.comp.groups[0];
  assert.strictEqual(g2.cash, cashAfter, 'group cash preserved across restart');
  assert.strictEqual(g2.holdings[s.id], 5, 'group holdings preserved across restart');
  assert.strictEqual(room2.engine.comp.currentRound, 2, 'round number preserved');
  // جولة كانت مفتوحة → تُستأنف موقوفة للأمان
  assert.strictEqual(room2.engine.paused, true, 'open round resumes paused after restart');
});

test('removed room stops timers and disappears', () => {
  const rm = new RoomManager();
  const room = rm.createRoom({ groupCount: 1, stockCount: 1 });
  rm.remove(room.id);
  assert.strictEqual(rm.get(room.id), null, 'room removed');
});
