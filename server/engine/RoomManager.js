'use strict';

const crypto = require('crypto');
const { GameEngine } = require('./GameEngine');
const Competition = require('./Competition');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode(len = 4) {
  let s = '';
  for (let i = 0; i < len; i += 1) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

const ROOM_TTL_MS = 12 * 60 * 60 * 1000; // إزالة الغرف الخاملة بعد 12 ساعة

/**
 * يدير غرفًا مستقلة، كل غرفة لها محرّكها ومسابقتها ورمز دخول ورمز مضيف سري.
 */
class RoomManager {
  constructor() {
    this.rooms = new Map(); // code -> { code, hostToken, engine, createdAt, lastActive }
  }

  _uniqueCode() {
    let code = makeCode();
    while (this.rooms.has(code)) code = makeCode();
    return code;
  }

  /** ينشئ غرفة جديدة ومحرّكها ومسابقتها. */
  createRoom(opts = {}) {
    const code = this._uniqueCode();
    const hostToken = crypto.randomBytes(12).toString('hex');
    const engine = new GameEngine();
    engine.roomCode = code;
    engine.newCompetition(opts);
    engine.comp.room = code;
    const room = { code, hostToken, engine, createdAt: Date.now(), lastActive: Date.now() };
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code) {
    if (!code) return null;
    return this.rooms.get(String(code).trim().toUpperCase()) || null;
  }

  touch(code) {
    const r = this.getRoom(code);
    if (r) r.lastActive = Date.now();
  }

  removeRoom(code) {
    const r = this.getRoom(code);
    if (r) { r.engine._clearTimers(); this.rooms.delete(r.code); }
  }

  count() { return this.rooms.size; }

  /** يحذف الغرف الخاملة منذ TTL. */
  cleanupIdle() {
    const now = Date.now();
    for (const [code, r] of this.rooms) {
      if (now - r.lastActive > ROOM_TTL_MS) {
        r.engine._clearTimers();
        this.rooms.delete(code);
      }
    }
  }

  /** لقطة للحفظ. */
  serialize() {
    const out = [];
    for (const r of this.rooms.values()) {
      out.push({ code: r.code, hostToken: r.hostToken, createdAt: r.createdAt, lastActive: r.lastActive, comp: r.engine.comp });
    }
    return out;
  }

  /** يستعيد الغرف من لقطة محفوظة، ويستدعي wire لكل غرفة. */
  restore(arr, wire) {
    if (!Array.isArray(arr)) return 0;
    let n = 0;
    for (const item of arr) {
      if (!item || !item.code || !item.comp) continue;
      if (!Array.isArray(item.comp.questions) || !Array.isArray(item.comp.groups)) continue;
      if (item.comp.questions.length && typeof item.comp.questions[0].answer !== 'string') continue; // نمط قديم
      const engine = new GameEngine();
      engine.roomCode = item.code;
      item.comp.room = item.code;
      engine.loadCompetition(item.comp);
      const room = { code: item.code, hostToken: item.hostToken, engine, createdAt: item.createdAt || Date.now(), lastActive: item.lastActive || Date.now() };
      this.rooms.set(item.code, room);
      if (typeof wire === 'function') wire(item.code, engine);
      n += 1;
    }
    return n;
  }
}

module.exports = { RoomManager };
