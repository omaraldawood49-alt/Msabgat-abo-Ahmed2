(function () {
  'use strict';
  var el = U.el, fmt = U.fmt, dirClass = U.dirClass;

  var CIRC = 2 * Math.PI * 52; // محيط دائرة العدّاد
  var lastState = null;
  var animating = false;
  var cardMap = {};   // stockId -> عناصر البطاقة
  var histMap = {};   // stockId -> مصفوفة الأسعار (للمخطط)
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
    document.getElementById('compName').textContent = s.name || 'بورصة رواحل';
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

    var ring = document.getElementById('ringFg');
    var ringTime = document.getElementById('ringTime');
    var dur = s.roundDurationSec || 1;
    if (s.roundState === 'open') {
      var frac = Math.max(0, Math.min(1, s.timeLeft / dur));
      ring.style.strokeDashoffset = CIRC * (1 - frac);
      ring.style.stroke = s.timeLeft <= 5 ? 'var(--down)' : '#ffe08a';
      ringTime.textContent = s.timeLeft;
      if (s.timeLeft <= 5 && s.timeLeft > 0) { Sound.countdown(); ringTime.style.color = '#ffd0d4'; }
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
    lastState = s;
    updateHeader(s);
    renderNews(s);
    if (!animating) renderCards(s);
  }

  // ---------- شبكة البطاقات الزجاجية ----------
  function renderCards(s) {
    var grid = document.getElementById('stockGrid');
    var ids = s.stocks.map(function (x) { return x.id; }).join(',');
    if (grid.dataset.ids !== ids) {
      grid.innerHTML = ''; cardMap = {};
      s.stocks.forEach(function (st) { grid.appendChild(buildCard(st)); });
      grid.dataset.ids = ids;
    }
    s.stocks.forEach(function (st) {
      pushHist(st);
      updateCard(st, true);
    });
  }

  function buildCard(st) {
    var name = el('div', { class: 'gc-name' }, [st.name]);
    var arrow = el('div', { class: 'gc-arrow' }, ['▬']);
    var price = el('div', { class: 'gc-price mono' }, ['0']);
    var spark = el('div', { class: 'gc-spark' });
    var change = el('div', { class: 'gc-change mono' }, ['—']);
    var card = el('div', { class: 'gcard', 'data-id': st.id }, [
      el('div', { class: 'gc-top' }, [name, arrow]),
      price, spark, change
    ]);
    cardMap[st.id] = { card: card, name: name, arrow: arrow, price: price, spark: spark, change: change };
    return card;
  }

  function pushHist(st) {
    var h = histMap[st.id];
    if (!h) { histMap[st.id] = h = [Number(st.startPrice) || st.price]; }
    if (h[h.length - 1] !== st.price) { h.push(st.price); if (h.length > 24) h.shift(); }
  }

  function updateCard(st, flash) {
    var c = cardMap[st.id];
    if (!c) return;
    var dc = dirClass(st.direction);
    c.name.textContent = st.name;
    c.arrow.className = 'gc-arrow ' + dc;
    c.arrow.textContent = st.direction === 'up' ? '▲' : st.direction === 'down' ? '▼' : '▬';
    var prevText = c.price.textContent;
    c.price.textContent = fmt(st.price);
    c.change.className = 'gc-change mono ' + dc;
    c.change.textContent = (st.lastChangePct > 0 ? '▲ ' : st.lastChangePct < 0 ? '▼ ' : '') + U.pct(st.lastChangePct);
    c.spark.innerHTML = sparkSVG(histMap[st.id] || [st.price], st.direction);
    if (flash && prevText !== '0' && prevText !== c.price.textContent) {
      c.card.classList.remove('up-flash', 'down-flash'); void c.card.offsetWidth;
      c.card.classList.add(st.direction === 'down' ? 'down-flash' : 'up-flash');
      setTimeout(function () { c.card.classList.remove('up-flash', 'down-flash'); }, 1000);
    }
  }

  function sparkSVG(hist, dir) {
    var w = 200, h = 40, pad = 3, a = hist.slice();
    if (a.length < 2) a = [a[0] || 0, a[0] || 0];
    var mn = Math.min.apply(null, a), mx = Math.max.apply(null, a), flat = mx === mn, rng = (mx - mn) || 1;
    var pts = a.map(function (v, i) {
      var x = pad + i / (a.length - 1) * (w - 2 * pad);
      var y = flat ? h / 2 : h - pad - (v - mn) / rng * (h - 2 * pad);
      return [x, y];
    });
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    var area = line + ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + (h - pad) + ' L' + pts[0][0].toFixed(1) + ' ' + (h - pad) + ' Z';
    var color = dir === 'up' ? '#8effc9' : dir === 'down' ? '#ffb3bd' : '#ffffff';
    var id = 'sp' + Math.random().toString(36).slice(2, 7);
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
      '<defs><linearGradient id="' + id + '" x1="0" x2="0" y1="0" y2="1">' +
      '<stop offset="0" stop-color="' + color + '" stop-opacity=".38"/><stop offset="1" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="' + area + '" fill="url(#' + id + ')"/>' +
      '<path d="' + line + '" fill="none" stroke="' + color + '" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>';
  }

  function renderNews(s) {
    var track = document.getElementById('newsTrack');
    var news = (s.news && s.news.length) ? s.news : ['بانتظار بدء التداول...'];
    track.innerHTML = news.map(function (n) { return '<span>' + escapeHtml(n) + '</span>'; }).join('•');
  }
  function escapeHtml(t) { var d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

  // ---------- أحداث الجولات ----------
  var splashTimer = null;
  function onRoundOpen(d) {
    animating = false;
    Sound.roundStart();
    if (lastState) renderCards(lastState);
    showRoundSplash(d.round);
  }

  function showRoundSplash(n) {
    var overlay = document.getElementById('transitionOverlay');
    var countBig = document.getElementById('countBig');
    var transMsg = document.getElementById('transMsg');
    countBig.textContent = 'الجولة ' + n;
    countBig.style.fontSize = '104px';
    countBig.classList.remove('count-big'); void countBig.offsetWidth; countBig.classList.add('count-big');
    transMsg.textContent = '🚀 انطلقوا!';
    overlay.classList.remove('hidden');
    Sound.go();
    clearTimeout(splashTimer);
    splashTimer = setTimeout(function () { overlay.classList.add('hidden'); countBig.style.fontSize = ''; }, 1500);
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
        countBig.textContent = seq[i]; countBig.style.fontSize = '';
        countBig.classList.remove('count-big'); void countBig.offsetWidth; countBig.classList.add('count-big');
        Sound.countdown(); i++;
        setTimeout(step, 700);
      } else {
        countBig.textContent = '';
        transMsg.textContent = '📈 تتحرك الأسعار...';
        animatePrices(d.moves, 2000, function () {
          hideTransition();
          animating = false;
          if (lastState) render(lastState);
        });
      }
    }
    step();
  }

  function animatePrices(moves, duration, done) {
    if (!moves || !moves.length) { if (done) done(); return; }
    var start = performance.now();
    function frame(now) {
      var t = Math.min(1, (now - start) / duration);
      var ease = 1 - Math.pow(1 - t, 3);
      moves.forEach(function (m) {
        var c = cardMap[m.id];
        if (!c) return;
        var val = m.prevPrice + (m.price - m.prevPrice) * ease;
        c.price.textContent = fmt(val);
        c.arrow.className = 'gc-arrow ' + m.direction;
        c.arrow.textContent = m.direction === 'up' ? '▲' : m.direction === 'down' ? '▼' : '▬';
      });
      if (t < 1) { requestAnimationFrame(frame); }
      else {
        moves.forEach(function (m) {
          var st = { id: m.id, name: (cardMap[m.id] ? cardMap[m.id].name.textContent : ''), price: m.price, direction: m.direction, lastChangePct: m.changePct, startPrice: m.prevPrice };
          pushHist(st); updateCard(st, true);
        });
        if (done) done();
      }
    }
    requestAnimationFrame(frame);
  }

  function hideTransition() { document.getElementById('transitionOverlay').classList.add('hidden'); }

  // ---------- التتويج (يُكشف الترتيب هنا فقط) ----------
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

  function onFinished(d) {
    Sound.win();
    launchConfetti();
    var standings = d.standings || d.podium || [];
    var podium = document.getElementById('podium');
    var rest = document.getElementById('podiumRest');
    podium.innerHTML = '';
    var top3 = standings.slice(0, 3);
    var order = [top3[1], top3[0], top3[2]]; // فضي، ذهبي، برونزي (بصريًا)
    order.forEach(function (g) {
      if (!g) return;
      var medal = g.rank === 1 ? '🥇' : g.rank === 2 ? '🥈' : '🥉';
      var pcls = g.rank === 1 ? 'p1' : g.rank === 2 ? 'p2' : 'p3';
      podium.appendChild(el('div', { class: 'pod ' + pcls }, [
        el('div', { class: 'medal' }, [medal]),
        el('div', { class: 'pname' }, [g.name]),
        el('div', { class: 'pwealth mono' }, [U.fmtMoney(g.wealth)]),
        el('div', { class: 'muted' }, ['المركز ' + g.rank])
      ]));
    });
    rest.innerHTML = '';
    standings.slice(3).forEach(function (g) {
      rest.appendChild(el('div', {}, [g.rank + '. ' + g.name + ' — ' + U.fmtMoney(g.wealth)]));
    });
    document.getElementById('podiumOverlay').classList.remove('hidden');
  }
})();
