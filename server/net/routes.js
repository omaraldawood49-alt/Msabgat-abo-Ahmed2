'use strict';

const express = require('express');
const QRCode = require('qrcode');
const settings = require('../state/settings');

/**
 * يبني الرابط الأساسي بأولوية: تجاوز يدوي → BASE_URL → اكتشاف تلقائي من الطلب.
 */
function resolveBase(req) {
  const override = settings.baseUrl;
  if (override) return String(override).replace(/\/+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}
function joinUrl(req, code) {
  return `${resolveBase(req)}/player?code=${encodeURIComponent(code)}`;
}

function createRouter(rm) {
  const router = express.Router();

  // فحص صحّة سريع (يستخدمه منبّه الإبقاء يقظًا)
  router.get('/healthz', (req, res) => res.type('text').send('ok'));

  router.get('/api/config', (req, res) => {
    res.json({ baseUrl: resolveBase(req), rooms: rm.count() });
  });

  // التحقق من وجود غرفة (تستخدمه شاشة العرض)
  router.get('/api/room/:roomId', (req, res) => {
    const r = rm.get(req.params.roomId);
    if (!r) return res.status(404).json({ ok: false, error: 'الغرفة غير موجودة' });
    res.json({ ok: true, roomId: r.id, name: r.engine.comp ? r.engine.comp.name : 'بورصة رواحل' });
  });

  // التحقق من كود مجموعة (يبحث عبر كل الغرف)
  router.get('/api/group/:code', (req, res) => {
    const found = rm.findByGroupCode(req.params.code);
    if (!found) return res.status(404).json({ ok: false, error: 'كود المجموعة غير صحيح' });
    res.json({ ok: true, roomId: found.room.id, groupId: found.group.id, name: found.group.name });
  });

  // رابط انضمام المجموعة
  router.get('/api/join-url/:code', (req, res) => {
    res.json({ url: joinUrl(req, req.params.code) });
  });

  // رمز QR (PNG) لكل مجموعة عبر كودها
  router.get('/api/qr/:code.png', async (req, res) => {
    try {
      const png = await QRCode.toBuffer(joinUrl(req, req.params.code), {
        type: 'png', width: 320, margin: 1, color: { dark: '#141c2e', light: '#ffffff' },
      });
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'no-store');
      res.send(png);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // باركود شاشة العرض لغرفة (يفتح /display?room=ID عند مسحه)
  router.get('/api/room-qr/:roomId.png', async (req, res) => {
    const r = rm.get(req.params.roomId);
    if (!r) return res.status(404).json({ error: 'الغرفة غير موجودة' });
    try {
      const url = `${resolveBase(req)}/display?room=${encodeURIComponent(r.id)}`;
      const png = await QRCode.toBuffer(url, { type: 'png', width: 340, margin: 1, color: { dark: '#141c2e', light: '#ffffff' } });
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'no-store');
      res.send(png);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ضبط الرابط الأساسي يدويًا (عام لكل الغرف)
  router.post('/api/base-url', express.json(), (req, res) => {
    settings.baseUrl = (req.body && req.body.baseUrl ? String(req.body.baseUrl).trim() : '') || null;
    res.json({ ok: true, baseUrl: settings.baseUrl });
  });

  return router;
}

module.exports = { createRouter, resolveBase, joinUrl };
