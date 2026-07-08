'use strict';

const EventEmitter = require('events');
const Competition = require('./Competition');
const { scoreAnswer } = require('./scoring');

/**
 * محرّك لعبة الأسئلة: يدير دورة حياة الأسئلة والمؤقّت واستقبال الإجابات وحساب النقاط.
 * مصدر الحقيقة الوحيد للحالة (server-authoritative).
 *
 * الأحداث المبثوثة:
 *  - 'state'               : تغيّر عام في الحالة (يستدعي إعادة البثّ)
 *  - 'tick'                : نبضة كل ثانية أثناء سؤال مفتوح { timeLeft }
 *  - 'question:open'       : فتح سؤال جديد { index }
 *  - 'question:reveal'     : كشف الإجابة الصحيحة والنقاط { index, correctIndex }
 *  - 'competition:finished': انتهاء المسابقة { standings, podium }
 *  - 'answer'              : وصول إجابة من مجموعة { groupId }
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
    // استعادة مسابقة محفوظة مع إيقاف أي مؤقّت جارٍ (يستأنفها المقدّم يدويًا)
    this._clearTimers();
    this.comp = comp;
    this._setPaused(comp.questionState === 'open');
    this.emit('state');
  }

  requireComp() {
    if (!this.comp) throw new Error('لا توجد مسابقة نشطة');
    return this.comp;
  }

  // -------------------- دورة حياة الأسئلة --------------------

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
    comp.questionState = 'open';
    comp.timeLeft = q.timeLimitSec;
    // مسح إجابات هذا السؤال (في حال أُعيد فتحه)
    for (const g of comp.groups) delete g.answers[q.id];
    this._setPaused(false);
    this.emit('question:open', { index: comp.currentIndex });
    this.emit('state');
    this._startTicking();
  }

  _startTicking() {
    this._clearTickTimer();
    this._tickTimer = setInterval(() => {
      const comp = this.comp;
      if (!comp || comp.questionState !== 'open' || this.paused) return;
      comp.timeLeft -= 1;
      if (comp.timeLeft <= 0) {
        comp.timeLeft = 0;
        this.emit('tick', { timeLeft: 0 });
        this._revealQuestion();
      } else {
        this.emit('tick', { timeLeft: comp.timeLeft });
      }
    }, 1000);
  }

  pause() {
    const comp = this.requireComp();
    if (comp.questionState !== 'open') return comp;
    this._setPaused(true);
    this.emit('state');
    return comp;
  }

  resume() {
    const comp = this.requireComp();
    if (comp.questionState !== 'open') return comp;
    this._setPaused(false);
    this.emit('state');
    return comp;
  }

  /** إنهاء استقبال الإجابات وكشف الصحيح فورًا (زر المقدّم «كشف الإجابة»). */
  revealNow() {
    const comp = this.requireComp();
    if (comp.questionState === 'open') this._revealQuestion();
    return comp;
  }

  _revealQuestion() {
    const comp = this.comp;
    this._clearTickTimer();
    const q = Competition.currentQuestion(comp);
    if (!q) return this._finish();

    // حساب النقاط لكل مجموعة أجابت
    for (const g of comp.groups) {
      const a = g.answers[q.id];
      if (!a) {
        g.streak = 0; // من لم يجب يفقد سلسلة الإجابات المتتالية
        continue;
      }
      a.correct = a.optionIndex === q.correctIndex;
      a.awarded = scoreAnswer(q, a.correct, a.atTimeLeft, comp.speedBonus);
      if (a.correct) {
        g.streak = (g.streak || 0) + 1;
      } else {
        g.streak = 0;
      }
      g.score = (g.score || 0) + a.awarded;
    }

    comp.questionState = 'revealed';
    this._setPaused(false);
    this.emit('question:reveal', { index: comp.currentIndex, correctIndex: q.correctIndex });
    this.emit('state');
  }

  /** الانتقال للسؤال التالي (أو إنهاء المسابقة إذا كان الأخير). */
  nextQuestion() {
    const comp = this.requireComp();
    // إن كان السؤال ما زال مفتوحًا، اكشفه أولًا لاحتساب النقاط
    if (comp.questionState === 'open') this._revealQuestion();
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

  /** إنهاء المسابقة يدويًا من المقدّم. */
  finishNow() {
    this.requireComp();
    this._finish();
    return this.comp;
  }

  // -------------------- استقبال الإجابات --------------------

  /**
   * تسجيل إجابة مجموعة على السؤال الحالي. تُقبل مرة واحدة فقط لكل سؤال.
   * @returns {{ok:boolean, error?:string}}
   */
  submitAnswer(groupId, optionIndex) {
    const comp = this.requireComp();
    if (comp.questionState !== 'open' || this.paused) {
      return { ok: false, error: 'الإجابة مغلقة حاليًا' };
    }
    const q = Competition.currentQuestion(comp);
    if (!q) return { ok: false, error: 'لا يوجد سؤال نشط' };
    const group = Competition.findGroup(comp, groupId);
    if (!group) return { ok: false, error: 'المجموعة غير موجودة' };
    if (group.answers[q.id]) {
      return { ok: false, error: 'سبق أن أجبتم على هذا السؤال' };
    }
    const idx = Math.floor(Number(optionIndex));
    if (!Number.isInteger(idx) || idx < 0 || idx >= q.options.length) {
      return { ok: false, error: 'خيار غير صالح' };
    }
    group.answers[q.id] = {
      optionIndex: idx,
      atTimeLeft: comp.timeLeft,
      correct: null,
      awarded: 0,
    };
    this.emit('answer', { groupId });
    this.emit('state');
    return { ok: true };
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
