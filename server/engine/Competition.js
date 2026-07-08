'use strict';

const { SEED_QUESTIONS } = require('./seedQuestions');
const { clampInt } = require('./scoring');

let _seq = 1;
function uid(prefix) {
  _seq += 1;
  return `${prefix}_${Date.now().toString(36)}${_seq.toString(36)}`;
}

// كود دخول قصير سهل الإدخال (بدون أحرف ملتبسة مثل O/0/I/1)
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode(len = 4) {
  let s = '';
  for (let i = 0; i < len; i += 1) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return s;
}

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 4;

/** ينظّف خيارات سؤال ويضبط رقم الخيار الصحيح ضمن الحدود. */
function sanitizeOptions(options, correctIndex) {
  let opts = (Array.isArray(options) ? options : [])
    .map((o) => String(o == null ? '' : o).trim())
    .filter((o) => o.length > 0)
    .slice(0, MAX_OPTIONS);
  while (opts.length < MIN_OPTIONS) opts.push(`خيار ${opts.length + 1}`);
  let ci = clampInt(correctIndex, 0, opts.length - 1, 0);
  return { options: opts, correctIndex: ci };
}

function makeQuestion(fields = {}, defaults = {}) {
  const { options, correctIndex } = sanitizeOptions(
    fields.options && fields.options.length ? fields.options : ['', '', '', ''],
    fields.correctIndex
  );
  return {
    id: uid('q'),
    text: String(fields.text || 'سؤال جديد').trim(),
    options,
    correctIndex,
    category: String(fields.category || '').trim(),
    timeLimitSec: clampInt(fields.timeLimitSec, 5, 300, defaults.defaultTimeSec || 20),
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
    streak: 0,
    answers: {}, // { [questionId]: { optionIndex, atTimeLeft, correct, awarded } }
    joinedAt: Date.now(),
  };
}

/**
 * ينشئ مسابقة أسئلة جديدة بالإعدادات المُمرّرة.
 */
function createCompetition(opts = {}) {
  const {
    name = 'مسابقة الأسئلة',
    defaultTimeSec = 20,
    defaultPoints = 1000,
    speedBonus = true,
    groupCount = 4,
    useSeed = true,
    questionCount = SEED_QUESTIONS.length,
  } = opts;

  const defaults = { defaultTimeSec, defaultPoints };
  const questions = useSeed
    ? SEED_QUESTIONS.slice(0, Math.max(1, Math.min(questionCount, SEED_QUESTIONS.length))).map(
        (q) => makeQuestion(q, defaults)
      )
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
    defaultTimeSec: clampInt(defaultTimeSec, 5, 300, 20),
    defaultPoints: clampInt(defaultPoints, 0, 100000, 1000),
    speedBonus: speedBonus !== false,
    questions,
    groups,

    // حالة التشغيل
    status: 'setup', // setup | running | finished
    currentIndex: -1, // -1 = لم تبدأ؛ وإلا فهرس السؤال الحالي
    questionState: 'idle', // idle | open | revealed
    timeLeft: 0,

    createdAt: Date.now(),
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

/** السؤال الحالي (أو null إذا لم تبدأ/انتهت). */
function currentQuestion(comp) {
  if (!comp || comp.currentIndex < 0 || comp.currentIndex >= comp.questions.length) return null;
  return comp.questions[comp.currentIndex];
}

/** توزيع عدد الإجابات على كل خيار للسؤال المُمرَّر. */
function optionTally(comp, question) {
  const tally = new Array(question.options.length).fill(0);
  let answered = 0;
  for (const g of comp.groups) {
    const a = g.answers[question.id];
    if (a && a.optionIndex != null && a.optionIndex >= 0 && a.optionIndex < tally.length) {
      tally[a.optionIndex] += 1;
      answered += 1;
    }
  }
  return { tally, answered };
}

/**
 * ملخّص المجموعات مرتّبًا بالنقاط تنازليًا مع رقم الترتيب.
 */
function groupsSummary(comp) {
  const rows = comp.groups.map((g) => ({
    id: g.id,
    name: g.name,
    code: g.code,
    score: g.score || 0,
    streak: g.streak || 0,
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
  makeQuestion,
  makeGroup,
  sanitizeOptions,
  createCompetition,
  findQuestion,
  findGroup,
  findGroupByCode,
  currentQuestion,
  optionTally,
  groupsSummary,
  MIN_OPTIONS,
  MAX_OPTIONS,
};
