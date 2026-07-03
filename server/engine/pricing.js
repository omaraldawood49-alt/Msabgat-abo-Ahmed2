'use strict';

// ============================================================================
// محرّك التسعير — يدعم نمطين: تلقائي (عرض/طلب) ويدوي (نِسَب مُعرَّفة مسبقًا)
// مع تطبيق "قاعدة منع الثبات لأكثر من جولتين متتاليتين".
// ============================================================================

const MIN_PRICE = 1; // حدّ أدنى للسعر يمنع القيم السالبة
const MANUAL_CYCLE = 10; // النمط اليدوي يتكرر كل 10 جولات

// إعدادات النمط التلقائي (قابلة للضبط لاحقًا عبر المنافسة)
const AUTO_DEFAULTS = {
  perUnitPct: 1.2, // نسبة التغير لكل وحدة صافية من الطلب (شراء - بيع)
  maxPct: 18, // أقصى تغير مسموح للجولة الواحدة (±)
  noisePct: 1.5, // عشوائية طفيفة تضاف لإحياء السوق
};

// عند إجبار سهم على الحركة (قاعدة منع الثبات)
const FORCE_MIN_PCT = 2;
const FORCE_MAX_PCT = 6;

function round2(n) {
  return Math.round(n * 100) / 100;
}

function randBetween(min, max) {
  return min + Math.random() * (max - min);
}

/**
 * يحسب نسبة تغير السهم في النمط التلقائي بناءً على صافي الطلب.
 * @param {number} netQty  صافي (كمية الشراء - كمية البيع) خلال الجولة
 * @param {object} cfg     إعدادات النمط التلقائي
 * @returns {number} نسبة التغير المئوية (قبل تطبيق قاعدة الثبات)
 */
function autoChangePct(netQty, cfg) {
  const base = netQty * cfg.perUnitPct;
  const noise = netQty === 0 ? 0 : randBetween(-cfg.noisePct, cfg.noisePct);
  let pct = base + noise;
  if (pct > cfg.maxPct) pct = cfg.maxPct;
  if (pct < -cfg.maxPct) pct = -cfg.maxPct;
  return pct;
}

/**
 * يقرأ نسبة التغير المُعرَّفة يدويًا لسهم في جولة معيّنة (مع التكرار الدوري).
 * @param {number[]} manualChanges  مصفوفة نِسَب لأول 10 جولات
 * @param {number} roundNumber      رقم الجولة (يبدأ من 1)
 */
function manualChangePct(manualChanges, roundNumber) {
  if (!Array.isArray(manualChanges) || manualChanges.length === 0) return 0;
  const idx = (roundNumber - 1) % MANUAL_CYCLE;
  const val = manualChanges[idx % manualChanges.length];
  return Number.isFinite(val) ? val : 0;
}

/**
 * يطبّق قاعدة منع الثبات: إذا كان السهم ثابتًا جولتين متتاليتين (flatStreak >= 2)
 * وكان تغيّره الحالي شبه صفري، يُجبر على حركة عشوائية صغيرة.
 * @returns {number} النسبة النهائية بعد تطبيق القاعدة
 */
function applyNoFlatRule(pct, flatStreak) {
  const isFlat = Math.abs(pct) < 0.001;
  if (isFlat && flatStreak >= 2) {
    const dir = Math.random() < 0.5 ? -1 : 1;
    return dir * randBetween(FORCE_MIN_PCT, FORCE_MAX_PCT);
  }
  return pct;
}

/**
 * ينفّذ خطوة التسعير لنهاية الجولة الحالية لجميع الأسهم.
 * يعدّل كل سهم في مكانه: prevPrice, price, flatStreak, direction, lastChangePct.
 *
 * @param {object} competition   كائن المنافسة (يحوي stocks, pricingMode, roundFlow, autoConfig)
 * @param {number} roundNumber   رقم الجولة المنتهية (يبدأ من 1)
 * @returns {Array} تفاصيل حركة كل سهم لاستخدامها في الأخبار/السجل
 */
function stepPrices(competition, roundNumber) {
  const cfg = Object.assign({}, AUTO_DEFAULTS, competition.autoConfig || {});
  const flow = competition.roundFlow || {};
  const moves = [];

  for (const stock of competition.stocks) {
    let pct;
    if (competition.pricingMode === 'manual') {
      pct = manualChangePct(stock.manualChanges, roundNumber);
    } else {
      const netQty = flow[stock.id] || 0;
      pct = autoChangePct(netQty, cfg);
    }

    pct = applyNoFlatRule(pct, stock.flatStreak || 0);

    const prev = stock.price;
    let next = round2(prev * (1 + pct / 100));
    if (next < MIN_PRICE) next = MIN_PRICE;

    // إعادة حساب النسبة الفعلية بعد التقريب/الحد الأدنى
    const realPct = prev > 0 ? round2(((next - prev) / prev) * 100) : 0;
    const isFlat = next === prev;

    stock.prevPrice = prev;
    stock.price = next;
    stock.lastChangePct = realPct;
    stock.direction = isFlat ? 'flat' : next > prev ? 'up' : 'down';
    stock.flatStreak = isFlat ? (stock.flatStreak || 0) + 1 : 0;

    moves.push({
      id: stock.id,
      name: stock.name,
      prevPrice: prev,
      price: next,
      changePct: realPct,
      direction: stock.direction,
      netQty: flow[stock.id] || 0,
    });
  }

  return moves;
}

/**
 * يولّد رسائل شريط الأخبار من حركة الأسهم (أكبر الرابحين/الخاسرين).
 */
function buildNews(moves) {
  const news = [];
  const sorted = [...moves].sort((a, b) => b.changePct - a.changePct);
  const gainers = sorted.filter((m) => m.direction === 'up').slice(0, 3);
  const losers = sorted.filter((m) => m.direction === 'down').slice(-3).reverse();

  for (const m of gainers) {
    news.push(`📈 ازداد الطلب على «${m.name}» وارتفع بنسبة ${Math.abs(m.changePct)}%`);
  }
  for (const m of losers) {
    news.push(`📉 انخفض الإقبال على «${m.name}» وتراجع بنسبة ${Math.abs(m.changePct)}%`);
  }
  if (news.length === 0) {
    news.push('السوق مستقر — بانتظار تحركات المستثمرين في الجولة القادمة');
  }
  return news;
}

module.exports = {
  MIN_PRICE,
  MANUAL_CYCLE,
  AUTO_DEFAULTS,
  autoChangePct,
  manualChangePct,
  applyNoFlatRule,
  stepPrices,
  buildNews,
  round2,
};
