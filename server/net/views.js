'use strict';

const Competition = require('../engine/Competition');
const { TRANSITION_MS } = require('../engine/GameEngine');

// عرض عام للسهم (يُرى في كل الواجهات)
function publicStock(s) {
  return {
    id: s.id,
    name: s.name,
    price: s.price,
    prevPrice: s.prevPrice,
    startPrice: s.startPrice,
    direction: s.direction,
    lastChangePct: s.lastChangePct,
  };
}

function baseMeta(comp) {
  return {
    id: comp.id,
    name: comp.name,
    status: comp.status,
    pricingMode: comp.pricingMode,
    rounds: comp.rounds,
    currentRound: comp.currentRound,
    roundState: comp.roundState,
    roundDurationSec: comp.roundDurationSec,
    timeLeft: comp.timeLeft,
    transitionMs: TRANSITION_MS,
    news: comp.news || [],
  };
}

/** حالة شاشة العرض: الميتا + الأسهم + لوحة الترتيب (بدون أكواد الدخول). */
function displayState(comp) {
  if (!comp) return { active: false };
  const summary = Competition.groupsSummary(comp).map((r) => ({
    id: r.id,
    name: r.name,
    wealth: r.wealth,
    pnl: r.pnl,
    pnlPct: r.pnlPct,
    rank: r.rank,
  }));
  return Object.assign({ active: true }, baseMeta(comp), {
    stocks: comp.stocks.map(publicStock),
    leaderboard: summary,
    lastMoves: comp.lastMoves || [],
  });
}

/** حالة الأدمن: كل التفاصيل (أكواد، محافظ، أرباح/خسائر). */
function adminState(comp) {
  if (!comp) return { active: false };
  return Object.assign({ active: true }, baseMeta(comp), {
    paused: comp._paused === true,
    initialCapital: comp.initialCapital,
    stocks: comp.stocks.map((s) => ({
      id: s.id,
      name: s.name,
      price: s.price,
      prevPrice: s.prevPrice,
      startPrice: s.startPrice,
      direction: s.direction,
      lastChangePct: s.lastChangePct,
      flatStreak: s.flatStreak,
      manualChanges: s.manualChanges,
    })),
    groups: Competition.groupsSummary(comp),
  });
}

/**
 * حالة المتسابق: اسم المجموعة + النقد فقط + الأسهم + كميات ما يملكه (لأجل البيع).
 * لا تُرسل القيمة السوقية للمحفظة ولا إجمالي الثروة إطلاقًا.
 */
function playerState(comp, group) {
  if (!comp || !group) return { active: false };
  return Object.assign({ active: true }, baseMeta(comp), {
    tradingOpen: comp.roundState === 'open' && comp._paused !== true,
    group: {
      id: group.id,
      name: group.name,
      cash: group.cash, // النقد فقط
    },
    // الأسهم مع كمية ما يملكه المتسابق (عدد فقط، بدون قيمة سوقية)
    stocks: comp.stocks.map((s) =>
      Object.assign(publicStock(s), { owned: group.holdings[s.id] || 0 })
    ),
  });
}

module.exports = { publicStock, displayState, adminState, playerState };
