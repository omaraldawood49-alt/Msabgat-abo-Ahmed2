'use strict';

const Competition = require('../engine/Competition');

function baseMeta(comp) {
  return {
    id: comp.id,
    name: comp.name,
    status: comp.status,
    total: comp.questions.length,
    currentIndex: comp.currentIndex,
    questionNumber: comp.currentIndex >= 0 ? comp.currentIndex + 1 : 0,
    questionState: comp.questionState,
    timeLeft: comp.timeLeft,
    speedBonus: comp.speedBonus,
  };
}

/** الخيارات كما تُرى قبل الكشف (بدون تمييز الصحيح). */
function publicOptions(q) {
  return q.options.map((text, i) => ({ index: i, text }));
}

/**
 * حالة شاشة العرض (البروجكتر):
 *  - أثناء السؤال: نص السؤال + الخيارات + عدد المجيبين (بدون كشف الصحيح).
 *  - عند الكشف: الصحيح + توزيع الإجابات + لوحة الترتيب.
 *  - في الردهة/بين الأسئلة/النهاية: لوحة الترتيب وأسماء المجموعات.
 */
function displayState(comp) {
  if (!comp) return { active: false };
  const q = Competition.currentQuestion(comp);
  const revealed = comp.questionState === 'revealed';
  const finished = comp.status === 'finished';
  const leaderboard = Competition.groupsSummary(comp);

  const out = Object.assign({ active: true }, baseMeta(comp), {
    groupCount: comp.groups.length,
    leaderboard,
    // في الردهة نعرض أسماء المجموعات المنضمّة لتشجيع الانضمام
    lobby: comp.groups.map((g) => ({ id: g.id, name: g.name })),
  });

  if (q) {
    const { tally, answered } = Competition.optionTally(comp, q);
    out.question = {
      text: q.text,
      category: q.category,
      options: publicOptions(q),
      timeLimitSec: q.timeLimitSec,
      points: q.points,
      answered,
      total: comp.groups.length,
      // توزيع الإجابات لا يظهر إلا بعد الكشف (حتى لا يُلمِّح للصحيح)
      tally: revealed ? tally : null,
      correctIndex: revealed ? q.correctIndex : null,
    };
  } else {
    out.question = null;
  }
  return out;
}

/** حالة المقدّم/الأدمن: كل التفاصيل (الأكواد، السؤال الصحيح، من أجاب، النقاط). */
function adminState(comp) {
  if (!comp) return { active: false };
  const q = Competition.currentQuestion(comp);
  const out = Object.assign({ active: true }, baseMeta(comp), {
    paused: comp._paused === true,
    defaultTimeSec: comp.defaultTimeSec,
    defaultPoints: comp.defaultPoints,
    questions: comp.questions.map((qq, i) => ({
      id: qq.id,
      index: i,
      text: qq.text,
      options: qq.options.slice(),
      correctIndex: qq.correctIndex,
      category: qq.category,
      timeLimitSec: qq.timeLimitSec,
      points: qq.points,
    })),
    groups: Competition.groupsSummary(comp),
  });

  if (q) {
    const { tally, answered } = Competition.optionTally(comp, q);
    out.current = {
      id: q.id,
      text: q.text,
      category: q.category,
      options: q.options.slice(),
      correctIndex: q.correctIndex,
      timeLimitSec: q.timeLimitSec,
      points: q.points,
      tally,
      answered,
      total: comp.groups.length,
    };
  } else {
    out.current = null;
  }
  return out;
}

/**
 * حالة جوال المجموعة: الخيارات كأزرار + حالة إجابتها + نتيجتها بعد الكشف.
 */
function playerState(comp, group) {
  if (!comp || !group) return { active: false };
  const q = Competition.currentQuestion(comp);
  const leaderboard = Competition.groupsSummary(comp);
  const me = leaderboard.find((r) => r.id === group.id) || { rank: 0, score: group.score || 0 };

  const out = Object.assign({ active: true }, baseMeta(comp), {
    group: { id: group.id, name: group.name, score: me.score, rank: me.rank, streak: group.streak || 0 },
    groupCount: comp.groups.length,
  });

  if (q) {
    const revealed = comp.questionState === 'revealed';
    const myAnswer = group.answers[q.id] || null;
    out.question = {
      text: q.text,
      category: q.category,
      options: publicOptions(q),
      timeLimitSec: q.timeLimitSec,
      answered: !!myAnswer,
      myOption: myAnswer ? myAnswer.optionIndex : null,
      // نتيجتي تظهر بعد الكشف فقط
      correctIndex: revealed ? q.correctIndex : null,
      myCorrect: revealed && myAnswer ? myAnswer.correct : null,
      myAwarded: revealed && myAnswer ? myAnswer.awarded : 0,
    };
  } else {
    out.question = null;
  }
  return out;
}

module.exports = { displayState, adminState, playerState };
