'use strict';

const { SEED_QUESTIONS } = require('./seedQuestions');
const { clampInt } = require('./scoring');

let _seq = 1;
function uid(prefix) {
  _seq += 1;
  return `${prefix}_${Date.now().toString(36)}${_seq.toString(36)}`;
}

// كود دخول قصير (احتياطي) — الانضمام الأساسي بالاسم عبر QR
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode(len = 4) {
  let s = '';
  for (let i = 0; i < len; i += 1) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return s;
}

/** تطبيع نص للمقارنة (لكشف تطابق اللغم مع الصحيح أو دمج الألغام المتشابهة). */
function normalize(text) {
  return String(text == null ? '' : text)
    .trim()
    .toLowerCase()
    .replace(/[ً-ْٰ]/g, '') // إزالة التشكيل
    .replace(/\s+/g, ' ')
    .replace(/[.،؛!?؟"'`ـ]/g, '')
    // توحيد بعض الحروف العربية الشائعة
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}

function makeQuestion(fields = {}, defaults = {}) {
  return {
    id: uid('q'),
    text: String(fields.text || 'سؤال جديد').trim(),
    answer: String(fields.answer || '').trim(),
    category: String(fields.category || '').trim(),
    difficulty: String(fields.difficulty || '').trim(),
    timeLimitSec: clampInt(fields.timeLimitSec, 5, 300, defaults.defaultTimeSec || 45),
    points: clampInt(fields.points, 0, 100000, defaults.defaultPoints || 1000),
  };
}

function makeGroup(name, existingCodes = new Set()) {
  let code = makeCode();
  while (existingCodes.has(code)) code = makeCode();
  return {
    id: uid('grp'),
    name,
    code,
    score: 0,
    joinedAt: Date.now(),
  };
}

/** يخلط مصفوفة (Fisher–Yates). */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** يختار عيّنة عشوائية بحجم n من مصفوفة. */
function sample(arr, n) {
  return shuffle(arr).slice(0, Math.max(0, n));
}

/**
 * ينشئ مسابقة أسئلة جديدة (نمط اللغم).
 */
function createCompetition(opts = {}) {
  const {
    name = 'لعبة الأفخاخ',
    defaultTimeSec = 45,
    defaultPoints = 1000,
    speedBonus = true,
    groupCount = 0,
    useSeed = true,
    questionCount = 10,
    categories = [],
    difficulties = [],
  } = opts;

  const defaults = { defaultTimeSec, defaultPoints };
  const cats = Array.isArray(categories) ? categories.filter(Boolean) : [];
  const diffs = Array.isArray(difficulties) ? difficulties.filter(Boolean) : [];
  let pool = SEED_QUESTIONS;
  if (cats.length) pool = pool.filter((q) => cats.indexOf(q.category) !== -1);
  if (diffs.length) pool = pool.filter((q) => diffs.indexOf(q.difficulty) !== -1);
  if (!pool.length) pool = SEED_QUESTIONS;
  const questions = useSeed
    ? sample(pool, clampInt(questionCount, 1, 50, 10)).map((q) => makeQuestion(q, defaults))
    : [];

  const codes = new Set();
  const groups = [];
  for (let i = 1; i <= groupCount; i += 1) {
    const g = makeGroup(`المجموعة ${i}`, codes);
    codes.add(g.code);
    groups.push(g);
  }

  return {
    id: uid('cmp'),
    name,
    defaultTimeSec: clampInt(defaultTimeSec, 5, 300, 45),
    defaultPoints: clampInt(defaultPoints, 0, 100000, 1000),
    speedBonus: speedBonus !== false,
    categories: cats,
    difficulties: diffs,
    questions,
    groups,

    // حالة التشغيل
    status: 'setup', // setup | running | finished
    currentIndex: -1, // -1 = لم تبدأ
    // المراحل: idle | lies (كتابة الألغام) | pick (الاختيار) | revealed
    questionState: 'idle',
    timeLeft: 0,

    // حالة الجولة الحالية
    round: emptyRound(),

    createdAt: Date.now(),
  };
}

/** قائمة التصنيفات المتاحة في المكتبة مع عدد الأسئلة (للاختيار عند الإنشاء). */
let _catCache = null;
function listCategories() {
  if (_catCache) return _catCache;
  const map = new Map();
  for (const q of SEED_QUESTIONS) {
    map.set(q.category, (map.get(q.category) || 0) + 1);
  }
  _catCache = Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .filter((c) => c.count >= 10)
    .sort((a, b) => b.count - a.count);
  return _catCache;
}

function emptyRound() {
  return {
    lies: {}, // groupId -> { text, norm }
    options: [], // [{ id, text, kind:'truth'|'lie', owners:[groupId] }]
    picks: {}, // groupId -> optionId
    awarded: {}, // groupId -> نقاط هذه الجولة (للعرض بعد الكشف)
  };
}

// -------------------- عمليات مساعدة --------------------

function findQuestion(comp, questionId) {
  return comp.questions.find((q) => q.id === questionId) || null;
}
function findGroup(comp, groupId) {
  return comp.groups.find((g) => g.id === groupId) || null;
}
function findGroupByCode(comp, code) {
  if (!code) return null;
  const norm = String(code).trim().toUpperCase();
  return comp.groups.find((g) => g.code === norm) || null;
}
function currentQuestion(comp) {
  if (!comp || comp.currentIndex < 0 || comp.currentIndex >= comp.questions.length) return null;
  return comp.questions[comp.currentIndex];
}

/**
 * يبني خيارات مرحلة الاختيار: الجواب الصحيح + ألغام المجموعات (مع دمج المتشابه).
 * يُستبعد أي لغم يطابق الجواب الصحيح.
 */
function buildOptions(comp, question) {
  const truthNorm = normalize(question.answer);
  const map = new Map(); // norm -> option
  // الصحيح أولًا
  map.set(truthNorm, { id: uid('opt'), text: question.answer, kind: 'truth', owners: [] });
  for (const [groupId, lie] of Object.entries(comp.round.lies)) {
    const norm = lie.norm;
    if (norm === truthNorm) continue; // طابَق الصحيح — لا يُضاف
    if (map.has(norm)) {
      const opt = map.get(norm);
      if (opt.kind === 'lie') opt.owners.push(groupId);
      // لو طابق الصحيح تجاهلناه أعلاه
    } else {
      map.set(norm, { id: uid('opt'), text: lie.text, kind: 'lie', owners: [groupId] });
    }
  }
  return shuffle(Array.from(map.values()));
}

function findOption(comp, optionId) {
  return (comp.round.options || []).find((o) => o.id === optionId) || null;
}

/** هل يملك المجموعة هذا الخيار (لغمها)؟ */
function ownsOption(option, groupId) {
  return option && option.kind === 'lie' && option.owners.indexOf(groupId) !== -1;
}

/** ملخّص المجموعات مرتّبًا بالنقاط تنازليًا. */
function groupsSummary(comp) {
  const rows = comp.groups.map((g) => ({
    id: g.id,
    name: g.name,
    code: g.code,
    score: g.score || 0,
  }));
  rows.sort((a, b) => b.score - a.score);
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });
  return rows;
}

module.exports = {
  uid,
  makeCode,
  normalize,
  makeQuestion,
  makeGroup,
  createCompetition,
  listCategories,
  emptyRound,
  findQuestion,
  findGroup,
  findGroupByCode,
  currentQuestion,
  buildOptions,
  findOption,
  ownsOption,
  groupsSummary,
};
