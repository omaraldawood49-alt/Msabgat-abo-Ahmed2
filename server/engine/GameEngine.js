'use strict';

const EventEmitter = require('events');
const Competition = require('./Competition');
const { scoreAnswer } = require('./scoring');

/**
 * محرّك لعبة «اللغم» (على غرار Fibbage):
 *  لكل سؤال ثلاث مراحل:
 *   1) lies  : يظهر السؤال بلا خيارات، وتكتب كل مجموعة جوابًا مضلِّلًا (لغمًا).
 *   2) pick  : تظهر كل الألغام + الجواب الصحيح مخلوطة، وتختار كل مجموعة إجابة.
 *   3) revealed : يُكشف الصحيح، وتُحتسب النقاط.
 *
 * النقاط:
 *   - اختيار الجواب الصحيح: نقاط السؤال (مع مكافأة سرعة اختيارية).
 *   - وقوع مجموعة أخرى في لغمك: تكسب صاحبة اللغم نصف نقاط السؤال عن كل من وقع فيه.
 */
class GameEngine extends EventEmitter {
  constructor() {
    super();
    this.comp = null;
    this._tickTimer = null;
    this.paused = false;
    this.baseUrl = null;
  }

  _setPaused(v) {
    this.paused = v;
    if (this.comp) this.comp._paused = v;
  }

  // -------------------- إدارة المسابقة --------------------

  setCompetition(comp) {
    this._clearTimers();
    this.comp = comp;
    this._setPaused(false);
    this.emit('state');
  }

  newCompetition(opts) {
    const comp = Competition.createCompetition(opts);
    this.setCompetition(comp);
    return comp;
  }

  loadCompetition(comp) {
    this._clearTimers();
    this.comp = comp;
    if (!comp.round) comp.round = Competition.emptyRound();
    this._setPaused(comp.questionState === 'lies' || comp.questionState === 'pick');
    this.emit('state');
  }

  requireComp() {
    if (!this.comp) throw new Error('لا توجد مسابقة نشطة');
    return this.comp;
  }

  // -------------------- دورة حياة السؤال --------------------

  start() {
    const comp = this.requireComp();
    if (comp.status === 'finished') throw new Error('انتهت المسابقة بالفعل');
    if (!comp.questions.length) throw new Error('أضِف سؤالًا واحدًا على الأقل قبل البدء');
    if (comp.currentIndex < 0) {
      comp.status = 'running';
      comp.currentIndex = 0;
      this._openQuestion();
    } else if (this.paused) {
      this.resume();
    }
    return comp;
  }

  _openQuestion() {
    const comp = this.comp;
    const q = Competition.currentQuestion(comp);
    if (!q) return this._finish();
    comp.status = 'running';
    comp.questionState = 'lies';
    comp.timeLeft = q.timeLimitSec;
    comp.round = Competition.emptyRound();
    this._setPaused(false);
    this.emit('question:open', { index: comp.currentIndex, phase: 'lies' });
    this.emit('state');
    this._startTicking();
  }

  _startTicking() {
    this._clearTickTimer();
    this._tickTimer = setInterval(() => {
      const comp = this.comp;
      if (!comp || this.paused) return;
      if (comp.questionState !== 'lies' && comp.questionState !== 'pick') return;
      comp.timeLeft -= 1;
      if (comp.timeLeft <= 0) {
        comp.timeLeft = 0;
        this.emit('tick', { timeLeft: 0 });
        if (comp.questionState === 'lies') this._toPick();
        else this._reveal();
      } else {
        this.emit('tick', { timeLeft: comp.timeLeft });
      }
    }, 1000);
    if (typeof this._tickTimer.unref === 'function') this._tickTimer.unref();
  }

  pause() {
    const comp = this.requireComp();
    if (comp.questionState !== 'lies' && comp.questionState !== 'pick') return comp;
    this._setPaused(true);
    this.emit('state');
    return comp;
  }
  resume() {
    const comp = this.requireComp();
    if (comp.questionState !== 'lies' && comp.questionState !== 'pick') return comp;
    this._setPaused(false);
    this.emit('state');
    return comp;
  }

  /** الانتقال من مرحلة كتابة الألغام إلى مرحلة الاختيار. */
  toPick() {
    const comp = this.requireComp();
    if (comp.questionState === 'lies') this._toPick();
    return comp;
  }
  _toPick() {
    const comp = this.comp;
    const q = Competition.currentQuestion(comp);
    if (!q) return this._finish();
    comp.round.options = Competition.buildOptions(comp, q);
    comp.round.picks = {};
    comp.questionState = 'pick';
    comp.timeLeft = q.timeLimitSec;
    this._setPaused(false);
    this.emit('question:pick', { index: comp.currentIndex });
    this.emit('state');
    this._startTicking();
  }

