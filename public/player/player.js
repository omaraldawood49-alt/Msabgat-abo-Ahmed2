(function () {
  'use strict';
  var el = U.el, fmt = U.fmt, dirClass = U.dirClass, dirArrow = U.dirArrow;

  var socket = null;
  var lastState = null;
  var qtyMemory = {}; // حفظ الكمية المُدخلة لكل سهم

  var joinScreen = document.getElementById('joinScreen');
  var gameScreen = document.getElementById('gameScreen');
  var codeInput = document.getElementById('codeInput');
  var joinBtn = document.getElementById('joinBtn');
  var joinErr = document.getElementById('joinErr');

  // ---------- الدخول ----------
  function connect(code) {
    Sound.unlock();
    socket = io({ auth: { role: 'player', code: code } });

    socket.on('auth:ok', function () {
      try { localStorage.setItem('sm_code', code); } catch (e) {}
      joinScreen.classList.add('hidden');
      gameScreen.classList.remove('hidden');
    });
    socket.on('auth:error', function (e) {
      joinErr.textContent = e.error || 'تعذّر الدخول';
      joinBtn.disabled = false;
    });
    socket.on('state', render);
    socket.on('tick', function (t) {
      if (lastState) { lastState.timeLeft = t.timeLeft; updateStatus(lastState); }
    });
    socket.on('round:open', function () { Sound.roundStart(); });
    socket.on('round:transition', function () { Sound.roundEnd(); });
    socket.on('room:closed', function () {
      setBanner('أُغلقت هذه الغرفة من قِبل المشرف', true);
      var g = document.getElementById('gameScreen'); if (g) g.classList.add('hidden');
      var j = document.getElementById('joinScreen'); if (j) j.classList.remove('hidden');
      joinErr.textContent = 'أُغلقت الغرفة';
    });
    socket.on('disconnect', function () { setBanner('انقطع الاتصال — تتم إعادة المحاولة...', true); });
  }

  function doJoin() {
    var code = (codeInput.value || '').trim().toUpperCase();
    if (code.length < 3) { joinErr.textContent = 'أدخل كودًا صحيحًا'; return; }
    joinErr.textContent = '';
    joinBtn.disabled = true;
    connect(code);
  }
  joinBtn.addEventListener('click', doJoin);
  codeInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') doJoin(); });

  // كود من الرابط (QR) أو من الجلسة السابقة
  var urlCode = U.qs('code');
  if (urlCode) { codeInput.value = urlCode.toUpperCase(); connect(urlCode.trim().toUpperCase()); }

  // ---------- زر الصوت ----------
  var soundBtn = document.getElementById('soundBtn');
  soundBtn.addEventListener('click', function () {
    var on = !Sound.isEnabled();
    Sound.setEnabled(on);
    soundBtn.textContent = on ? '🔊' : '🔇';
  });

  // ---------- العرض ----------
  function updateStatus(s) {
    var line = document.getElementById('statusLine');
    var txt = document.getElementById('statusText');
    var info = document.getElementById('roundInfo');
    var open = s.tradingOpen;
    line.className = 'status-line ' + (open ? 'open' : 'closed');
    if (s.status === 'finished') { txt.textContent = 'انتهت المنافسة'; }
    else if (s.status === 'setup' || s.currentRound === 0) { txt.textContent = 'بانتظار بدء المنافسة'; }
    else if (open) { txt.textContent = 'التداول مفتوح'; }
    else if (s.roundState === 'transition') { txt.textContent = 'تحديث السوق...'; }
    else { txt.textContent = 'التداول مغلق'; }
    if (s.currentRound > 0) {
      info.textContent = 'جولة ' + s.currentRound + '/' + s.rounds + (open ? '  •  ⏱ ' + s.timeLeft + 'ث' : '');
    } else { info.textContent = ''; }
  }

  function setBanner(msg, show) {
    var b = document.getElementById('banner');
    if (!show) { b.classList.add('hidden'); return; }
    b.textContent = msg;
    b.classList.remove('hidden');
  }

  function render(s) {
    if (!s || !s.active) {
      setBanner('لا توجد منافسة نشطة حاليًا', true);
      document.getElementById('gName').textContent = '—';
      return;
    }
    var prev = lastState;
    lastState = s;

    document.getElementById('gName').textContent = s.group.name;
    document.getElementById('compName').textContent = s.name;
    var cashEl = document.getElementById('gCash');
    cashEl.textContent = fmt(s.group.cash);
    if (prev && prev.group && prev.group.cash !== s.group.cash) {
      cashEl.classList.remove('flash'); void cashEl.offsetWidth; cashEl.classList.add('flash');
    }

    updateStatus(s);

    if (s.status === 'finished') setBanner('انتهت المنافسة — شكرًا لمشاركتكم! 🏆', true);
    else if (!s.tradingOpen) setBanner(s.roundState === 'transition' ? '🔄 يتم تحديث الأسعار...' : '⏸ التداول مغلق — انتظر بدء الجولة', true);
    else setBanner('', false);

    renderStocks(s);
  }

  var rowMap = {}; // stockId -> { card, price, chip, owned, buy, sell, qtyInput }

  function renderStocks(s) {
    var list = document.getElementById('stockList');
    var open = s.tradingOpen;

    // إعادة البناء فقط عند تغيّر مجموعة الأسهم (وإلا تحديث في المكان لتفادي القفز)
    var ids = s.stocks.map(function (x) { return x.id; }).join(',');
    if (list.dataset.ids !== ids) {
      list.innerHTML = ''; rowMap = {};
      s.stocks.forEach(function (st) { list.appendChild(buildCard(st)); });
      list.dataset.ids = ids;
    }

    s.stocks.forEach(function (st) {
      var r = rowMap[st.id];
      if (!r) return;
      var dc = dirClass(st.direction);
      var prevText = r.price.textContent;
      r.price.textContent = fmt(st.price);
      r.price.className = 'p mono ' + dc;
      r.chip.className = 'chip chip-' + dc;
      r.chip.textContent = dirArrow(st.direction) + ' ' + U.pct(st.lastChangePct);
      r.owned.textContent = 'تملك: ' + (st.owned || 0) + ' سهم';
      r.buy.disabled = !open;
      r.sell.disabled = !(open && st.owned > 0);
      if (prevText !== r.price.textContent && prevText !== '0') {
        r.price.classList.remove('flash'); void r.price.offsetWidth; r.price.classList.add('flash');
      }
    });
  }

  function buildCard(st) {
    var qty = qtyMemory[st.id] || 1;
    var qtyInput = el('input', {
      class: 'qty-input', type: 'number', min: '1', step: '1', value: qty, inputmode: 'numeric',
      oninput: function () { qtyMemory[st.id] = Math.max(1, parseInt(this.value || '1', 10)); }
    });
    var buyBtn = el('button', { class: 'btn btn-buy btn-sm', text: 'شراء', onclick: function () { trade(st.id, 'buy', qtyInput.value); } });
    var sellBtn = el('button', { class: 'btn btn-sell btn-sm', text: 'بيع', onclick: function () { trade(st.id, 'sell', qtyInput.value); } });
    var priceEl = el('div', { class: 'p mono' }, ['0']);
    var chipEl = el('div', { class: 'chip chip-flat', style: 'margin-top:4px;' }, ['＝']);
    var ownedEl = el('div', { class: 'sc-owned' }, ['تملك: 0 سهم']);
    var card = el('div', { class: 'panel stock-card' }, [
      el('div', { class: 'sc-top' }, [
        el('div', {}, [ el('div', { class: 'sc-name' }, [st.name]), ownedEl ]),
        el('div', { class: 'sc-price' }, [priceEl, chipEl])
      ]),
      el('div', { class: 'sc-actions' }, [qtyInput, buyBtn, sellBtn])
    ]);
    rowMap[st.id] = { card: card, price: priceEl, chip: chipEl, owned: ownedEl, buy: buyBtn, sell: sellBtn, qtyInput: qtyInput };
    return card;
  }

  function trade(stockId, side, qty) {
    var q = Math.max(1, parseInt(qty || '1', 10));
    socket.emit('player:trade', { stockId: stockId, side: side, qty: q }, function (res) {
      if (res && res.ok) {
        (side === 'buy' ? Sound.buy : Sound.sell)();
        U.toast(side === 'buy' ? 'تم الشراء ✅' : 'تم البيع ✅', 'ok');
      } else {
        Sound.error();
        U.toast((res && res.error) || 'فشلت العملية', 'err');
      }
    });
  }
})();
