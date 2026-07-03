'use strict';

const test = require('node:test');
const assert = require('node:assert');

const Competition = require('../server/engine/Competition');
const pricing = require('../server/engine/pricing');
const { GameEngine } = require('../server/engine/GameEngine');

test('createCompetition builds stocks and groups with unique codes', () => {
  const c = Competition.createCompetition({ groupCount: 5, stockCount: 8, initialCapital: 50000 });
  assert.strictEqual(c.stocks.length, 8);
  assert.strictEqual(c.groups.length, 5);
  const codes = new Set(c.groups.map((g) => g.code));
  assert.strictEqual(codes.size, 5, 'أكواد المجموعات فريدة');
  assert.strictEqual(c.groups[0].cash, 50000);
});

test('trade buy/sell updates cash, holdings and flow', () => {
  const engine = new GameEngine();
  const c = engine.newCompetition({ groupCount: 1, stockCount: 3, initialCapital: 10000 });
  c.status = 'running'; c.currentRound = 1; c.roundState = 'open'; engine._setPaused(false);
  const g = c.groups[0];
  const s = c.stocks[0];

  let r = engine.trade(g.id, s.id, 'buy', 10);
  assert.ok(r.ok, 'شراء ناجح');
  assert.strictEqual(g.holdings[s.id], 10);
  assert.strictEqual(g.cash, pricing.round2(10000 - s.price * 10));
  assert.strictEqual(c.roundFlow[s.id], 10);

  r = engine.trade(g.id, s.id, 'sell', 4);
  assert.ok(r.ok);
  assert.strictEqual(g.holdings[s.id], 6);
  assert.strictEqual(c.roundFlow[s.id], 6);
});

test('trade rejects insufficient cash and shares', () => {
  const engine = new GameEngine();
  const c = engine.newCompetition({ groupCount: 1, stockCount: 1, initialCapital: 100 });
  c.status = 'running'; c.currentRound = 1; c.roundState = 'open'; engine._setPaused(false);
  const g = c.groups[0];
  const s = c.stocks[0];
  s.price = 50;
  let r = engine.trade(g.id, s.id, 'buy', 100);
  assert.strictEqual(r.ok, false, 'يُرفض الشراء بلا رصيد كافٍ');
  r = engine.trade(g.id, s.id, 'sell', 1);
  assert.strictEqual(r.ok, false, 'يُرفض البيع بلا أسهم');
});

test('trade blocked when market closed', () => {
  const engine = new GameEngine();
  const c = engine.newCompetition({ groupCount: 1, stockCount: 1 });
  c.roundState = 'transition';
  const r = engine.trade(c.groups[0].id, c.stocks[0].id, 'buy', 1);
  assert.strictEqual(r.ok, false);
});

test('auto pricing: net demand pushes price up', () => {
  const c = Competition.createCompetition({ stockCount: 1, pricingMode: 'auto' });
  const s = c.stocks[0];
  const start = s.price;
  c.roundFlow[s.id] = 20; // طلب صافٍ موجب
  pricing.stepPrices(c, 1);
  assert.ok(s.price > start, 'ارتفع السعر مع الطلب');
  assert.strictEqual(s.direction, 'up');
});

test('manual pricing cycles every 10 rounds', () => {
  const c = Competition.createCompetition({ stockCount: 1, pricingMode: 'manual' });
  const s = c.stocks[0];
  s.manualChanges = new Array(10).fill(0);
  s.manualChanges[0] = 10; // الجولة 1 و 11: +10%
  const p0 = s.price;
  pricing.stepPrices(c, 1);
  const afterR1 = s.price;
  assert.ok(Math.abs(afterR1 - p0 * 1.1) < 0.5, 'الجولة 1 ترفع 10%');
  // تقديم لعدة جولات حتى الجولة 11
  for (let round = 2; round <= 10; round++) pricing.stepPrices(c, round);
  const before11 = s.price;
  pricing.stepPrices(c, 11);
  assert.ok(s.price > before11, 'الجولة 11 تكرر نمط الجولة 1 (ارتفاع)');
});

test('no-flat rule forces movement after two flat rounds', () => {
  const c = Competition.createCompetition({ stockCount: 1, pricingMode: 'manual' });
  const s = c.stocks[0];
  s.manualChanges = new Array(10).fill(0); // كلها 0% → ثبات
  pricing.stepPrices(c, 1);
  assert.strictEqual(s.direction, 'flat');
  assert.strictEqual(s.flatStreak, 1);
  pricing.stepPrices(c, 2);
  assert.strictEqual(s.flatStreak, 2);
  pricing.stepPrices(c, 3); // يجب أن يُجبر على الحركة
  assert.notStrictEqual(s.direction, 'flat', 'أُجبر السهم على الحركة في الجولة الثالثة');
  assert.strictEqual(s.flatStreak, 0);
});

test('groupsSummary ranks by wealth and computes pnl', () => {
  const c = Competition.createCompetition({ groupCount: 2, stockCount: 1, initialCapital: 1000 });
  const [g1, g2] = c.groups;
  const s = c.stocks[0];
  s.price = 100;
  g1.cash = 500; g1.holdings[s.id] = 10; // ثروة = 500 + 1000 = 1500
  g2.cash = 800; // ثروة = 800
  const rows = Competition.groupsSummary(c);
  assert.strictEqual(rows[0].id, g1.id, 'الأعلى ثروة أولًا');
  assert.strictEqual(rows[0].wealth, 1500);
  assert.strictEqual(rows[0].pnl, 500);
  assert.strictEqual(rows[1].wealth, 800);
  assert.strictEqual(rows[1].pnl, -200);
});

test('adjustCash ALL adds to every group and never goes negative', () => {
  const engine = new GameEngine();
  const c = engine.newCompetition({ groupCount: 2, initialCapital: 100 });
  engine.adjustCash('ALL', 50);
  assert.strictEqual(c.groups[0].cash, 150);
  engine.adjustCash(c.groups[0].id, -1000);
  assert.strictEqual(c.groups[0].cash, 0, 'لا يهبط النقد تحت الصفر');
});

test('price never drops below MIN_PRICE', () => {
  const c = Competition.createCompetition({ stockCount: 1, pricingMode: 'manual' });
  const s = c.stocks[0];
  s.price = 2;
  s.manualChanges = new Array(10).fill(-90);
  pricing.stepPrices(c, 1);
  assert.ok(s.price >= pricing.MIN_PRICE, 'السعر لا يقل عن الحد الأدنى');
});