  /** كشف الإجابة واحتساب النقاط. */
  revealNow() {
    const comp = this.requireComp();
    if (comp.questionState === 'lies') { this._toPick(); return comp; }
    if (comp.questionState === 'pick') this._reveal();
    return comp;
  }
  _reveal() {
    const comp = this.comp;
    this._clearTickTimer();
    const q = Competition.currentQuestion(comp);
    if (!q) return this._finish();

    const round = comp.round;
    round.awarded = {};
    const add = (groupId, pts) => {
      const g = Competition.findGroup(comp, groupId);
      if (!g) return;
      g.score = (g.score || 0) + pts;
      round.awarded[groupId] = (round.awarded[groupId] || 0) + pts;
    };
    const lieReward = Math.round((Number(q.points) || 0) / 2);

    for (const [groupId, optId] of Object.entries(round.picks)) {
      const opt = Competition.findOption(comp, optId);
      if (!opt) continue;
      if (opt.kind === 'truth') {
        // نقاط الإصابة (مع مكافأة السرعة إن فُعّلت)
        add(groupId, scoreAnswer(q, true, round.pickTimeLeft ? round.pickTimeLeft[groupId] || 0 : 0, comp.speedBonus));
      } else {
        // وقعت المجموعة في لغم — يكسب أصحاب اللغم
        for (const ownerId of opt.owners) {
          if (ownerId !== groupId) add(ownerId, lieReward);
        }
      }
    }

    comp.questionState = 'revealed';
    this._setPaused(false);
    this.emit('question:reveal', { index: comp.currentIndex });
    this.emit('state');
  }

  nextQuestion() {
    const comp = this.requireComp();
    if (comp.questionState === 'lies') this._toPick();
    if (comp.questionState === 'pick') this._reveal();
    if (comp.currentIndex + 1 >= comp.questions.length) {
      this._finish();
    } else {
      comp.currentIndex += 1;
      this._openQuestion();
    }
    return comp;
  }

  _finish() {
    const comp = this.comp;
    this._clearTimers();
    comp.status = 'finished';
    comp.questionState = 'idle';
    const standings = Competition.groupsSummary(comp);
    this.emit('competition:finished', { standings, podium: standings.slice(0, 3) });
    this.emit('state');
  }
  finishNow() {
    this.requireComp();
    this._finish();
    return this.comp;
  }

  // -------------------- إجابات المجموعات --------------------

  /** تسجيل لغم (جواب مضلِّل) في مرحلة lies. يمكن تغييره حتى تنتهي المرحلة. */
  submitLie(groupId, text) {
    const comp = this.requireComp();
    if (comp.questionState !== 'lies' || this.paused) {
      return { ok: false, error: 'كتابة الأجوبة مغلقة حاليًا' };
    }
    const q = Competition.currentQuestion(comp);
    if (!q) return { ok: false, error: 'لا يوجد سؤال نشط' };
    const group = Competition.findGroup(comp, groupId);
    if (!group) return { ok: false, error: 'المجموعة غير موجودة' };
    const clean = String(text || '').trim().slice(0, 60);
    if (!clean) return { ok: false, error: 'اكتب جوابًا' };
    const norm = Competition.normalize(clean);
    if (norm === Competition.normalize(q.answer)) {
      return { ok: false, error: 'هذا هو الجواب الصحيح! اكتب جوابًا مضلِّلًا آخر' };
    }
    comp.round.lies[groupId] = { text: clean, norm };
    this.emit('answer', { groupId });
    this.emit('state');
    return { ok: true };
  }

  /** اختيار إجابة في مرحلة pick. لا يمكن اختيار لغم المجموعة نفسها. */
  submitPick(groupId, optionId) {
    const comp = this.requireComp();
    if (comp.questionState !== 'pick' || this.paused) {
      return { ok: false, error: 'الاختيار مغلق حاليًا' };
    }
    const group = Competition.findGroup(comp, groupId);
    if (!group) return { ok: false, error: 'المجموعة غير موجودة' };
    const opt = Competition.findOption(comp, optionId);
    if (!opt) return { ok: false, error: 'خيار غير صالح' };
    if (Competition.ownsOption(opt, groupId)) {
      return { ok: false, error: 'لا يمكنك اختيار لغمك أنت' };
    }
    comp.round.picks[groupId] = optionId;
    if (!comp.round.pickTimeLeft) comp.round.pickTimeLeft = {};
    comp.round.pickTimeLeft[groupId] = comp.timeLeft;
    this.emit('answer', { groupId });
    this.emit('state');
    return { ok: true };
  }

  // -------------------- إضافة مجموعة (انضمام ذاتي) --------------------

  addGroup(name) {
    const comp = this.requireComp();
    const codes = new Set(comp.groups.map((g) => g.code));
    const clean = String(name || '').trim().slice(0, 24);
    const g = Competition.makeGroup(clean || `المجموعة ${comp.groups.length + 1}`, codes);
    comp.groups.push(g);
    this.emit('state');
    return g;
  }

  // -------------------- تعديلات المقدّم على النقاط --------------------

  adjustScore(groupId, amount) {
    const comp = this.requireComp();
    const delta = Math.round(Number(amount));
    if (!Number.isFinite(delta)) throw new Error('القيمة غير صالحة');
    const targets = groupId === 'ALL' ? comp.groups : [Competition.findGroup(comp, groupId)];
    for (const g of targets) {
      if (!g) continue;
      g.score = Math.max(0, (g.score || 0) + delta);
    }
    this.emit('state');
    return comp;
  }

  // -------------------- مؤقّتات --------------------

  _clearTickTimer() {
    if (this._tickTimer) {
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }
  }
  _clearTimers() {
    this._clearTickTimer();
  }
}

module.exports = { GameEngine };
