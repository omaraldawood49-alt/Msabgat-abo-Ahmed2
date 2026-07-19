'use strict';

const test = require('node:test');
const assert = require('node:assert');

const Competition = require('../server/engine/Competition');
const { scoreAnswer } = require('../server/engine/scoring');
const { GameEngine } = require('../server/engine/GameEngine');
const { RoomManager } = require('../server/engine/RoomManager');

function newGame(opts) {
  const engine = new GameEngine();
  const c = engine.newCompetition(Object.assign({ useSeed: false, groupCount: 0 }, opts));
  return { engine, c };
}
function addQ(c, text, answer, extra) {
  const q = Competition.makeQuestion(Object.assign({ text, answer, points: 1000, timeLimitSec: 30 }, extra || {}), {});
  c.questions.push(q);
  return q;
}

test('createCompetition samples questions from library when useSeed', () => {
  const engine = new GameEngine();
  const c = engine.newCompetition({ useSeed: true, questionCount: 8, groupCount: 0 });
  assert.strictEqual(c.questions.length, 8);
  assert.ok(c.questions[0].text && typeof c.questions[0].answer === 'string');
});

test('empty seed starts with no questions', () => {
  const { c } = newGame();
  assert.strictEqual(c.questions.length, 0);
});

test('normalize matches despite spaces/punctuation/alef forms', () => {
  assert.strictEqual(Competition.normalize('  الرِّياض. '), Competition.normalize('الرياض'));
  assert.strictEqual(Competition.normalize('أحمد'), Competition.normalize('احمد'));
});

test('scoreAnswer speed bonus 50%..100%', () => {
  const q = { points: 1000, timeLimitSec: 20 };
  assert.strictEqual(scoreAnswer(q, true, 20, true), 1000);
  assert.strictEqual(scoreAnswer(q, true, 0, true), 500);
  assert.strictEqual(scoreAnswer(q, true, 10, false), 1000);
});

test('lie phase rejects the true answer and empty lies', () => {
  const { engine, c } = newGame();
  addQ(c, 'عاصمة السعودية؟', 'الرياض');
  const g = engine.addGroup('أ');
  engine.start();
  assert.strictEqual(c.questionState, 'lies');
  assert.strictEqual(engine.submitLie(g.id, '  الرياض ').ok, false, 'الجواب الصحيح مرفوض كلغم');
  assert.strictEqual(engine.submitLie(g.id, '').ok, false, 'اللغم الفارغ مرفوض');
  assert.ok(engine.submitLie(g.id, 'جدة').ok, 'لغم صالح يُقبل');
});

test('buildOptions merges identical lies and excludes truth-matching lies', () => {
  const { engine, c } = newGame();
  const q = addQ(c, 'س؟', 'الصحيح');
  const a = engine.addGroup('أ'), b = engine.addGroup('ب'), d = engine.addGroup('ج');
  engine.start();
  engine.submitLie(a.id, 'خطأ مشترك');
  engine.submitLie(b.id, 'خطأ مشترك'); // نفس اللغم يُدمج
  engine.submitLie(d.id, 'الصحيح'); // يطابق الجواب → يُستبعد
  engine.toPick();
  const opts = c.round.options;
  const truth = opts.filter((o) => o.kind === 'truth');
  const lies = opts.filter((o) => o.kind === 'lie');
  assert.strictEqual(truth.length, 1);
  assert.strictEqual(lies.length, 1, 'اللغمان المتطابقان يُدمجان في خيار واحد');
  assert.strictEqual(lies[0].owners.length, 2, 'الخيار المدموج له صاحبان');
});

test('mine scoring: truth pick scores; falling into a lie rewards its owner', () => {
  const { engine, c } = newGame({ speedBonus: false });
  const q = addQ(c, 'س؟', 'الصحيح', { points: 1000 });
  const a = engine.addGroup('أ'), b = engine.addGroup('ب'), d = engine.addGroup('ج');
  engine.start();
  engine.submitLie(a.id, 'فخ');        // لغم المجموعة أ
  engine.submitLie(b.id, 'شيء');
  engine.toPick();
  const truthOpt = c.round.options.find((o) => o.kind === 'truth');
  const trapA = c.round.options.find((o) => o.kind === 'lie' && o.owners.indexOf(a.id) !== -1);
  // ب تصيب الصحيح، ج تقع في لغم أ
  engine.submitPick(b.id, truthOpt.id);
  engine.submitPick(d.id, trapA.id);
  // أ لا يمكنها اختيار لغمها
  assert.strictEqual(engine.submitPick(a.id, trapA.id).ok, false, 'لا يختار المرء لغمه');
  engine.submitPick(a.id, truthOpt.id);
  engine.revealNow();
  assert.strictEqual(c.questionState, 'revealed');
  const byId = {}; c.groups.forEach((g) => (byId[g.id] = g.score));
  assert.strictEqual(byId[b.id], 1000, 'ب أصابت الصحيح');
  assert.strictEqual(byId[a.id], 1000 + 500, 'أ أصابت الصحيح + أوقعت ج في لغمها (نصف النقاط)');
  assert.strictEqual(byId[d.id], 0, 'ج وقعت في لغم');
});

