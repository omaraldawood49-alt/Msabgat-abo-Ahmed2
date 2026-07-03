'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const FILE = path.join(DATA_DIR, 'competition.json');

let _timer = null;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/** حفظ لقطة المنافسة (debounced لتفادي كثرة الكتابة). */
function save(comp) {
  if (!comp) return;
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(() => {
    try {
      ensureDir();
      const snapshot = { savedAt: Date.now(), comp };
      fs.writeFileSync(FILE, JSON.stringify(snapshot), 'utf8');
    } catch (err) {
      console.error('[persist] فشل الحفظ:', err.message);
    }
  }, 400);
}

/** حفظ فوري (يُستخدم عند الإيقاف). */
function saveNow(comp) {
  if (!comp) return;
  try {
    ensureDir();
    fs.writeFileSync(FILE, JSON.stringify({ savedAt: Date.now(), comp }), 'utf8');
  } catch (err) {
    console.error('[persist] فشل الحفظ الفوري:', err.message);
  }
}

/** تحميل آخر لقطة محفوظة إن وُجدت. */
function load() {
  try {
    if (!fs.existsSync(FILE)) return null;
    const raw = fs.readFileSync(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && parsed.comp ? parsed.comp : null;
  } catch (err) {
    console.error('[persist] فشل التحميل:', err.message);
    return null;
  }
}

function clear() {
  try {
    if (fs.existsSync(FILE)) fs.unlinkSync(FILE);
  } catch (err) {
    console.error('[persist] فشل الحذف:', err.message);
  }
}

module.exports = { save, saveNow, load, clear, FILE };
