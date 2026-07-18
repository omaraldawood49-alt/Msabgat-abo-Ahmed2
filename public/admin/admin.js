(function () {
  'use strict';
  var el = U.el, fmt = U.fmt;

  var socket = null;
  var state = null;
  var currentRoom = null, currentKey = null;

  var startScreen = document.getElementById('startScreen');
  var dashboard = document.getElementById('dashboard');
  var startErr = document.getElementById('startErr');

  function keyStore(rid) { return 'rawahil_host_' + rid; }

  // ---------- الاتصال ----------
  function connect() {
    var rid = (U.qs('room') || '').toUpperCase() || null;
    var hk = rid ? (localStorage.getItem(keyStore(rid)) || null) : null;
    socket = io({ auth: { role: 'admin', roomId: rid || undefined, hostKey: hk || undefined } });

    socket.on('auth:ok', function (d) {
      if (d && d.roomId) enterRoom(d.roomId, hk);
    });
    socket.on('auth:error', function (e) {
      // فشل ربط غرفة من الرابط — أظهر شاشة البداية
      if (rid) { try { localStorage.removeItem(keyStore(rid)); } catch (x) {} history.replaceState(null, '', location.pathname); }
      startErr.textContent = e && e.error ? e.error : '';
    });
    socket.on('state', function (s) { state = s; render(); });
    socket.on('tick', function (t) {
      if (state) { state.timeLeft = t.timeLeft; document.getElementById('cbTimer').textContent = state.roundState === 'open' ? '⏱ ' + t.timeLeft : ''; }
    });
  }

  function send(event, payload) {
    return new Promise(function (resolve) {
      socket.emit(event, payload || {}, function (res) {
        if (res && res.ok) resolve(res.data || {});
        else { U.toast((res && res.error) || 'حدث خطأ', 'err'); resolve(null); }
      });
    });
  }

  function enterRoom(roomId, hostKey) {
    currentRoom = roomId;
    currentKey = hostKey || (localStorage.getItem(keyStore(roomId)) || '');
    startScreen.classList.add('hidden');
    dashboard.classList.remove('hidden');
    var link = location.origin + '/display?room=' + roomId;
    document.getElementById('riCode').textContent = roomId;
    document.getElementById('riKey').textContent = currentKey || '—';
    var a = document.getElementById('riDisplay'); a.textContent = link; a.href = link;
    var l2 = document.getElementById('lnkDisplay'); l2.textContent = link; l2.href = link;
  }

  // ---------- شاشة البداية ----------
  document.getElementById('segNew').onclick = function () { seg('New'); };
  document.getElementById('segResume').onclick = function () { seg('Resume'); };
  function seg(which) {
    document.getElementById('segNew').classList.toggle('active', which === 'New');
    document.getElementById('segResume').classList.toggle('active', which === 'Resume');
    document.getElementById('paneNew').classList.toggle('hidden', which !== 'New');
    document.getElementById('paneResume').classList.toggle('hidden', which !== 'Resume');
    startErr.textContent = '';
  }

  document.getElementById('btnCreateRoom').onclick = function () {
    var opts = {
      name: document.getElementById('setName').value || 'بورصة الأسهم',
      pricingMode: document.getElementById('setMode').value,
      rounds: parseInt(document.getElementById('setRounds').value, 10) || 10,
      roundDurationSec: parseInt(document.getElementById('setDuration').value, 10) || 90,
      initialCapital: parseFloat(document.getElementById('setCapital').value) || 100000,
      groupCount: parseInt(document.getElementById('setGroups').value, 10) || 4,
      stockCount: parseInt(document.getElementById('setStocks').value, 10) || 25,
    };
    send('admin:createRoom', opts).then(function (res) {
      if (!res) return;
      try { localStorage.setItem(keyStore(res.roomId), res.hostKey); } catch (x) {}
      history.replaceState(null, '', '?room=' + res.roomId);
      enterRoom(res.roomId, res.hostKey);
      U.toast('تم إنشاء الغرفة ' + res.roomId, 'ok');
    });
  };

  document.getElementById('btnResume').onclick = function () {
    var rid = (document.getElementById('resumeRoom').value || '').trim().toUpperCase();
    var hk = (document.getElementById('resumeKey').value || '').trim().toUpperCase();
    if (!rid || !hk) { startErr.textContent = 'أدخل رمز الغرفة ورمز التحكم'; return; }
    send('admin:attachRoom', { roomId: rid, hostKey: hk }).then(function (res) {
      if (!res) return;
      try { localStorage.setItem(keyStore(rid), hk); } catch (x) {}
      history.replaceState(null, '', '?room=' + rid);
      enterRoom(rid, hk);
    });
  };

  // ---------- التبويبات ----------
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
      document.querySelectorAll('.tab-pane').forEach(function (x) { x.classList.remove('active'); });
      t.classList.add('active');
      document.getElementById('tab-' + t.dataset.tab).classList.add('active');
    });
  });

  // ---------- أزرار التحكم ----------
  document.getElementById('btnStart').onclick = function () { send('admin:start'); };
  document.getElementById('btnPause').onclick = function () { send('admin:pause'); };
  document.getElementById('btnResumeR').onclick = function () { send('admin:resume'); };
  document.getElementById('btnEndRound').onclick = function () { send('admin:endRound'); };
  document.getElementById('btnNext').onclick = function () { send('admin:nextRound'); };
  document.getElementById('btnFinish').onclick = function () { if (confirm('إنهاء المنافسة الآن؟')) send('admin:finish'); };
  document.getElementById('btnClose').onclick = function () {
    if (!confirm('إغلاق الغرفة نهائيًا؟ سيخرج كل المشاركين.')) return;
    send('admin:closeRoom').then(function () {
      try { localStorage.removeItem(keyStore(currentRoom)); } catch (x) {}
      location.href = location.pathname;
    });
  };

  document.getElementById('btnSaveSettings').onclick = function () {
    send('admin:updateSettings', {
      name: document.getElementById('edName').value,
      pricingMode: document.getElementById('edMode').value,
      rounds: document.getElementById('edRounds').value,
      roundDurationSec: document.getElementById('edDuration').value,
      initialCapital: document.getElementById('edCapital').value,
    }).then(function () { U.toast('تم الحفظ', 'ok'); });
  };

  document.getElementById('btnAddStock').onclick = function () { send('admin:stock:add', { name: 'سهم جديد', price: 10 }); };
  document.getElementById('btnAddGroup').onclick = function () { send('admin:group:add', {}); };
  document.getElementById('btnMassAdd').onclick = function () { massCash(1); };
  document.getElementById('btnMassSub').onclick = function () { massCash(-1); };
  function massCash(sign) {
    var amt = parseFloat(document.getElementById('massAmount').value);
    if (!amt || amt <= 0) { U.toast('أدخل مبلغًا صحيحًا', 'err'); return; }
    send('admin:cash', { groupId: 'ALL', amount: sign * amt });
  }

  document.getElementById('riCopyDisplay').onclick = function () {
    var link = location.origin + '/display?room=' + currentRoom;
    if (navigator.clipboard) navigator.clipboard.writeText(link).then(function () { U.toast('نُسخ رابط العرض', 'ok'); });
    else U.toast(link, 'ok');
  };

  // ---------- نافذة QR ----------
  var qrModal = document.getElementById('qrModal');
  document.getElementById('qrClose').onclick = function () { qrModal.classList.add('hidden'); };
  qrModal.addEventListener('click', function (e) { if (e.target === qrModal) qrModal.classList.add('hidden'); });
  function openQr(title, imgSrc, code, url) {
    document.getElementById('qrTitle').textContent = title;
    document.getElementById('qrCode').textContent = code;
    document.getElementById('qrImg').src = imgSrc;
    document.getElementById('qrUrl').textContent = url || '';
    qrModal.classList.remove('hidden');
  }
  function showQR(group) {
    openQr(group.name, '/api/qr/' + group.code + '.png?t=' + Date.now(), group.code, '');
    fetch('/api/join-url/' + group.code).then(function (r) { return r.json(); }).then(function (d) {
      document.getElementById('qrUrl').textContent = d.url;
    });
  }
  document.getElementById('riShareQr').onclick = function () {
    if (!currentRoom) return;
    var link = location.origin + '/display?room=' + currentRoom;
    openQr('باركود شاشة العرض — غرفة ' + currentRoom, '/api/room-qr/' + currentRoom + '.png?t=' + Date.now(), currentRoom, link);
  };

  // ---------- العرض ----------
  var lastCompId = null;
  function render() {
    if (!state || !state.active) return;
    var badge = document.getElementById('statusBadge');
    badge.textContent = state.status === 'finished' ? 'انتهت'
      : state.currentRound === 0 ? 'جاهزة للبدء'
      : state.roundState === 'open' ? (state.paused ? 'متوقفة مؤقتًا' : 'التداول مفتوح')
      : state.roundState === 'transition' ? 'تحديث السوق' : 'مغلقة';
    document.getElementById('cbRound').textContent = state.currentRound;
    document.getElementById('cbTotal').textContent = ' / ' + state.rounds;
    document.getElementById('cbTimer').textContent = (state.roundState === 'open') ? '⏱ ' + state.timeLeft : '';
    document.getElementById('cbMode').textContent = state.pricingMode === 'manual' ? 'نمط يدوي' : 'نمط تلقائي';

    updateControlButtons();

    if (state.id !== lastCompId) { lastCompId = state.id; fillSettings(state); }
    document.getElementById('setupHint').textContent = state.currentRound > 0
      ? 'المنافسة قيد التشغيل.' : 'جاهزة — عدّل الأسهم والمجموعات ثم اضغط «بدء».';

    renderStocks();
    renderGroups();
  }

  function fillSettings(s) {
    document.getElementById('edName').value = s.name || '';
    document.getElementById('edMode').value = s.pricingMode || 'auto';
    document.getElementById('edRounds').value = s.rounds || 10;
    document.getElementById('edDuration').value = s.roundDurationSec || 90;
    document.getElementById('edCapital').value = s.initialCapital || 100000;
  }

  function updateControlButtons() {
    var open = state.roundState === 'open', trans = state.roundState === 'transition';
    var finished = state.status === 'finished', notStarted = state.currentRound === 0;
    function set(id, show) { document.getElementById(id).style.display = show ? '' : 'none'; }
    set('btnStart', notStarted || (open && state.paused));
    set('btnPause', open && !state.paused);
    set('btnResumeR', open && state.paused);
    set('btnEndRound', open);
    set('btnNext', trans);
    set('btnFinish', !finished && state.currentRound > 0);
  }

  function renderStocks() {
    var wrap = document.getElementById('stockTable');
    if (isEditing(wrap)) return;
    var manual = state.pricingMode === 'manual';
    document.getElementById('stockCount').textContent = '(' + state.stocks.length + ')';
    document.getElementById('manualHint').textContent = manual
      ? 'النمط يدوي: اضبط نِسَب التغيّر % لكل جولة (1–10)، وتتكرر بعد العاشرة.'
      : 'النمط تلقائي: تتغيّر الأسعار حسب العرض والطلب.';
    wrap.innerHTML = '';
    state.stocks.forEach(function (st) {
      var nameIn = el('input', { value: st.name });
      nameIn.addEventListener('change', function () { send('admin:stock:update', { id: st.id, name: nameIn.value }); });
      var priceIn = el('input', { type: 'number', step: '0.01', value: st.price });
      priceIn.addEventListener('change', function () { send('admin:stock:update', { id: st.id, price: priceIn.value }); });
      var actions = el('div', { class: 'st-actions' }, [
        manual ? el('button', { class: 'btn btn-sm btn-ghost', text: '⚙ الجولات', onclick: function () { toggleManual(st, row); } }) : null,
        el('button', { class: 'btn btn-sm btn-sell', text: '🗑', onclick: function () { if (confirm('حذف «' + st.name + '»؟')) send('admin:stock:remove', { id: st.id }); } })
      ]);
      var row = el('div', { class: 'strow' }, [
        el('div', {}, [el('div', { class: 'lbl-mini' }, ['الاسم']), nameIn]),
        el('div', {}, [el('div', { class: 'lbl-mini' }, [state.currentRound === 0 ? 'سعر البداية' : 'السعر الحالي']), priceIn]),
        el('div', {}, [el('div', { class: 'lbl-mini' }, ['آخر تغيّر']), el('div', { class: 'cur-price ' + U.dirClass(st.direction) }, [U.dirArrow(st.direction) + ' ' + U.pct(st.lastChangePct)])]),
        actions
      ]);
      wrap.appendChild(row);
    });
  }

  function toggleManual(st, afterRow) {
    var ex = afterRow.nextSibling;
    if (ex && ex.classList && ex.classList.contains('manual-editor')) { ex.remove(); return; }
    var inputs = [], grid = el('div', { class: 'manual-grid' });
    for (var i = 0; i < 10; i++) {
      var v = (st.manualChanges && st.manualChanges[i] != null) ? st.manualChanges[i] : 0;
      var inp = el('input', { type: 'number', step: '0.5', value: v });
      inputs.push(inp);
      grid.appendChild(el('div', { class: 'mcell' }, [el('label', {}, ['ج' + (i + 1)]), inp]));
    }
    var save = el('button', { class: 'btn btn-sm btn-primary', text: '💾 حفظ النِسَب', style: 'margin-top:8px;',
      onclick: function () { send('admin:stock:manual', { id: st.id, manualChanges: inputs.map(function (x) { return parseFloat(x.value) || 0; }) }).then(function () { U.toast('تم الحفظ', 'ok'); }); } });
    var editor = el('div', { class: 'manual-editor' }, [el('div', { class: 'lbl-mini', style: 'margin-bottom:6px;' }, ['نِسَب % لكل جولة — «' + st.name + '»']), grid, save]);
    afterRow.parentNode.insertBefore(editor, afterRow.nextSibling);
  }

  function renderGroups() {
    var wrap = document.getElementById('groupTable');
    if (isEditing(wrap)) return;
    document.getElementById('groupCount').textContent = '(' + state.groups.length + ')';
    wrap.innerHTML = '';
    state.groups.forEach(function (g) {
      var nameIn = el('input', { value: g.name, style: 'max-width:200px;' });
      nameIn.addEventListener('change', function () { send('admin:group:update', { id: g.id, name: nameIn.value }); });
      var rankCls = g.rank <= 3 ? ' rank-' + g.rank : '';
      var pnlCls = g.pnl > 0 ? 'up' : g.pnl < 0 ? 'down' : 'flat';
      var amountIn = el('input', { type: 'number', placeholder: 'مبلغ', style: 'max-width:120px;' });
      var card = el('div', { class: 'gcard' }, [
        el('div', { class: 'gcard-top' }, [
          el('div', { class: 'gcard-name' }, [el('span', { class: 'rank-pill' + rankCls }, ['#' + g.rank]), nameIn]),
          el('div', { style: 'display:flex; gap:8px; align-items:center;' }, [
            el('span', { class: 'gcode' }, [g.code]),
            el('button', { class: 'btn btn-sm', text: '📱 QR', onclick: function () { showQR(g); } }),
            el('button', { class: 'btn btn-sm btn-sell', text: '🗑', onclick: function () { if (confirm('حذف «' + g.name + '»؟')) send('admin:group:remove', { id: g.id }); } })
          ])
        ]),
        el('div', { class: 'gstats' }, [
          stat('النقد', U.fmtMoney(g.cash)), stat('قيمة المحفظة', U.fmtMoney(g.portfolioValue)),
          stat('إجمالي الثروة', U.fmtMoney(g.wealth)), stat('الربح/الخسارة', U.pct(g.pnlPct), pnlCls)
        ]),
        el('div', { class: 'gcard-actions' }, [
          amountIn,
          el('button', { class: 'btn btn-sm btn-buy', text: '➕ إضافة', onclick: function () { adjust(g.id, amountIn, 1); } }),
          el('button', { class: 'btn btn-sm btn-sell', text: '➖ خصم', onclick: function () { adjust(g.id, amountIn, -1); } })
        ])
      ]);
      wrap.appendChild(card);
    });
  }
  function stat(k, v, cls) { return el('div', { class: 'stat' }, [el('div', { class: 'k' }, [k]), el('div', { class: 'v ' + (cls || '') }, [v])]); }
  function adjust(groupId, input, sign) {
    var amt = parseFloat(input.value);
    if (!amt || amt <= 0) { U.toast('أدخل مبلغًا صحيحًا', 'err'); return; }
    send('admin:cash', { groupId: groupId, amount: sign * amt }).then(function () { input.value = ''; });
  }
  function isEditing(container) {
    var a = document.activeElement;
    return a && container.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'SELECT');
  }

  if ((U.qs('resume') || '') === '1') seg('Resume');
  connect();
})();
