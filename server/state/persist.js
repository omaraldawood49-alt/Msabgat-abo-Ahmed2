'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const FILE = path.join(DATA_DIR, 'rooms.json');

let _timer = null;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** حفظ لقطة كل الغرف (debounced). */
function save(rooms) {
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(() => saveNow(rooms), 400);
}

function saveNow(rooms) {
  try {
    ensureDir();
    fs.writeFileSync(FILE, JSON.stringify({ savedAt: Date.now(), rooms: rooms || [] }), 'utf8');
  } catch (err) {
    console.error('[persist] فشل الحفظ:', err.message);
  }
}

/** تحميل لقطة الغرف (مصفوفة). */
function load() {
  try {
    if (!fs.existsSync(FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return parsed && Array.isArray(parsed.rooms) ? parsed.rooms : [];
  } catch (err) {
    console.error('[persist] فشل التحميل:', err.message);
    return [];
  }
}

function clear() {
  try { if (fs.existsSync(FILE)) fs.unlinkSync(FILE); } catch (err) { /* ignore */ }
}

module.exports = { save, saveNow, load, clear, FILE };
