'use strict';

const EventEmitter = require('events');
const { GameEngine } = require('./GameEngine');
const Competition = require('./Competition');

const ROOM_TTL_MS = 6 * 60 * 60 * 1000; // حذف الغرف الخاملة بعد 6 ساعات

/**
 * يدير عدة غرف متزامنة، كل غرفة = محرّك لعبة ومنافسة مستقلّة.
 * أحداث: 'room:new' (room), 'room:remove' (roomId)
 */
class RoomManager extends EventEmitter {
  constructor() {
    super();
    this.rooms = new Map(); // roomId -> { id, engine, hostKey, createdAt, lastActive }
  }

  _newRoomId() {
    let id;
    do { id = Competition.makeCode(4); } while (this.rooms.has(id));
    return id;
  }

  /** كل أكواد المجموعات عبر جميع الغرف (لضمان تفرّدها). */
  allGroupCodes() {
    const s = new Set();
    for (const r of this.rooms.values()) {
      const comp = r.engine.comp;
      if (comp) comp.groups.forEach((g) => s.add(g.code));
    }
    return s;
  }

  createRoom(opts = {}) {
    const id = this._newRoomId();
    const engine = new GameEngine();
    const comp = Competition.createCompetition(
      Object.assign({}, opts, { reservedCodes: this.allGroupCodes() })
    );
    engine.setCompetition(comp);
    const room = { id, engine, hostKey: Competition.makeCode(6), createdAt: Date.now(), lastActive: Date.now() };
    this.rooms.set(id, room);
    this.emit('room:new', room);
    return room;
  }

  get(id) {
    if (!id) return null;
    return this.rooms.get(String(id).trim().toUpperCase()) || null;
  }

  touch(id) {
    const r = this.get(id);
    if (r) r.lastActive = Date.now();
  }

  /** يبحث عن مجموعة بكودها عبر كل الغرف (الأكواد فريدة عالميًا). */
  findByGroupCode(code) {
    if (!code) return null;
    const norm = String(code).trim().toUpperCase();
    for (const r of this.rooms.values()) {
      const comp = r.engine.comp;
      if (!comp) continue;
      const g = comp.groups.find((x) => x.code === norm);
      if (g) return { room: r, group: g };
    }
    return null;
  }

  remove(id) {
    const r = this.get(id);
    if (!r) return;
    if (typeof r.engine._clearTimers === 'function') r.engine._clearTimers();
    this.rooms.delete(r.id);
    this.emit('room:remove', r.id);
  }

  cleanup() {
    const now = Date.now();
    for (const [id, r] of this.rooms) {
      if (now - r.lastActive > ROOM_TTL_MS) this.remove(id);
    }
  }

  count() { return this.rooms.size; }

  /** لقطة لكل الغرف للحفظ على القرص. */
  snapshot() {
    return Array.from(this.rooms.values()).map((r) => ({
      id: r.id, hostKey: r.hostKey, createdAt: r.createdAt, lastActive: r.lastActive, comp: r.engine.comp,
    }));
  }

  /** إعادة بناء الغرف من لقطة محفوظة (تُبثّ 'room:new' لتوصيلها). */
  restore(list) {
    if (!Array.isArray(list)) return;
    for (const snap of list) {
      if (!snap || !snap.id || !snap.comp) continue;
      const engine = new GameEngine();
      engine.loadCompetition(snap.comp);
      const room = {
        id: String(snap.id).toUpperCase(), engine, hostKey: snap.hostKey || Competition.makeCode(6),
        createdAt: snap.createdAt || Date.now(), lastActive: snap.lastActive || Date.now(),
      };
      this.rooms.set(room.id, room);
      this.emit('room:new', room);
    }
  }
}

module.exports = { RoomManager, ROOM_TTL_MS };
