'use strict';

const test = require('node:test');
const assert = require('node:assert');

const Competition = require('../server/engine/Competition');
const { scoreAnswer } = require('../server/engine/scoring');
const { GameEngine } = require('../server/engine/GameEngine');

test('createCompetition builds questions and groups with unique codes', () => {
  const c = Competition.createCompetition({ groupCount: 5, questionCount: 6 });
  assert.strictEqual(c.questions.length, 6);
  assert.strictEqual(c.groups.length, 5);
  const codes = new Set(c.groups.map((g) => g.code));
  assert.strictEqual(codes.size, 5, 'أكواد المجموعات فريدة');
  assert.strictEqual(c.groups[0].score, 0);
});

test('createCompetition can start empty when useSeed=false', () => {
  const c = Competition.createCompetition({ useSeed: false, groupCount: 2 });
  assert.strictEqual(c.questions.length, 0);
});

test('sanitizeOptions trims empties and clamps correctIndex', () => {
  const r = Competition.sanitizeOptions(['أ', '', 'ب', '  '], 5);
  assert.deepStrictEqual(r.options, ['أ', 'ب']);
  assert.strictEqual(r.correctIndex, 1); // مقصوص إلى آخر خيار متاح
});

test('scoreAnswer: wrong=0, correct without bonus = points', () => {
  const q = { points: 1000, timeLimitSec: 20 };
  assert.strictEqual(scoreAnswer(q, false, 20, true), 0);
  assert.strictEqual(scoreAnswer(q, true, 10, false), 1000);
});

test('scoreAnswer: speed bonus rewards faster answers (50%..100%)', () => {
  const q = { points: 1000, timeLimitSec: 20 };
  assert.strictEqual(scoreAnswer(q, true, 20, true), 1000); // فوري
  assert.strictEqual(scoreAnswer(q, true, 0, true), 500); // في آخر لحظة
  assert.strictEqual(scoreAnswer(q, true, 10, true), 750); // منتصف الوقت
});

test('full round: open, answer, reveal awards points to correct group', () => {
  const engine = new GameEngine();
  const c = engine.newCompetition({ groupCount: 2, useSeed: false, speedBonus: false });
  c.questions.push(Competition.makeQuestion({ text: 'س', options: ['أ', 'ب'], correctIndex: 0, points: 500, timeLimitSec: 30 }, {}));
  engine.start();
  assert.strictEqual(c.questionState, 'open');

  const [g1, g2] = c.groups;
  assert.ok(engine.submitAnswer(g1.id, 0).ok, 'إجابة صحيحة تُقبل');
  assert.ok(engine.submitAnswer(g2.id, 1).ok, 'إجابة خاطئة تُقبل');
  // لا يُسمح بالإجابة مرتين
  assert.strictEqual(engine.submitAnswer(g1.id, 1).ok, false);

  engine.revealNow();
  assert.strictEqual(c.questionState, 'revealed');
  assert.strictEqual(g1.score, 500, 'المجموعة الصحيحة تحصل على النقاط');
  assert.strictEqual(g2.score, 0, 'المجموعة الخاطئة صفر');
});

test('answers rejected when not open', () => {
  const engine = new GameEngine();
  const c = engine.newCompetition({ groupCount: 1, useSeed: false });
  c.questions.push(Competition.makeQuestion({ options: ['أ', 'ب'], correctIndex: 0 }, {}));
  const g = c.groups[0];
  assert.strictEqual(engine.submitAnswer(g.id, 0).ok, false, 'مغلق قبل البدء');
  engine.start();
  engine.pause();
  assert.strictEqual(engine.submitAnswer(g.id, 0).ok, false, 'مغلق أثناء الإيقاف');
});

test('nextQuestion advances then finishes at the end', () => {
  const engine = new GameEngine();
  const c = engine.newCompetition({ groupCount: 1, useSeed: false });
  c.questions.push(Competition.makeQuestion({ options: ['أ', 'ب'], correctIndex: 0 }, {}));
  c.questions.push(Competition.makeQuestion({ options: ['ج', 'د'], correctIndex: 1 }, {}));
  engine.start();
  assert.strictEqual(c.currentIndex, 0);
  engine.nextQuestion();
  assert.strictEqual(c.currentIndex, 1);
  engine.nextQuestion();
  assert.strictEqual(c.status, 'finished');
});

test('groups can be added mid-game with zero score', () => {
  const engine = new GameEngine();
  const c = engine.newCompetition({ groupCount: 1, useSeed: false });
  c.questions.push(Competition.makeQuestion({ options: ['أ', 'ب'], correctIndex: 0 }, {}));
  engine.start();
  const codes = new Set(c.groups.map((g) => g.code));
  const g = Competition.makeGroup('لاعب متأخر', codes);
  c.groups.push(g);
  assert.strictEqual(c.groups.length, 2);
  assert.strictEqual(g.score, 0);
});

test('adjustScore never goes below zero', () => {
  const engine = new GameEngine();
  const c = engine.newCompetition({ groupCount: 1, useSeed: false });
  const g = c.groups[0];
  engine.adjustScore(g.id, 300);
  assert.strictEqual(g.score, 300);
  engine.adjustScore(g.id, -1000);
  assert.strictEqual(g.score, 0);
});