test('answers rejected outside their phase', () => {
  const { engine, c } = newGame();
  addQ(c, 'س؟', 'ج');
  const g = engine.addGroup('أ');
  assert.strictEqual(engine.submitLie(g.id, 'x').ok, false, 'لا كتابة قبل البدء');
  engine.start();
  assert.strictEqual(engine.submitPick(g.id, 'opt_x').ok, false, 'لا اختيار في مرحلة الألغام');
});

test('nextQuestion advances then finishes', () => {
  const { engine, c } = newGame();
  addQ(c, 'س1', 'ج1');
  addQ(c, 'س2', 'ج2');
  engine.start();
  assert.strictEqual(c.currentIndex, 0);
  engine.nextQuestion();
  assert.strictEqual(c.currentIndex, 1);
  engine.nextQuestion();
  assert.strictEqual(c.status, 'finished');
});

test('groups self-join mid-game with zero score', () => {
  const { engine, c } = newGame();
  addQ(c, 'س', 'ج');
  engine.start();
  const g = engine.addGroup('متأخر');
  assert.strictEqual(g.score, 0);
  assert.ok(c.groups.indexOf(g) !== -1);
});

test('auto-advance: lies -> pick when all groups submit, pick -> reveal when all pick', () => {
  const { engine, c } = newGame({ speedBonus: false });
  addQ(c, 'س؟', 'الصحيح', { points: 1000 });
  const a = engine.addGroup('أ'), b = engine.addGroup('ب');
  engine.start();
  assert.strictEqual(c.questionState, 'lies');
  engine.submitLie(a.id, 'فخ');
  assert.strictEqual(c.questionState, 'lies', 'لا ينتقل قبل أن يُجيب الجميع');
  engine.submitLie(b.id, 'آخر');
  assert.strictEqual(c.questionState, 'pick', 'انتقل تلقائيًا بعد إجابة الجميع');

  const truth = c.round.options.find((o) => o.kind === 'truth');
  engine.submitPick(a.id, truth.id);
  assert.strictEqual(c.questionState, 'pick', 'لا يكشف قبل اختيار الجميع');
  engine.submitPick(b.id, truth.id);
  assert.strictEqual(c.questionState, 'revealed', 'كشف تلقائيًا بعد اختيار الجميع');
});

test('createCompetition filters by difficulty', () => {
  const engine = new GameEngine();
  const c = engine.newCompetition({ useSeed: true, questionCount: 8, difficulties: ['صعب'], groupCount: 0 });
  assert.ok(c.questions.length > 0);
  assert.ok(c.questions.every((q) => q.difficulty === 'صعب'), 'كل الأسئلة صعبة');
});

test('createCompetition filters by categories', () => {
  const cats = Competition.listCategories();
  assert.ok(cats.length > 0 && cats[0].name);
  const pick = cats[0].name;
  const engine = new GameEngine();
  const c = engine.newCompetition({ useSeed: true, questionCount: 10, categories: [pick], groupCount: 0 });
  assert.ok(c.questions.length > 0);
  assert.ok(c.questions.every((q) => q.category === pick), 'كل الأسئلة من التصنيف المختار');
});

test('RoomManager creates independent rooms with unique codes and host tokens', () => {
  const rm = new RoomManager();
  const a = rm.createRoom({ useSeed: false, groupCount: 0 });
  const b = rm.createRoom({ useSeed: false, groupCount: 0 });
  assert.notStrictEqual(a.code, b.code);
  assert.notStrictEqual(a.hostToken, b.hostToken);
  assert.strictEqual(rm.getRoom(a.code).engine.comp.room, a.code);
  // غرف مستقلة: مجموعة في A لا تظهر في B
  a.engine.addGroup('نمور');
  assert.strictEqual(a.engine.comp.groups.length, 1);
  assert.strictEqual(b.engine.comp.groups.length, 0);
});

test('restart keeps groups (reset scores) and re-samples questions', () => {
  const rm = new RoomManager();
  const room = rm.createRoom({ useSeed: true, questionCount: 5, groupCount: 0 });
  const g = room.engine.addGroup('فريق');
  room.engine.adjustScore(g.id, 500);
  room.engine.restart();
  const kept = room.engine.comp.groups.find((x) => x.name === 'فريق');
  assert.ok(kept, 'المجموعة باقية بعد إعادة اللعب');
  assert.strictEqual(kept.score, 0, 'النقاط صُفّرت');
  assert.strictEqual(room.engine.comp.currentIndex, -1);
});
