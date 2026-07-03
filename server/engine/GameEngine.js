'use strict';

const EventEmitter = require('events');
const Competition = require('./Competition');
const { stepPrices, buildNews, round2 } = require('./pricing');

const TRANSITION_MS = 4500; // مدة حركة الانتقال بين الجولات (3-2-1 + تحريك الأسعار)

/**
 * محرّك اللعبة: يدير دورة حياة الجولات والمؤقّت والتداول.
 * مصدر الحقيقة الوحيد للحالة (server-authoritative).
 *
 * الأحداث المبثوثة:
 *  - 'state'            : تغيّر عام في الحالة (يستدعي إعادة البثّ)
 *  - 'tick'             : نبضة كل ثانية أثناء جولة مفتوحة { timeLeft }
 *  - 'round:open'       : بدء جولة جديدة { round }
 *  - 'round:transition' : انتهاء التداول وبدء تحديث السوق { round, moves, news }
 *  - 'competition:finished' : انتهاء المنافسة { podium }
 *  - 'trade'            : تنفيذ صفقة { groupId }
 */
class GameEngine extends EventEmitter {
  constructor() {
    super();
    this.comp = null;
    this._tickTimer = null;
    this._transitionTimer = null;
    this.paused = false;
  }

  _setPaused(v) {
    this.paused = v;
    if (this.comp) this.comp._paused = v;
  }

