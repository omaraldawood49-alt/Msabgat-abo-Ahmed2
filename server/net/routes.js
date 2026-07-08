'use strict';

const express = require('express');
const QRCode = require('qrcode');
const Competition = require('../engine/Competition');

/**
 * يبني الرابط الأساسي (Base URL) بأولوية:
 *   1) تجاوز الأدمن اليدوي (engine.baseUrl)
 *   2) متغير البيئة BASE_URL
 *   3) الاكتشاف التلقائي من ترويسات الطلب (يدعم البروكسي السحابي)
 */
function resolveBase(engine, req) {
  const override = engine.baseUrl || process.env.BASE_URL;
  if (override) return String(override).replace(/\/+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

function joinUrl(engine, req, code) {
  return `${resolveBase(engine, req)}/player?code=${encodeURIComponent(code)}`;
}

function createRouter(engine) {
  const router = express.Router();

  // إعدادات عامة للواجهات
  router.get('/api/config', (req, res) => {
    res.json({
      baseUrl: resolveBase(engine, req),
      hasCompetition: !!engine.comp,
      requiresPin: !!process.env.ADMIN_PIN,
    });
  });

  // التحقق من صحة كود مجموعة (تستخدمه صفحة المتسابق قبل الاتصال)
  router.get('/api/group/:code', (req, res) => {
    if (!engine.comp) return res.status(404).json({ ok: false, error: 'لا توجد منافسة نشطة' });
    const group = Competition.findGroupByCode(engine.comp, req.params.code);
    if (!group) return res.status(404).json({ ok: false, error: 'كود المجموعة غير صحيح' });
    res.json({ ok: true, groupId: group.id, name: group.name, competition: engine.comp.name });
  });

  // رابط انضمام المجموعة (لنسخه من لوحة الأدمن)
  router.get('/api/join-url/:code', (req, res) => {
    res.json({ url: joinUrl(engine, req, req.params.code) });
  });

  // رمز QR بصيغة PNG لكل مجموعة عبر كودها
  router.get('/api/qr/:code.png', async (req, res) => {
    try {
      const url = joinUrl(engine, req, req.params.code);
      const png = await QRCode.toBuffer(url, {
        type: 'png',
        width: 320,
        margin: 1,
        color: { dark: '#0b1220', light: '#ffffff' },
      });
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'no-store');
      res.send(png);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // رمز QR كـ data-url (للاستخدام داخل صفحات العرض إن لزم)
  router.get('/api/qr-data/:code', async (req, res) => {
    try {
      const url = joinUrl(engine, req, req.params.code);
      const dataUrl = await QRCode.toDataURL(url, { width: 320, margin: 1 });
      res.json({ dataUrl, url });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createRouter, resolveBase, joinUrl };
