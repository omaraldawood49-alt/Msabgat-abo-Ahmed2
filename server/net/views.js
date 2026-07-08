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
    questionState: comp.questionState, // idle | lies | pick | revealed
    timeLeft: comp.timeLeft,
    speedBonus: comp.speedBonus,
  };
}

function nameOf(comp, groupId) {
  const g = Competition.findGroup(comp, groupId);
  return g ? g.name : '—';
}

/** عدد المجموعات التي كتبت لغمًا / اختارت. */
function counts(comp) {
  const r = comp.round || {};
  return {
    lies: Object.keys(r.lies || {}).length,
    picks: Object.keys(r.picks || {}).length,
    total: comp.groups.length,
  };
}

// -------------------- شاشة العرض --------------------
function displayState(comp) {
  if (!comp) return { active: false };
  const q = Competition.currentQuestion(comp);
  const phase = comp.questionState;
  const out = Object.assign({ active: true }, baseMeta(comp), {
    groupCount: comp.groups.length,
    leaderboard: Competition.groupsSummary(comp),
    lobby: comp.groups.map((g) => ({ id: g.id, name: g.name })),
  });
  if (!q) { out.question = null; return out; }

  const c = counts(comp);
  const base = { text: q.text, category: q.category, points: q.points, timeLimitSec: q.timeLimitSec, phase: phase, answered: phase === 'lies' ? c.lies : c.picks, total: c.total };

  if (phase === 'lies') {
    out.question = base;
  } else if (phase === 'pick') {
    out.question = Object.assign(base, {
      options: (comp.round.options || []).map((o) => ({ id: o.id, text: o.text })),
    });
  } else if (phase === 'revealed') {
    out.question = Object.assign(base, {
      answer: q.answer,
      options: (comp.round.options || []).map((o) => {
        const pickedBy = Object.entries(comp.round.picks || {})
          .filter(([, oid]) => oid === o.id)
          .map(([gid]) => nameOf(comp, gid));
        return {
          id: o.id,
          text: o.text,
          truth: o.kind === 'truth',
          owners: (o.owners || []).map((gid) => nameOf(comp, gid)),
          pickedBy: pickedBy,
          pickCount: pickedBy.length,
        };
      }),
    });
  } else {
    out.question = base;
  }
  return out;
}

// -------------------- شاشة المقدّم --------------------
function adminState(comp) {
  if (!comp) return { active: false };
  const q = Competition.currentQuestion(comp);
  const out = Object.assign({ active: true }, baseMeta(comp), {
    paused: comp._paused === true,
    defaultTimeSec: comp.defaultTimeSec,
    defaultPoints: comp.defaultPoints,
    questions: comp.questions.map((qq, i) => ({
      id: qq.id, index: i, text: qq.text, answer: qq.answer,
      category: qq.category, timeLimitSec: qq.timeLimitSec, points: qq.points,
    })),
    groups: Competition.groupsSummary(comp),
  });

  if (!q) { out.current = null; return out; }
  const c = counts(comp);
  const cur = {
    id: q.id, text: q.text, answer: q.answer, category: q.category,
    points: q.points, phase: comp.questionState,
    liesCount: c.lies, picksCount: c.picks, total: c.total,
    lies: Object.entries(comp.round.lies || {}).map(([gid, l]) => ({ group: nameOf(comp, gid), text: l.text })),
  };
  if (comp.questionState === 'pick' || comp.questionState === 'revealed') {
    cur.options = (comp.round.options || []).map((o) => {
      const pickedBy = Object.entries(comp.round.picks || {})
        .filter(([, oid]) => oid === o.id).map(([gid]) => nameOf(comp, gid));
      return {
        id: o.id, text: o.text, truth: o.kind === 'truth',
        owners: (o.owners || []).map((gid) => nameOf(comp, gid)),
        pickedBy: pickedBy, pickCount: pickedBy.length,
      };
    });
  }
  out.current = cur;
  return out;
}

// -------------------- جوال المجموعة --------------------
function playerState(comp, group) {
  if (!comp || !group) return { active: false };
  const q = Competition.currentQuestion(comp);
  const leaderboard = Competition.groupsSummary(comp);
  const me = leaderboard.find((r) => r.id === group.id) || { rank: 0, score: group.score || 0 };
  const out = Object.assign({ active: true }, baseMeta(comp), {
    group: { id: group.id, name: group.name, score: me.score, rank: me.rank },
    groupCount: comp.groups.length,
  });
  if (!q) { out.question = null; return out; }

  const phase = comp.questionState;
  const myLie = (comp.round.lies || {})[group.id] || null;
  const base = { text: q.text, category: q.category, phase: phase };

  if (phase === 'lies') {
    out.question = Object.assign(base, { myLie: myLie ? myLie.text : null });
  } else if (phase === 'pick') {
    out.question = Object.assign(base, {
      myPick: (comp.round.picks || {})[group.id] || null,
      options: (comp.round.options || []).map((o) => ({
        id: o.id, text: o.text, mine: Competition.ownsOption(o, group.id),
      })),
    });
  } else if (phase === 'revealed') {
    const myPickId = (comp.round.picks || {})[group.id] || null;
    const myOpt = myPickId ? Competition.findOption(comp, myPickId) : null;
    // كم وقع في لغمي؟
    let myLieTakers = 0;
    for (const o of comp.round.options || []) {
      if (Competition.ownsOption(o, group.id)) {
        myLieTakers = Object.entries(comp.round.picks || {})
          .filter(([gid, oid]) => oid === o.id && gid !== group.id).length;
      }
    }
    out.question = Object.assign(base, {
      answer: q.answer,
      myPickCorrect: myOpt ? myOpt.kind === 'truth' : null,
      myLieText: myLie ? myLie.text : null,
      myLieTakers: myLieTakers,
      awarded: (comp.round.awarded || {})[group.id] || 0,
      options: (comp.round.options || []).map((o) => ({
        id: o.id, text: o.text, truth: o.kind === 'truth',
        mine: Competition.ownsOption(o, group.id), picked: o.id === myPickId,
      })),
    });
  } else {
    out.question = base;
  }
  return out;
}

module.exports = { displayState, adminState, playerState };
