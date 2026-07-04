(function () {
  'use strict';
  var el = U.el, fmt = U.fmt;

  var socket = null;
  var state = null;
  var lastCompId = null;

  // ---------- تسجيل الدخول ----------
  var loginScreen = document.getElementById('loginScreen');
  var dashboard = document.getElementById('dashboard');
  var pinInput = document.getElementById('pinInput');
  var loginBtn = document.getElementById('loginBtn');
  var loginErr = document.getElementById('loginErr');

  function login() {
    var pin = pinInput.value;
    if (!pin) { loginErr.textContent = 'أدخل الرمز'; return; }
    loginBtn.disabled = true; loginErr.textContent = '';
    socket = io({ auth: { role: 'admin', pin: pin } });
    socket.on('auth:ok', function () {
      try { sessionStorage.setItem('sm_pin', pin); } catch (e) {}
      loginScreen.classList.add('hidden');
      dashboard.classList.remove('hidden');
      loadConfig();
    });
    socket.on('auth:error', function (e) {
      loginErr.textContent = e.error || 'رمز غير صحيح';
      loginBtn.disabled = false;
      if (socket) socket.disconnect();
    });
    socket.on('state', function (s) { state = s; render(); });
    socket.on('tick', function (t) {
      if (state) { state.timeLeft = t.timeLeft; document.getElementById('cbTimer').textContent = state.roundState === 'open' ? '⏱ ' + t.timeLeft : ''; }
    });
  }
  loginBtn.addEventListener('click', login);
  pinInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') login(); });
  try { var saved = sessionStorage.getItem('sm_pin'); if (saved) { pinInput.value = saved; login(); } } catch (e) {}

  // ---------- مساعد الإرسال ----------
  function send(event, payload) {
    return new Promise(function (resolve) {
      socket.emit(event, payload || {}, function (res) {
        if (res && res.ok) resolve(res.data || {});
        else { U.toast((res && res.error) || 'حدث خطأ', 'err'); resolve(null); }
      });
    });
  }

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
  document.getElementById('btnResume').onclick = function () { send('admin:resume'); };
  document.getElementById('btnEndRound').onclick = function () { send('admin:endRound'); };
  document.getElementById('btnNext').onclick = function () { send('admin:nextRound'); };
  document.getElementById('btnFinish').onclick = function () { if (confirm('إنهاء المنافسة الآن؟')) send('admin:finish'); };
  document.getElementById('btnReset').onclick = function () { if (confirm('حذف المنافسة الحالية وإعادة التعيين؟')) send('admin:reset'); };

  // ---------- الإعداد ----------
  document.getElementById('btnCreate').onclick = function () {
    var opts = readSetup();
    if (state && state.active && !confirm('سيؤدي هذا لإنشاء منافسة جديدة واستبدال الحالية. متابعة؟')) return;
    send('admin:create', opts);
  };
  document.getElementById('btnSaveSettings').onclick = function () {
    send('admin:updateSettings', readSetup());
  };
  function readSetup() {
    return {
      name: document.getElementById('setName').value || 'بورصة رواحل',
      pricingMode: document.getElementById('setMode').value,
      rounds: parseInt(document.getElementById('setRounds').value, 10) || 10,
      roundDurationSec: parseInt(document.getElementById('setDuration').value, 10) || 90,
      initialCapital: parseFloat(document.getElementById('setCapital').value) || 100000,
      groupCount: parseInt(document.getElementById('setGroups').value, 10) || 4,
      stockCount: parseInt(document.getElementById('setStocks').value, 10) || 25,
    };
  }
  function fillSetup(s) {
    document.getElementById('setName').value = s.name || '';
    document.getElementById('setMode').value = s.pricingMode || 'auto';
    document.getElementById('setRounds').value = s.rounds || 10;
    document.getElementById('setDuration').value = s.roundDurationSec || 90;
    document.getElementById('setCapital').value = s.initialCapital || 100000;
  }

  // ---------- الأسهم ----------
  document.getElementById('btnAddStock').onclick = function () {
    send('admin:stock:add', { name: 'سهم جديد', price: 10 });
  };

  // ---------- المجموعات ----------
  document.getElementById('btnAddGroup').onclick = function () { send('admin:group:add', {}); };
  document.getElementById('btnMassAdd').onclick = function () { massCash(1); };
  document.getElementById('btnMassSub').onclick = function () { massCash(-1); };
  function massCash(sign) {
    var amt = parseFloat(document.getElementById('massAmount').value);
    if (!amt || amt <= 0) { U.toast('أدخل مبلغًا صحيحًا', 'err'); return; }
    send('admin:cash', { groupId: 'ALL', amount: sign * amt });
  }

  // ---------- الروابط ----------
  document.getElementById('btnSaveBase').onclick = function () {
    send('admin:setBaseUrl', { baseUrl: document.getElementById('baseUrlInput').value }).then(function () {
      U.toast('تم حفظ الرابط الأساسي', 'ok');
    });
  };
  function loadConfig() {
    fetch('/api/config').then(function (r) { return r.json(); }).then(function (c) {
      if (!document.getElementById('baseUrlInput').value) document.getElementById('baseUrlInput').value = c.baseUrl || '';
    }).catch(function () {});
  }

  // ---------- نافذة QR ----------
  var qrModal = document.getElementById('qrModal');
  document.getElementById('qrClose').onclick = function () { qrModal.classList.add('hidden'); };
  qrModal.addEventListener('click', function (e) { if (e.target === qrModal) qrModal.classList.add('hidden'); });
  function showQR(group) {
    document.getElementById('qrTitle').textContent = group.name;
    document.getElementById('qrCode').textContent = group.code;
    document.getElementById('qrImg').src = '/api/qr/' + group.code + '.png?t=' + Date.now();
    fetch('/api/join-url/' + group.code).then(function (r) { return r.json(); }).then(function (d) {
      document.getElementById('qrUrl').textContent = d.url;
    });
    qrModal.classList.remove('hidden');
  }

  // ---------- العرض ----------
  function render() {
    if (!state) return;
    var active = state.active;

    // شريط التحكم
    var badge = document.getElementById('statusBadge');
    var statusTxt = !active ? 'لا توجد منافسة'
      : state.status === 'finished' ? 'انتهت'
      : state.currentRound === 0 ? 'جاهزة للبدء'
      : state.roundState === 'open' ? (state.paused ? 'متوقفة مؤقتًا' : 'التداول مفتوح')
      : state.roundState === 'transition' ? 'تحديث السوق' : 'مغلقة';
    badge.textContent = statusTxt;
    document.getElementById('cbRound').textContent = active ? state.currentRound : 0;
    document.getElementById('cbTotal').textContent = active ? ' / ' + state.rounds : '';
    document.getElementById('cbTimer').textContent = (active && state.roundState === 'open') ? '⏱ ' + state.timeLeft : '';
    document.getElementById('cbMode').textContent = active ? (state.pricingMode === 'manual' ? 'نمط يدوي' : 'نمط تلقائي') : '';

    updateControlButtons();

    if (!active) {
      document.getElementById('setupHint').textContent = 'لا توجد منافسة — اضبط الإعدادات ثم اضغط «إنشاء منافسة جديدة».';
      document.getElementById('stockTable').innerHTML = '<p class="muted">أنشئ منافسة أولًا.</p>';
      document.getElementById('groupTable').innerHTML = '<p class="muted">أنشئ منافسة أولًا.</p>';
      return;
    }

    // تعبئة الإعداد عند تغيّر المنافسة فقط (حتى لا نمسح ما يكتبه الأدمن)
    if (state.id !== lastCompId) { lastCompId = state.id; fillSetup(state); }
    document.getElementById('setupHint').textContent = state.currentRound > 0
      ? 'المنافسة قيد التشغيل — تعديل الإعدادات الأساسية يُفضَّل قبل البدء.'
      : 'جاهزة — يمكنك تعديل الأسهم والمجموعات ثم الضغط على «بدء».';

    renderStocks();
    renderGroups();
  }

  function updateControlButtons() {
    var a = state && state.active;
    var open = a && state.roundState === 'open';
    var trans = a && state.roundState === 'transition';
    var finished = a && state.status === 'finished';
    var notStarted = a && state.currentRound === 0;
    function set(id, show, dis) {
      var b = document.getElementById(id);
      b.style.display = show ? '' : 'none';
      b.disabled = !!dis;
    }
    set('btnStart', !a || notStarted || (open && state.paused), !a);
    set('btnPause', open && !state.paused);
    set('btnResume', open && state.paused);
    set('btnEndRound', open);
    set('btnNext', trans);
    set('btnFinish', a && !finished && state.currentRound > 0);
    set('btnReset', true, false);
  }

  // جدول الأسهم
  function renderStocks() {
    var wrap = document.getElementById('stockTable');
    if (isEditingWithin(wrap)) return; // لا نعيد البناء أثناء الكتابة
    var manual = state.pricingMode === 'manual';
    document.getElementById('stockCount').textContent = '(' + state.stocks.length + ')';
    document.getElementById('manualHint').textContent = manual
      ? 'النمط يدوي: اضبط نِسَب التغير % لكل جولة (1–10) لكل سهم، وتتكرر بعد الجولة العاشرة.'
      : 'النمط تلقائي: تتغير الأسعار حسب العرض والطلب. (بدّل النمط من تبويب الإعداد)';
    wrap.innerHTML = '';
    state.stocks.forEach(function (st) {
      var nameIn = el('input', { value: st.name });
      nameIn.addEventListener('change', function () { send('admin:stock:update', { id: st.id, name: nameIn.value }); });
      var priceIn = el('input', { type: 'number', step: '0.01', value: st.price });
      priceIn.addEventListener('change', function () { send('admin:stock:update', { id: st.id, price: priceIn.value }); });

      var actions = el('div', { class: 'st-actions' }, [
        manual ? el('button', { class: 'btn btn-sm btn-ghost', text: '⚙ الجولات', onclick: function () { toggleManual(st, row); } }) : null,
        el('button', { class: 'btn btn-sm btn-sell', text: '🗑', onclick: function () { if (confirm('حذف السهم «' + st.name + '»؟')) send('admin:stock:remove', { id: st.id }); } })
      ]);

      var row = el('div', { class: 'strow' }, [
        el('div', {}, [ el('div', { class: 'lbl-mini' }, ['الاسم']), nameIn ]),
        el('div', {}, [ el('div', { class: 'lbl-mini' }, [state.currentRound === 0 ? 'سعر البداية' : 'السعر الحالي']), priceIn ]),
        el('div', {}, [ el('div', { class: 'lbl-mini' }, ['آخر تغير']), el('div', { class: 'cur-price ' + U.dirClass(st.direction) }, [U.dirArrow(st.direction) + ' ' + U.pct(st.lastChangePct)]) ]),
        actions
      ]);
      wrap.appendChild(row);
    });
  }

  function toggleManual(st, afterRow) {
    var existing = afterRow.nextSibling;
    if (existing && existing.classList && existing.classList.contains('manual-editor')) { existing.remove(); return; }
    var inputs = [];
    var grid = el('div', { class: 'manual-grid' });
    for (var i = 0; i < 10; i++) {
      var v = (st.manualChanges && st.manualChanges[i] != null) ? st.manualChanges[i] : 0;
      var inp = el('input', { type: 'number', step: '0.5', value: v });
      inputs.push(inp);
      grid.appendChild(el('div', { class: 'mcell' }, [ el('label', {}, ['ج' + (i + 1)]), inp ]));
    }
    var save = el('button', { class: 'btn btn-sm btn-primary', text: '💾 حفظ النِسَب', style: 'margin-top:8px;',
      onclick: function () {
        send('admin:stock:manual', { id: st.id, manualChanges: inputs.map(function (x) { return parseFloat(x.value) || 0; }) })
          .then(function () { U.toast('تم حفظ نِسَب «' + st.name + '»', 'ok'); });
      } });
    var editor = el('div', { class: 'manual-editor' }, [
      el('div', { class: 'lbl-mini', style: 'margin-bottom:6px;' }, ['نِسَب التغير % لكل جولة — «' + st.name + '»']),
      grid, save
    ]);
    afterRow.parentNode.insertBefore(editor, afterRow.nextSibling);
  }

  // جدول المجموعات
  function renderGroups() {
    var wrap = document.getElementById('groupTable');
    if (isEditingWithin(wrap)) return;
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
          el('div', { class: 'gcard-name' }, [ el('span', { class: 'rank-pill' + rankCls }, ['#' + g.rank]), nameIn ]),
          el('div', { style: 'display:flex; gap:8px; align-items:center;' }, [
            el('span', { class: 'gcode' }, [g.code]),
            el('button', { class: 'btn btn-sm', text: '📱 QR', onclick: function () { showQR(g); } }),
            el('button', { class: 'btn btn-sm btn-sell', text: '🗑', onclick: function () { if (confirm('حذف «' + g.name + '»؟')) send('admin:group:remove', { id: g.id }); } })
          ])
        ]),
        el('div', { class: 'gstats' }, [
          stat('النقد', U.fmtMoney(g.cash)),
          stat('قيمة المحفظة', U.fmtMoney(g.portfolioValue)),
          stat('إجمالي الثروة', U.fmtMoney(g.wealth)),
          stat('الربح/الخسارة', U.pct(g.pnlPct), pnlCls)
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
  function stat(k, v, cls) {
    return el('div', { class: 'stat' }, [ el('div', { class: 'k' }, [k]), el('div', { class: 'v ' + (cls || '') }, [v]) ]);
  }
  function adjust(groupId, input, sign) {
    var amt = parseFloat(input.value);
    if (!amt || amt <= 0) { U.toast('أدخل مبلغًا صحيحًا', 'err'); return; }
    send('admin:cash', { groupId: groupId, amount: sign * amt }).then(function () { input.value = ''; });
  }

  function isEditingWithin(container) {
    var a = document.activeElement;
    return a && container.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'SELECT');
  }
})();