  // -------------------- إدارة المنافسة --------------------

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
    // استعادة منافسة محفوظة مع إيقاف أي مؤقّت جارٍ (يستأنفها الأدمن يدويًا)
    this._clearTimers();
    this.comp = comp;
    // كانت جولة مفتوحة عند الحفظ → نضعها في وضع الإيقاف المؤقت للأمان
    this._setPaused(comp.roundState === 'open');
    this.emit('state');
  }

  requireComp() {
    if (!this.comp) throw new Error('لا توجد منافسة نشطة');
    return this.comp;
  }

  // -------------------- دورة حياة الجولات --------------------

  start() {
    const comp = this.requireComp();
    if (comp.status === 'finished') throw new Error('انتهت المنافسة بالفعل');
    if (comp.currentRound === 0) {
      comp.status = 'running';
      comp.currentRound = 1;
      this._openRound();
    } else if (this.paused) {
      this.resume();
    }
    return comp;
  }

  _openRound() {
    const comp = this.comp;
    comp.roundState = 'open';
    comp.timeLeft = comp.roundDurationSec;
    comp.roundFlow = {};
    this._setPaused(false);
    // تصفير اتجاهات الأسهم عند بداية جولة جديدة (تبقى الأسعار)
    this.emit('round:open', { round: comp.currentRound });
    this.emit('state');
    this._startTicking();
  }

  _startTicking() {
    this._clearTickTimer();
    this._tickTimer = setInterval(() => {
      const comp = this.comp;
      if (!comp || comp.roundState !== 'open' || this.paused) return;
      comp.timeLeft -= 1;
      if (comp.timeLeft <= 0) {
        comp.timeLeft = 0;
        this.emit('tick', { timeLeft: 0 });
        this._closeRound();
      } else {
        this.emit('tick', { timeLeft: comp.timeLeft });
      }
    }, 1000);
  }

  pause() {
    const comp = this.requireComp();
    if (comp.roundState !== 'open') return comp;
    this._setPaused(true);
    this.emit('state');
    return comp;
  }

  resume() {
    const comp = this.requireComp();
    if (comp.roundState !== 'open') return comp;
    this._setPaused(false);
    this.emit('state');
    return comp;
  }

  /** إنهاء التداول في الجولة الحالية فورًا (زر الأدمن "إنهاء الجولة"). */
  endRoundNow() {
    const comp = this.requireComp();
    if (comp.roundState === 'open') {
      comp.timeLeft = 0;
      this._closeRound();
    }
    return comp;
  }

  _closeRound() {
    const comp = this.comp;
    this._clearTickTimer();
    comp.roundState = 'transition';

    // تحديث السوق: حساب الأسعار الجديدة بناءً على النمط
    const moves = stepPrices(comp, comp.currentRound);
    const news = buildNews(moves);
    comp.news = news;
    comp.lastMoves = moves;

    this.emit('round:transition', { round: comp.currentRound, moves, news });
    this.emit('state');

    // بعد حركة الانتقال: إمّا جولة تالية أو نهاية المنافسة
    this._clearTransitionTimer();
    this._transitionTimer = setTimeout(() => {
      if (comp.currentRound >= comp.rounds) {
        this._finish();
      } else {
        comp.currentRound += 1;
        this._openRound();
      }
    }, TRANSITION_MS);
  }

  /** تخطّي انتظار الانتقال والانتقال للجولة التالية فورًا (زر الأدمن). */
  nextRound() {
    const comp = this.requireComp();
    if (comp.roundState !== 'transition') return comp;
    this._clearTransitionTimer();
    if (comp.currentRound >= comp.rounds) {
      this._finish();
    } else {
      comp.currentRound += 1;
      this._openRound();
    }
    return comp;
  }

  _finish() {
    const comp = this.comp;
    this._clearTimers();
    comp.status = 'finished';
    comp.roundState = 'idle';
    const podium = Competition.groupsSummary(comp).slice(0, 3);
    this.emit('competition:finished', { podium });
    this.emit('state');
  }

  /** إنهاء المنافسة يدويًا من الأدمن. */
  finishNow() {
    this.requireComp();
    this._finish();
    return this.comp;
  }

  // -------------------- التداول --------------------

  /**
   * تنفيذ صفقة شراء/بيع لمجموعة. يتحقق من الكفاية في الخادم.
   * @returns {{ok:boolean, error?:string, group?:object}}
   */
  trade(groupId, stockId, side, qty) {
    const comp = this.requireComp();
    const quantity = Math.floor(Number(qty));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { ok: false, error: 'الكمية غير صالحة' };
    }
    if (comp.roundState !== 'open' || this.paused) {
      return { ok: false, error: 'التداول مغلق حاليًا' };
    }
    const group = Competition.findGroup(comp, groupId);
    if (!group) return { ok: false, error: 'المجموعة غير موجودة' };
    const stock = Competition.findStock(comp, stockId);
    if (!stock) return { ok: false, error: 'السهم غير موجود' };

    if (side === 'buy') {
      const cost = round2(stock.price * quantity);
      if (cost > group.cash) {
        return { ok: false, error: 'الرصيد النقدي غير كافٍ' };
      }
      group.cash = round2(group.cash - cost);
      group.holdings[stockId] = (group.holdings[stockId] || 0) + quantity;
      comp.roundFlow[stockId] = (comp.roundFlow[stockId] || 0) + quantity;
    } else if (side === 'sell') {
      const owned = group.holdings[stockId] || 0;
      if (quantity > owned) {
        return { ok: false, error: 'لا تملك هذا العدد من الأسهم' };
      }
      const proceeds = round2(stock.price * quantity);
      group.cash = round2(group.cash + proceeds);
      group.holdings[stockId] = owned - quantity;
      if (group.holdings[stockId] === 0) delete group.holdings[stockId];
      comp.roundFlow[stockId] = (comp.roundFlow[stockId] || 0) - quantity;
    } else {
      return { ok: false, error: 'نوع العملية غير صحيح' };
    }

    this.emit('trade', { groupId });
    this.emit('state');
    return { ok: true, group };
  }

  // -------------------- تعديلات الأدمن على المال --------------------

  adjustCash(groupId, amount) {
    const comp = this.requireComp();
    const delta = round2(Number(amount));
    if (!Number.isFinite(delta)) throw new Error('المبلغ غير صالح');
    const targets = groupId === 'ALL' ? comp.groups : [Competition.findGroup(comp, groupId)];
    for (const g of targets) {
      if (!g) continue;
      g.cash = round2(Math.max(0, g.cash + delta));
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

  _clearTransitionTimer() {
    if (this._transitionTimer) {
      clearTimeout(this._transitionTimer);
      this._transitionTimer = null;
    }
  }

  _clearTimers() {
    this._clearTickTimer();
    this._clearTransitionTimer();
  }
}

module.exports = { GameEngine, TRANSITION_MS };
