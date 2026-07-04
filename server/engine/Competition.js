'use strict';

const { SEED_STOCKS } = require('./seedStocks');
const { round2 } = require('./pricing');

let _seq = 1;
function uid(prefix) {
  _seq += 1;
  return `${prefix}_${Date.now().toString(36)}${_seq.toString(36)}`;
}

// كود دخول قصير سهل الإدخال (بدون أحرف ملتبسة مثل O/0/I/1)
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode(len = 5) {
  let s = '';
  for (let i = 0; i < len; i += 1) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return s;
}

function makeStock(name, price) {
  return {
    id: uid('stk'),
    name,
    startPrice: round2(price),
    price: round2(price),
    prevPrice: round2(price),
    direction: 'flat',
    lastChangePct: 0,
    flatStreak: 0,
    // نِسَب التغير اليدوية لأول 10 جولات (النمط اليدوي) — تبدأ أصفارًا
    manualChanges: new Array(10).fill(0),
  };
}

function makeGroup(name, initialCapital, existingCodes = new Set()) {
  let code = makeCode();
  while (existingCodes.has(code)) code = makeCode();
  return {
    id: uid('grp'),
    name,
    code,
    initialCapital: round2(initialCapital),
    cash: round2(initialCapital),
    holdings: {}, // { stockId: qty }
  };
}

/**
 * ينشئ منافسة جديدة بالإعدادات المُمرّرة.
 */
function createCompetition(opts = {}) {
  const {
    name = 'بورصة رواحل',
    rounds = 10,
    roundDurationSec = 90,
    groupCount = 4,
    initialCapital = 100000,
    stockCount = SEED_STOCKS.length,
    pricingMode = 'auto',
  } = opts;

  const stocks = SEED_STOCKS.slice(0, Math.max(1, Math.min(stockCount, SEED_STOCKS.length))).map(
    (s) => makeStock(s.name, s.price)
  );

  const codes = new Set();
  const groups = [];
  for (let i = 1; i <= groupCount; i += 1) {
    const g = makeGroup(`المجموعة ${i}`, initialCapital, codes);
    codes.add(g.code);
    groups.push(g);
  }

  return {
    id: uid('cmp'),
    name,
    rounds,
    roundDurationSec,
    initialCapital: round2(initialCapital),
    pricingMode, // 'auto' | 'manual'
    autoConfig: null, // يمكن تخصيصه لاحقًا
    stocks,
    groups,

    // حالة التشغيل
    status: 'setup', // setup | running | finished
    currentRound: 0, // 0 = لم تبدأ
    roundState: 'idle', // idle | open | closed | transition
    timeLeft: 0,

    // تجميع تدفّق التداول للجولة الحالية (للنمط التلقائي): { stockId: netQty }
    roundFlow: {},

    news: ['مرحبًا بكم في بورصة رواحل — استعدوا لبدء التداول!'],
    lastMoves: [],
    createdAt: Date.now(),
  };
}

// -------------------- عمليات مساعدة على المنافسة --------------------

function findStock(comp, stockId) {
  return comp.stocks.find((s) => s.id === stockId) || null;
}

function findGroup(comp, groupId) {
  return comp.groups.find((g) => g.id === groupId) || null;
}

function findGroupByCode(comp, code) {
  if (!code) return null;
  const norm = String(code).trim().toUpperCase();
  return comp.groups.find((g) => g.code === norm) || null;
}

/** القيمة السوقية لمحفظة مجموعة (مجموع الكميات × الأسعار الحالية). */
function portfolioValue(comp, group) {
  let total = 0;
  for (const [stockId, qty] of Object.entries(group.holdings || {})) {
    const stock = findStock(comp, stockId);
    if (stock && qty > 0) total += stock.price * qty;
  }
  return round2(total);
}

/** إجمالي الثروة = النقد + القيمة السوقية للمحفظة. */
function totalWealth(comp, group) {
  return round2(group.cash + portfolioValue(comp, group));
}

/**
 * ملخّص كامل لكل المجموعات (للأدمن فقط) مع الترتيب والأرباح/الخسائر.
 */
function groupsSummary(comp) {
  const rows = comp.groups.map((g) => {
    const pv = portfolioValue(comp, g);
    const wealth = round2(g.cash + pv);
    const pnl = round2(wealth - g.initialCapital);
    const pnlPct = g.initialCapital > 0 ? round2((pnl / g.initialCapital) * 100) : 0;
    return {
      id: g.id,
      name: g.name,
      code: g.code,
      cash: round2(g.cash),
      portfolioValue: pv,
      wealth,
      pnl,
      pnlPct,
      holdings: Object.assign({}, g.holdings),
    };
  });
  rows.sort((a, b) => b.wealth - a.wealth);
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });
  return rows;
}

module.exports = {
  uid,
  makeCode,
  makeStock,
  makeGroup,
  createCompetition,
  findStock,
  findGroup,
  findGroupByCode,
  portfolioValue,
  totalWealth,
  groupsSummary,
};
