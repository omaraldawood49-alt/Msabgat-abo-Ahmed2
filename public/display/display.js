(function () {
  'use strict';
  var el = U.el, fmt = U.fmt;

  var CIRC = 2 * Math.PI * 52;
  var SHAPES = ['▲', '◆', '●', '■'];
  var lastState = null;
  var lastQState = null;
  var socket = io({ auth: { role: 'display' } });

  document.getElementById('startBtn').addEventListener('click', function () {
    Sound.unlock();
    document.getElementById('startOverlay').classList.add('hidden');
  });

  socket.on('state', render);
  socket.on('tick', function (t) {
    if (lastState) { lastState.timeLeft = t.timeLeft; updateHeader(lastState); }
  });
  socket.on('question:open', function () { Sound.roundStart(); });
  socket.on('question:reveal', function () { Sound.reveal(); });
  socket.on('competition:finished', onFinished);

  // ---------- الرأس ----------
  function updateHeader(s) {
    document.getElementById('compName').textContent = s.name || 'مسابقة الأسئلة';
    document.getElementById('qNum').textContent = s.questionNumber || '—';
    document.getElementById('qTotal').textContent = s.total ? ' / ' + s.total : '';

    var ms = document.getElementById('marketStatus');
    var st = document.getElementById('statusText');
    var open = s.questionState === 'open' && !s.paused;
    ms.className = 'market-status ' + (open ? 'open' : s.status === 'finished' ? 'closed' : '');
    st.textContent = s.status === 'finished' ? 'انتهت المسابقة'
      : s.currentIndex < 0 ? 'بانتظار البدء'
      : open ? 'الإجابة مفتوحة'
      : s.questionState === 'revealed' ? 'الإجابة الصحيحة' : 'متوقّف';

    var ring = document.getElementById('ringFg');
    var ringTime = document.getElementById('ringTime');
    var q = s.question;
    var dur = (q && q.timeLimitSec) || 1;
    if (s.questionState === 'open') {
      var frac = Math.max(0, Math.min(1, s.timeLeft / dur));
      ring.style.strokeDashoffset = CIRC * (1 - frac);
      ring.style.stroke = s.timeLeft <= 5 ? 'var(--down)' : '#ffe08a';
      ringTime.textContent = s.timeLeft;
      if (s.timeLeft <= 5 && s.timeLeft > 0) { Sound.countdown(); ringTime.style.color = '#ffd0d4'; }
      else { ringTime.style.color = ''; }
    } else {
      ring.style.strokeDashoffset = 0;
      ringTime.textContent = s.status === 'finished' ? '✓' : s.questionState === 'revealed' ? '✓' : '–';
      ringTime.style.color = '';
    }
  }

  function show(id, on) { document.getElementById(id).classList[on ? 'remove' : 'add']('hidden'); }

  // ---------- العرض الكامل ----------
  function render(s) {
    if (!s || !s.active) {
      lastState = s;
      document.getElementById('compName').textContent = 'مسابقة الأسئلة';
      show('lobby', true); show('stage', false);
      document.getElementById('lobbyTitle').textContent = 'لا توجد مسابقة نشطة';
      document.getElementById('lobbyCount').textContent = '0';
      document.getElementById('lobbyGroups').innerHTML = '';
      return;
    }
    lastState = s;
    updateHeader(s);

    if (s.status !== 'finished') {
      document.getElementById('podiumOverlay').classList.add('hidden');
    }

    if (s.status === 'finished') {
      show('lobby', false); show('stage', false);
      // في حال إعادة تحميل الشاشة بعد النهاية، نبني لوحة التتويج من الحالة
      if (document.getElementById('podiumOverlay').classList.contains('hidden')) {
        buildPodium(s.leaderboard || []);
      }
      return;
    }

    if (s.currentIndex < 0 || !s.question) {
      renderLobby(s);
      show('lobby', true); show('stage', false);
      lastQState = null;
      return;
    }

    show('lobby', false); show('stage', true);
    renderStage(s);
  }

  // ---------- الردهة ----------
  function renderLobby(s) {
    document.getElementById('lobbyTitle').textContent = 'بانتظار بدء المسابقة';
    document.getElementById('lobbyCount').textContent = s.groupCount || 0;
    fetch('/api/config').then(function (r) { return r.json(); }).then(function (c) {
      document.getElementById('joinUrl').textContent = (c.baseUrl || '') + '/player';
    }).catch(function () {});
    var wrap = document.getElementById('lobbyGroups');
    wrap.innerHTML = '';
    (s.lobby || []).forEach(function (g) {
      wrap.appendChild(el('div', { class: 'chip-team' }, [g.name]));
    });
  }

  // ---------- منصة السؤال ----------
  var optRefs = [];
  function renderStage(s) {
    var q = s.question;
    var revealed = s.questionState === 'revealed';
    document.getElementById('qCategory').textContent = q.category || '';
    document.getElementById('qPoints').textContent = q.points ? q.points + ' نقطة' : '';
    document.getElementById('qText').textContent = q.text;

    var answeredEl = document.getElementById('qAnswered');
    answeredEl.textContent = revealed ? '' : '✋ أجاب ' + q.answered + ' من ' + q.total;

    // إعادة بناء الشبكة عند تغيّر السؤال/عدد الخيارات
    var grid = document.getElementById('optGrid');
    var sig = s.questionNumber + ':' + q.options.length;
    if (grid.dataset.sig !== sig) {
      grid.innerHTML = ''; optRefs = [];
      grid.className = 'opt-grid' + (q.options.length <= 2 ? ' cols1' : '');
      q.options.forEach(function (o, i) {
        var shape = el('span', { class: 'shape' }, [SHAPES[i] || '●']);
        var text = el('span', { class: 'otext' }, [o.text]);
        var tally = el('span', { class: 'tally hidden' }, ['0']);
        var check = el('span', { class: 'check hidden' }, ['✓']);
        var tile = el('div', { class: 'opt-tile opt-' + i }, [shape, text, tally, check]);
        optRefs.push({ tile: tile, tally: tally, check: check });
        grid.appendChild(tile);
      });
      grid.dataset.sig = sig;
    }

    optRefs.forEach(function (r, i) {
      r.tile.classList.remove('correct', 'dimmed');
      if (revealed) {
        var isCorrect = i === q.correctIndex;
        r.tile.classList.add(isCorrect ? 'correct' : 'dimmed');
        r.check.classList[isCorrect ? 'remove' : 'add']('hidden');
        if (q.tally) { r.tally.classList.remove('hidden'); r.tally.textContent = q.tally[i]; }
      } else {
        r.check.classList.add('hidden');
        r.tally.classList.add('hidden');
      }
    });

    // شريط الترتيب عند الكشف
    var rb = document.getElementById('revealBoard');
    if (revealed) {
      renderRevealBoard(s.leaderboard || []);
      rb.classList.remove('hidden');
    } else {
      rb.classList.add('hidden');
    }

    lastQState = s.questionState;
  }

  function renderRevealBoard(rows) {
    var rb = document.getElementById('revealBoard');
    rb.innerHTML = '';
    rows.slice(0, 5).forEach(function (g) {
      rb.appendChild(el('div', { class: 'rb-item' + (g.rank === 1 ? ' r1' : '') }, [
        el('span', { class: 'rb-rank' }, ['#' + g.rank]),
        el('span', {}, [g.name]),
        el('span', { class: 'rb-score mono' }, [fmt(g.score)])
      ]));
    });
  }

  // ---------- التتويج ----------
  function launchConfetti() {
    var old = document.querySelector('.confetti');
    if (old) old.remove();
    var wrap = el('div', { class: 'confetti' });
    var colors = ['#ffd54a', '#ff8bd0', '#7ee7ff', '#6d5efc', '#2ee59d', '#ff6d7b', '#f5a524'];
    for (var i = 0; i < 90; i++) {
      var p = document.createElement('i');
      p.style.left = Math.random() * 100 + 'vw';
      p.style.background = colors[i % colors.length];
      p.style.animationDuration = (2.6 + Math.random() * 2.4) + 's';
      p.style.animationDelay = (Math.random() * 1.2) + 's';
      p.style.height = (10 + Math.random() * 10) + 'px';
      p.style.transform = 'rotate(' + Math.random() * 360 + 'deg)';
      wrap.appendChild(p);
    }
    document.body.appendChild(wrap);
    setTimeout(function () { wrap.remove(); }, 9000);
  }

  function buildPodium(standings) {
    var podium = document.getElementById('podium');
    var rest = document.getElementById('podiumRest');
    podium.innerHTML = '';
    var top3 = standings.slice(0, 3);
    var order = [top3[1], top3[0], top3[2]];
    order.forEach(function (g) {
      if (!g) return;
      var medal = g.rank === 1 ? '🥇' : g.rank === 2 ? '🥈' : '🥉';
      var pcls = g.rank === 1 ? 'p1' : g.rank === 2 ? 'p2' : 'p3';
      podium.appendChild(el('div', { class: 'pod ' + pcls }, [
        el('div', { class: 'medal' }, [medal]),
        el('div', { class: 'pname' }, [g.name]),
        el('div', { class: 'pwealth mono' }, [fmt(g.score) + ' نقطة']),
        el('div', { class: 'muted' }, ['المركز ' + g.rank])
      ]));
    });
    rest.innerHTML = '';
    standings.slice(3).forEach(function (g) {
      rest.appendChild(el('div', {}, [g.rank + '. ' + g.name + ' — ' + fmt(g.score) + ' نقطة']));
    });
    document.getElementById('podiumOverlay').classList.remove('hidden');
  }

  function onFinished(d) {
    Sound.win();
    launchConfetti();
    buildPodium(d.standings || d.podium || []);
  }
})();
