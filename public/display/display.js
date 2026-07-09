(function () {
  'use strict';
  var el = U.el, fmt = U.fmt;

  var CIRC = 2 * Math.PI * 52;
  var COLORS = 4;
  var lastState = null;
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
  socket.on('question:pick', function () { Sound.go(); });
  socket.on('question:reveal', function () { Sound.reveal(); });
  socket.on('competition:finished', onFinished);

  function show(id, on) { document.getElementById(id).classList[on ? 'remove' : 'add']('hidden'); }

  // ---------- الرأس ----------
  function updateHeader(s) {
    document.getElementById('compName').textContent = s.name || 'مسابقة الألغام';
    document.getElementById('qNum').textContent = s.questionNumber || '—';
    document.getElementById('qTotal').textContent = s.total ? ' / ' + s.total : '';

    var ms = document.getElementById('marketStatus');
    var st = document.getElementById('statusText');
    var live = (s.questionState === 'lies' || s.questionState === 'pick') && !s.paused;
    ms.className = 'market-status ' + (live ? 'open' : s.status === 'finished' ? 'closed' : '');
    var timeUp = (s.questionState === 'lies' || s.questionState === 'pick') && s.timeLeft === 0 && !s.paused;
    st.textContent = s.status === 'finished' ? 'انتهت المسابقة'
      : s.currentIndex < 0 ? 'بانتظار البدء'
      : timeUp ? 'انتهى الوقت ⏰'
      : s.questionState === 'lies' ? 'اكتبوا اللغم 💣'
      : s.questionState === 'pick' ? 'اختاروا الإجابة'
      : s.questionState === 'revealed' ? 'الإجابة الصحيحة' : 'متوقّف';

    var ring = document.getElementById('ringFg');
    var ringTime = document.getElementById('ringTime');
    var q = s.question;
    var dur = (q && q.timeLimitSec) || 45;
    if (s.questionState === 'lies' || s.questionState === 'pick') {
      var frac = Math.max(0, Math.min(1, s.timeLeft / dur));
      ring.style.strokeDashoffset = CIRC * (1 - frac);
      ring.style.stroke = s.timeLeft <= 5 ? 'var(--down)' : '#ffe08a';
      ringTime.textContent = s.timeLeft;
      if (s.timeLeft <= 5 && s.timeLeft > 0) { Sound.countdown(); ringTime.style.color = '#ffd0d4'; }
      else ringTime.style.color = '';
    } else {
      ring.style.strokeDashoffset = 0;
      ringTime.textContent = s.status === 'finished' ? '✓' : s.questionState === 'revealed' ? '✓' : '–';
      ringTime.style.color = '';
    }
  }

  // ---------- العرض ----------
  function render(s) {
    if (!s || !s.active) {
      lastState = s;
      document.getElementById('compName').textContent = 'مسابقة الألغام';
      show('lobby', true); show('stage', false);
      document.getElementById('lobbyTitle').textContent = 'لا توجد مسابقة نشطة';
      document.getElementById('lobbyCount').textContent = '0';
      document.getElementById('lobbyGroups').innerHTML = '';
      return;
    }
    lastState = s;
    updateHeader(s);
    if (s.status !== 'finished') document.getElementById('podiumOverlay').classList.add('hidden');

    if (s.status === 'finished') {
      show('lobby', false); show('stage', false);
      if (document.getElementById('podiumOverlay').classList.contains('hidden')) buildPodium(s.leaderboard || []);
      return;
    }
    if (s.currentIndex < 0 || !s.question) { renderLobby(s); show('lobby', true); show('stage', false); return; }
    show('lobby', false); show('stage', true);
    renderStage(s);
  }

  // ---------- الردهة ----------
  var qrLoaded = false;
  function renderLobby(s) {
    document.getElementById('lobbyTitle').textContent = 'امسح الرمز وانضم!';
    document.getElementById('lobbyCount').textContent = s.groupCount || 0;
    if (!qrLoaded) { document.getElementById('joinQr').src = '/api/join-qr.png?t=' + Date.now(); qrLoaded = true; }
    fetch('/api/config').then(function (r) { return r.json(); }).then(function (c) {
      document.getElementById('joinUrl').textContent = (c.baseUrl || '') + '/player';
    }).catch(function () {});
    var wrap = document.getElementById('lobbyGroups');
    wrap.innerHTML = '';
    (s.lobby || []).forEach(function (g) { wrap.appendChild(el('div', { class: 'chip-team' }, [g.name])); });
  }

  // ---------- منصة السؤال ----------
  function renderStage(s) {
    var q = s.question;
    var ph = s.questionState;
    document.getElementById('qCategory').textContent = q.category || '';
    document.getElementById('qPoints').textContent = q.points ? q.points + ' نقطة' : '';
    document.getElementById('qText').textContent = q.text;

    var answeredEl = document.getElementById('qAnswered');
    var grid = document.getElementById('optGrid');
    var rb = document.getElementById('revealBoard');

    if (ph === 'lies') {
      answeredEl.textContent = '💣 كتب لغمه ' + q.answered + ' من ' + q.total;
      grid.className = 'opt-grid cols1';
      grid.innerHTML = '';
      grid.appendChild(el('div', { class: 'lies-prompt' }, ['اكتبوا جوابًا خاطئًا مقنعًا من جوالاتكم — ليقع فيه غيركم!']));
      rb.classList.add('hidden');
      return;
    }

    if (ph === 'pick') {
      answeredEl.textContent = '✋ اختار ' + q.answered + ' من ' + q.total;
      renderOptions(grid, q.options, null);
      rb.classList.add('hidden');
      return;
    }

    // revealed
    answeredEl.textContent = 'الجواب الصحيح: ' + q.answer;
    renderOptions(grid, q.options, true);
    renderRevealBoard(s.leaderboard || []);
    rb.classList.remove('hidden');
  }

  function renderOptions(grid, options, revealed) {
    grid.className = 'opt-grid ' + (options.length <= 2 ? 'cols1' : options.length <= 6 ? 'cols2' : 'cols2 small');
    grid.innerHTML = '';
    options.forEach(function (o, i) {
      var kids = [ el('span', { class: 'otext' }, [o.text]) ];
      var cls = 'opt-tile mine-tile opt-' + (i % COLORS);
      if (revealed) {
        if (o.truth) { cls += ' correct'; kids.push(el('span', { class: 'tag-correct' }, ['✅ الصحيح'])); }
        else {
          cls += ' dimmed';
          if (o.owners && o.owners.length) kids.push(el('span', { class: 'tag-owner' }, ['💣 ' + o.owners.join('، ')]));
        }
        kids.push(el('span', { class: 'tally' }, [String(o.pickCount || 0)]));
      }
      grid.appendChild(el('div', { class: cls }, kids));
    });
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
    var old = document.querySelector('.confetti'); if (old) old.remove();
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
    standings.slice(3).forEach(function (g) { rest.appendChild(el('div', {}, [g.rank + '. ' + g.name + ' — ' + fmt(g.score) + ' نقطة'])); });
    document.getElementById('podiumOverlay').classList.remove('hidden');
  }
  function onFinished(d) { Sound.win(); launchConfetti(); buildPodium(d.standings || d.podium || []); }
})();
