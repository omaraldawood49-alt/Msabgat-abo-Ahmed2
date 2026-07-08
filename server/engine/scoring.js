'use strict';

// ============================================================================
// حساب النقاط لكل سؤال (على غرار «كلك»/كاهوت):
//  - إجابة خاطئة أو عدم الإجابة = 0 نقطة
//  - إجابة صحيحة = نقاط السؤال، مع مكافأة سرعة اختيارية:
//      كلما أجبت أسرع (وقت متبقٍّ أكبر) حصلت على نقاط أكثر، ضمن نطاق [50%..100%].
// ============================================================================

function clampInt(n, min, max, fallback) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, v));
}

/**
 * يحسب النقاط الممنوحة لإجابة واحدة.
 * @param {object} question   السؤال (points, timeLimitSec)
 * @param {boolean} correct   هل الإجابة صحيحة؟
 * @param {number} atTimeLeft الوقت المتبقّي لحظة الإجابة (بالثواني)
 * @param {boolean} speedBonus هل مكافأة السرعة مفعّلة؟
 * @returns {number} النقاط الصحيحة الممنوحة (عدد صحيح)
 */
function scoreAnswer(question, correct, atTimeLeft, speedBonus) {
  if (!correct) return 0;
  const base = Number(question.points) || 0;
  if (!speedBonus) return Math.round(base);
  const dur = Number(question.timeLimitSec) || 1;
  const ratio = Math.max(0, Math.min(1, Number(atTimeLeft) / dur));
  const factor = 0.5 + 0.5 * ratio; // بين 50% و 100%
  return Math.round(base * factor);
}

module.exports = { clampInt, scoreAnswer };
