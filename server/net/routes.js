'use strict';

const express = require('express');
const QRCode = require('qrcode');
const Competition = require('../engine/Competition');

function resolveBase(req) {
  const override = process.env.BASE_URL;
  if (override) return String(override).replace(/\/+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}
function joinUrl(req, roomCode) {
  return `${resolveBase(req)}/player?room=${encodeURIComponent(roomCode)}`;
}

function createRouter(roomManager, onRoomCreated) {
  const router = express.Router();

  router.get('/api/config', (req, res) => {
    res.json({ baseUrl: resolveBase(req), rooms: roomManager.count() });
  });

  // التصنيفات المتاحة للاختيار عند إنشاء اللعبة
  router.get('/api/categories', (req, res) => {
    res.json({ categories: Competition.listCategories() });
  });

  // إنشاء غرفة/لعبة جديدة → يصبح صاحبها مضيفًا
  router.post('/api/rooms', (req, res) => {
    try {
      const b = req.body || {};
      const opts = {
        name: (b.name || 'لعبة الأفخاخ').toString().slice(0, 40),
        categories: Array.isArray(b.categories) ? b.categories : [],
        difficulties: Array.isArray(b.difficulties) ? b.difficulties : [],
        questionCount: Number(b.questionCount) || 10,
        defaultTimeSec: Number(b.defaultTimeSec) || 45,
        defaultPoints: Number(b.defaultPoints) || 1000,
        speedBonus: b.speedBonus !== false,
        useSeed: true,
        groupCount: 0,
      };
      const room = roomManager.createRoom(opts);
      if (typeof onRoomCreated === 'function') onRoomCreated(room.code, room.engine);
      res.json({ ok: true, room: room.code, hostToken: room.hostToken, name: room.engine.comp.name, questions: room.engine.comp.questions.length });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // التحقق من وجود غرفة (لصفحة الانضمام)
  router.get('/api/rooms/:code', (req, res) => {
    const room = roomManager.getRoom(req.params.code);
    if (!room) return res.status(404).json({ ok: false, error: 'الغرفة غير موجودة' });
    res.json({ ok: true, room: room.code, name: room.engine.comp.name, status: room.engine.comp.status });
  });

  // انضمام مشارك بالاسم إلى غرفة
  router.post('/api/join', (req, res) => {
    const b = req.body || {};
    const room = roomManager.getRoom(b.room);
    if (!room) return res.status(404).json({ ok: false, error: 'الغرفة غير موجودة أو انتهت' });
    try {
      const group = room.engine.addGroup(b.name || '');
      res.json({ ok: true, room: room.code, code: group.code, groupId: group.id, name: group.name });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // رمز QR للانضمام إلى غرفة معيّنة
  router.get('/api/join-qr/:room.png', async (req, res) => {
    try {
      const url = joinUrl(req, req.params.room);
      const png = await QRCode.toBuffer(url, { type: 'png', width: 360, margin: 1, color: { dark: '#0b1220', light: '#ffffff' } });
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'no-store');
      res.send(png);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createRouter, resolveBase, joinUrl };
