(function () {
  'use strict';
  var el = U.el, fmt = U.fmt, dirClass = U.dirClass, dirArrow = U.dirArrow;

  var CIRC = 2 * Math.PI * 52; // محيط دائرة العدّاد
  var lastState = null;
  var animating = false;
  var rowMap = {}; // stockId -> DOM row
  var socket = io({ auth: { role: 'display' } });

  // ---------- طبقة البدء (تفعيل الصوت) ----------
  document.getElementById('startBtn').addEventListener('click', function () {
    Sound.unlock();
    document.getElementById('startOverlay').classList.add('hidden');
  });

  socket.on('state', render);
  socket.on('tick', function (t) {
    if (lastState) { lastState.timeLeft = t.timeLeft; updateHeader(lastState); }
  });
  socket.on('round:open', onRoundOpen);
  socket.on('round:transition', onTransition);
  socket.on('competition:finished', onFinished);

  // ---------- الرأس ----------
  function updateHeader(s) {
    document.getElementById('compName').textContent = s.name || 'منافسة الأسهم التعليمية';
    document.getElementById('roundNum').textContent = s.currentRound || '—';
    document.getElementById('roundTotal').textContent = s.rounds ? ' / ' + s.rounds : '';

    var ms = document.getElementById('marketStatus');
    var st = document.getElementById('statusText');
    var open = s.roundState === 'open';
    ms.className = 'market-status ' + (open ? 'open' : s.status === 'finished' ? 'closed' : '');
    st.textContent = s.status === 'finished' ? 'انتهت المنافسة'
      : s.currentRound === 0 ? 'بانتظار البدء'
      : open ? 'السوق مفتوح'
      : s.roundState === 'transition' ? 'تحديث السوق' : 'السوق مغلق';

    // العدّاد الدائري
    var ring = document.getElementById('ringFg');
    var ringTime = document.getElementById('ringTime');
    var dur = s.roundDurationSec || 1;
    var frac = open ? Math.max(0, Math.min(1, s.timeLeft / dur)) : (open ? 1 : 0);
    if (s.roundState === 'open') {
      ring.style.strokeDashoffset = CIRC * (1 - frac);
      ring.style.stroke = s.timeLeft <= 5 ? 'var(--down)' : s.timeLeft <= 10 ? 'var(--accent)' : 'var(--accent)';
      ringTime.textContent = s.timeLeft;
      if (s.timeLeft <= 5 && s.timeLeft > 0) { Sound.countdown(); ringTime.style.color = 'var(--down)'; }
      else { ringTime.style.color = ''; }
    } else {
      ring.style.strokeDashoffset = 0;
      ringTime.textContent = s.status === 'finished' ? '✓' : '–';
      ringTime.style.color = '';
    }
  }

  // ---------- العرض الكامل ----------
  function render(s) {
    if (!s || !s.active) { lastState = s; return; }
    var prev = lastState;
    lastState = s;
    updateHeader(s);
    renderLeaderboard(s, prev);
    renderNews(s);
    if (!animating) renderTickers(s, prev);
  }

  function renderTickers(s, prev) {
    var grid = document.getElementById('tickerGrid');
    var prevPrices = {};
    if (prev && prev.stocks) prev.stocks.forEach(function (p) { prevPrices[p.id] = p.price; });

    // إعادة بناء إذا تغيّر عدد/ترتيب الأسهم
    var ids = s.stocks.map(function (x) { return x.id; }).join(',');
    if (grid.dataset.ids !== ids) {
      grid.innerHTML = ''; rowMap = {};
      s.stocks.forEach(function (st) {
        var row = buildRow(st);
        rowMap[st.id] = row;
        grid.appendChild(row);
      });
      grid.dataset.ids = ids;
    }
    s.stocks.forEach(function (st) { updateRow(rowMap[st.id], st, prevPrices[st.id]); });
  }

  function buildRow(st) {
    return el('div', { class: 'ticker-row', 'data-id': st.id }, [
      el('div', { class: 'name' }, [ el('span', { class: 'spark' }), el('span', { class: 'nm' }, [st.name]) ]),
      el('div', { class: 'price mono' }, ['0']),
      el('div', { class: 'change mono' }, ['—'])
    ]);
  }

  function updateRow(row, st, prevPrice) {
    if (!row) return;
    var dc = dirClass(st.direction);
    row.querySelector('.spark').className = 'spark ' + dc;
    row.querySelector('.price').textContent = fmt(st.price);
    row.querySelector('.price').className = 'price mono ' + dc;
    var ch = row.querySelector('.change');
    ch.textContent = dirArrow(st.direction) + ' ' + U.pct(st.lastChangePct);
    ch.className = 'change mono ' + dc;
    if (prevPrice !== undefined && prevPrice !== st.price) {
      row.classList.remove('up-flash', 'down-flash');
      void row.offsetWidth;
      row.classList.add(st.price > prevPrice ? 'up-flash' : 'down-flash');
      setTimeout(function () { row.classList.remove('up-flash', 'down-flash'); }, 900);
    }
  }

  function renderLeaderboard(s, prev) {
    var list = document.getElementById('leaderList');
    var lb = s.leaderboard || [];
    if (s.currentRound === 0) { list.innerHTML = '<div class="muted center" style="padding:20px;">تبدأ لوحة الترتيب بعد أول جولة</div>'; return; }
    list.innerHTML = '';
    lb.forEach(function (g) {
      var medal = g.rank === 1 ? '🥇' : g.rank === 2 ? '🥈' : g.rank === 3 ? '🥉' : '';
      var pc = g.pnl > 0 ? 'up' : g.pnl < 0 ? 'down' : 'flat';
      var row = el('div', { class: 'leader-row' + (g.rank <= 3 ? ' r' + g.rank : '') }, [
        el('div', { class: 'rank' }, [medal || String(g.rank)]),
        el('div', {}, [ el('div', { class: 'gname' }, [g.name]), el('div', { class: 'pnl ' + pc }, [U.pct(g.pnlPct)]) ]),
        el('div', { class: 'wealth mono' }, [fmt(g.wealth)])
      ]);
      list.appendChild(row);
    });
  }

  function renderNews(s) {
    var track = document.getElementById('newsTrack');
    var news = (s.news && s.news.length) ? s.news : ['بانتظار بدء التداول...'];
    track.innerHTML = news.map(function (n) { return '<span>' + escapeHtml(n) + '</span>'; }).join('•');
  }
  function escapeHtml(t) { var d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

  // ---------- أحداث الجولات ----------
  function onRoundOpen(d) {
    hideTransition();
    Sound.roundStart();
    if (lastState) renderTickers(lastState, null);
  }

  function onTransition(d) {
    animating = true;
    Sound.roundEnd();
    var overlay = document.getElementById('transitionOverlay');
    var countBig = document.getElementById('countBig');
    var transMsg = document.getElementById('transMsg');
    transMsg.textContent = 'تحديث أسعار السوق...';
    overlay.classList.remove('hidden');

    var seq = ['3', '2', '1'];
    var i = 0;
    function step() {
      if (i < seq.length) {
        countBig.textContent = seq[i];
        countBig.classList.remove('count-big'); void countBig.offsetWidth; countBig.classList.add('count-big');
        Sound.countdown();
        i++;
        setTimeout(step, 700);
      } else {
        countBig.textContent = '';
        transMsg.textContent = '📈 تتحرك الأسعار...';
        animatePrices(d.moves, 2000, function () {
          hideTransition();
          animating = false;
          if (lastState) render(lastState); // مزامنة نهائية
        });
      }
    }
    step();
  }

  function animatePrices(moves, duration, done) {
    if (!moves || !moves.length) { if (done) done(); return; }
    var start = performance.now();
    var byId = {};
    moves.forEach(function (m) { byId[m.id] = m; });
    var soundThrottle = 0;

    function frame(now) {
      var t = Math.min(1, (now - start) / duration);
      var ease = 1 - Math.pow(1 - t, 3);
      moves.forEach(function (m) {
        var row = rowMap[m.id];
        if (!row) return;
        var val = m.prevPrice + (m.price - m.prevPrice) * ease;
        var dc = m.direction;
        row.querySelector('.price').textContent = fmt(val);
        row.querySelector('.price').className = 'price mono ' + dc;
        row.querySelector('.spark').className = 'spark ' + dc;
      });
      if (t < 1) {
        if (now - soundThrottle > 140) { soundThrottle = now; }
        requestAnimationFrame(frame);
      } else {
        // القيم النهائية + وميض
        moves.forEach(function (m) {
          var row = rowMap[m.id];
          if (!row) return;
          updateRow(row, { price: m.price, direction: m.direction, lastChangePct: m.changePct }, m.prevPrice);
        });
        if (done) done();
      }
    }
    requestAnimationFrame(frame);
  }

  function hideTransition() { document.getElementById('transitionOverlay').classList.add('hidden'); }

  // ---------- التتويج ----------
  function onFinished(d) {
    Sound.win();
    var overlay = document.getElementById('podiumOverlay');
    var podium = document.getElementById('podium');
    var rest = document.getElementById('podiumRest');
    podium.innerHTML = '';
    var top = d.podium || [];
    var order = [top[1], top[0], top[2]]; // فضي، ذهبي، برونزي (للترتيب البصري)
    var cls = { }; cls[top[0] && top[0].id] = 'p1';
    order.forEach(function (g, idx) {
      if (!g) return;
      var rank = g.rank;
      var medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉';
      var pcls = rank === 1 ? 'p1' : rank === 2 ? 'p2' : 'p3';
      podium.appendChild(el('div', { class: 'pod ' + pcls }, [
        el('div', { class: 'medal' }, [medal]),
        el('div', { class: 'pname' }, [g.name]),
        el('div', { class: 'pwealth mono' }, [U.fmtMoney(g.wealth)]),
        el('div', { class: 'muted' }, ['المركز ' + rank])
      ]));
    });
    // بقية المجموعات من لوحة الترتيب الحالية
    rest.innerHTML = '';
    if (lastState && lastState.leaderboard) {
      lastState.leaderboard.slice(3).forEach(function (g) {
        rest.appendChild(el('div', {}, [g.rank + '. ' + g.name + ' — ' + U.fmtMoney(g.wealth)]));
      });
    }
    overlay.classList.remove('hidden');
  }
})();
