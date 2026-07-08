(function () {
  'use strict';
  var el = U.el, fmt = U.fmt;
  var SHAPES = ['▲', '◆', '●', '■'];

  var socket = null;
  var state = null;
  var lastCompId = null;

  // ---------- تسجيل الدخول ----------
  var loginScreen = document.getElementById('loginScreen');
  var dashboard = document.getElementById('dashboard');
  var pinInput = document.getElementById('pinInput');
  var loginBtn = document.getElementById('loginBtn');
  var loginErr = document.getElementById('loginErr');

  function login(allowEmpty) {
    var pin = pinInput.value;
    if (!pin && !allowEmpty) { loginErr.textContent = 'أدخل الرمز'; return; }
    loginBtn.disabled = true; loginErr.textContent = '';
    socket = io({ auth: { role: 'admin', pin: pin } });
    socket.on('auth:ok', function () {
      try { sessionStorage.setItem('quiz_pin', pin); } catch (e) {}
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
      if (state) { state.timeLeft = t.timeLeft; document.getElementById('cbTimer').textContent = state.questionState === 'open' ? '⏱ ' + t.timeLeft : ''; }
    });
  }
  loginBtn.addEventListener('click', login);
  pinInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') login(); });

  // إن لم يكن هناك رمز مطلوب، ندخل مباشرة بلا شاشة تسجيل دخول
  fetch('/api/config').then(function (r) { return r.json(); }).then(function (c) {
    if (!c || !c.requiresPin) { pinInput.value = ''; login(true); return; }
    try { var saved = sessionStorage.getItem('quiz_pin'); if (saved) { pinInput.value = saved; login(); } } catch (e) {}
  }).catch(function () {
    try { var s = sessionStorage.getItem('quiz_pin'); if (s) { pinInput.value = s; login(); } } catch (e) {}
  });

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
  document.getElementById('btnReveal').onclick = function () { send('admin:reveal'); };
  document.getElementById('btnNext').onclick = function () { send('admin:next'); };
  document.getElementById('btnFinish').onclick = function () { if (confirm('إنهاء المسابقة الآن؟')) send('admin:finish'); };
  document.getElementById('btnReset').onclick = function () { if (confirm('حذف المسابقة الحالية وإعادة التعيين؟')) send('admin:reset'); };

  // ---------- الإعداد ----------
  document.getElementById('btnCreate').onclick = function () {
    var opts = readSetup();
    if (state && state.active && !confirm('سيؤدي هذا لإنشاء مسابقة جديدة واستبدال الحالية. متابعة؟')) return;
    send('admin:create', opts);
  };
  document.getElementById('btnSaveSettings').onclick = function () {
    send('admin:updateSettings', readSetup()).then(function () { U.toast('تم حفظ الإعدادات', 'ok'); });
  };
  function readSetup() {
    return {
      name: document.getElementById('setName').value || 'مسابقة الأسئلة',
      defaultTimeSec: parseInt(document.getElementById('setTime').value, 10) || 20,
      defaultPoints: parseInt(document.getElementById('setPoints').value, 10) || 1000,
      groupCount: parseInt(document.getElementById('setGroups').value, 10) || 4,
      speedBonus: document.getElementById('setSpeed').value === '1',
      useSeed: document.getElementById('setSeed').value === '1',
    };
  }
  function fillSetup(s) {
    document.getElementById('setName').value = s.name || '';
    document.getElementById('setTime').value = s.defaultTimeSec || 20;
    document.getElementById('setPoints').value = s.defaultPoints || 1000;
    document.getElementById('setSpeed').value = s.speedBonus ? '1' : '0';
  }

  // ---------- الأسئلة ----------
  document.getElementById('btnAddQuestion').onclick = function () { openQEdit(null); };

  // ---------- المجموعات ----------
  document.getElementById('btnAddGroup').onclick = function () {
    send('admin:group:add', {}).then(function (d) { if (d) U.toast('أُضيفت مجموعة جديدة', 'ok'); });
  };

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

  // ---------- نافذة تحرير سؤال ----------
  var qEditModal = document.getElementById('qEditModal');
  var editingId = null;
  document.getElementById('qEditClose').onclick = function () { qEditModal.classList.add('hidden'); };
  qEditModal.addEventListener('click', function (e) { if (e.target === qEditModal) qEditModal.classList.add('hidden'); });

  function openQEdit(q) {
    editingId = q ? q.id : null;
    document.getElementById('qEditTitle').textContent = q ? 'تحرير سؤال' : 'سؤال جديد';
    document.getElementById('qeText').value = q ? q.text : '';
    document.getElementById('qeCat').value = q ? q.category : '';
    document.getElementById('qeTime').value = q ? q.timeLimitSec : (state ? state.defaultTimeSec : 20);
    document.getElementById('qePoints').value = q ? q.points : (state ? state.defaultPoints : 1000);

    var opts = q ? q.options.slice() : ['', '', '', ''];
    while (opts.length < 4) opts.push('');
    var correct = q ? q.correctIndex : 0;
    var wrap = document.getElementById('qeOptions');
    wrap.innerHTML = '';
    for (var i = 0; i < 4; i++) {
      (function (idx) {
        var radio = el('input', { type: 'radio', name: 'qeCorrect', value: idx });
        if (idx === correct) radio.checked = true;
        var textInput = el('input', { type: 'text', value: opts[idx], placeholder: 'الخيار ' + (idx + 1) + ' (اتركه فارغًا لحذفه)' });
        wrap.appendChild(el('div', { class: 'qe-opt opt-' + idx }, [
          radio,
          el('span', { class: 'shape', style: 'color:var(--opt)' }, [SHAPES[idx]]),
          textInput
        ]));
      })(i);
    }
    qEditModal.classList.remove('hidden');
  }

  document.getElementById('qeSave').onclick = function () {
    var text = document.getElementById('qeText').value.trim();
    if (!text) { U.toast('اكتب نص السؤال', 'err'); return; }
    var optInputs = document.querySelectorAll('#qeOptions .qe-opt input[type="text"]');
    var options = Array.prototype.map.call(optInputs, function (i) { return i.value; });
    var checked = document.querySelector('#qeOptions input[name="qeCorrect"]:checked');
    var correctIndex = checked ? parseInt(checked.value, 10) : 0;
    // تأكد أن الخيار الصحيح غير فارغ
    if (!options[correctIndex] || !options[correctIndex].trim()) {
      U.toast('الخيار الصحيح لا يمكن أن يكون فارغًا', 'err'); return;
    }
    var payload = {
      text: text,
      category: document.getElementById('qeCat').value.trim(),
      options: options,
      correctIndex: correctIndex,
      timeLimitSec: parseInt(document.getElementById('qeTime').value, 10) || undefined,
      points: parseInt(document.getElementById('qePoints').value, 10),
    };
    var evt = editingId ? 'admin:question:update' : 'admin:question:add';
    if (editingId) payload.id = editingId;
    send(evt, payload).then(function (r) {
      if (r !== null) { qEditModal.classList.add('hidden'); U.toast('تم الحفظ', 'ok'); }
    });
  };

  // ---------- العرض ----------
  function render() {
    if (!state) return;
    var active = state.active;

    var badge = document.getElementById('statusBadge');
    badge.textContent = !active ? 'لا توجد مسابقة'
      : state.status === 'finished' ? 'انتهت'
      : state.currentIndex < 0 ? 'جاهزة للبدء'
      : state.questionState === 'open' ? (state.paused ? 'متوقفة مؤقتًا' : 'الإجابة مفتوحة')
      : state.questionState === 'revealed' ? 'كُشفت الإجابة' : '—';
    document.getElementById('cbNum').textContent = active && state.currentIndex >= 0 ? state.questionNumber : 0;
    document.getElementById('cbTotal').textContent = active ? ' / ' + state.total : '';
    document.getElementById('cbTimer').textContent = (active && state.questionState === 'open') ? '⏱ ' + state.timeLeft : '';

    updateControlButtons();

    if (!active) {
      document.getElementById('liveEmpty').classList.remove('hidden');
      document.getElementById('liveCard').classList.add('hidden');
      document.getElementById('liveBoard').innerHTML = '<p class="muted">أنشئ مسابقة أولًا.</p>';
      document.getElementById('questionList').innerHTML = '<p class="muted">أنشئ مسابقة أولًا.</p>';
      document.getElementById('groupTable').innerHTML = '<p class="muted">أنشئ مسابقة أولًا.</p>';
      document.getElementById('setupHint').textContent = 'لا توجد مسابقة — اضبط الإعدادات ثم اضغط «إنشاء مسابقة جديدة».';
      return;
    }

    if (state.id !== lastCompId) { lastCompId = state.id; fillSetup(state); }
    document.getElementById('setupHint').textContent = state.currentIndex >= 0
      ? 'المسابقة قيد التشغيل. يمكنك إضافة أسئلة ومجموعات في أي وقت.'
      : 'جاهزة — عدّل الأسئلة والمجموعات ثم اضغط «بدء».';

    renderLive();
    renderQuestions();
    renderGroups();
  }

  function updateControlButtons() {
    var a = state && state.active;
    var open = a && state.questionState === 'open';
    var revealed = a && state.questionState === 'revealed';
    var finished = a && state.status === 'finished';
    var notStarted = a && state.currentIndex < 0;
    function set(id, show, dis) {
      var b = document.getElementById(id);
      b.style.display = show ? '' : 'none';
      b.disabled = !!dis;
    }
    set('btnStart', !a || notStarted || (open && state.paused), !a);
    set('btnPause', open && !state.paused);
    set('btnResume', open && state.paused);
    set('btnReveal', open);
    set('btnNext', revealed);
    set('btnFinish', a && !finished && state.currentIndex >= 0);
    set('btnReset', true, false);
  }

  // تبويب المباشر
  function renderLive() {
    var empty = document.getElementById('liveEmpty');
    var card = document.getElementById('liveCard');
    var cur = state.current;
    if (!cur) {
      empty.classList.remove('hidden'); card.classList.add('hidden');
      empty.querySelector('p').textContent = state.currentIndex < 0
        ? 'المسابقة جاهزة — اضغط «بدء» لعرض السؤال الأول.'
        : 'انتهت المسابقة.';
    } else {
      empty.classList.add('hidden'); card.classList.remove('hidden');
      document.getElementById('liveCat').textContent = cur.category || 'سؤال';
      document.getElementById('liveAnswered').textContent = 'أجاب ' + cur.answered + ' من ' + cur.total;
      document.getElementById('liveText').textContent = cur.text;
      var revealed = state.questionState === 'revealed';
      var optsWrap = document.getElementById('liveOpts');
      optsWrap.innerHTML = '';
      cur.options.forEach(function (o, i) {
        var isCorrect = i === cur.correctIndex;
        optsWrap.appendChild(el('div', { class: 'live-opt opt-' + i + ((revealed && isCorrect) ? ' correct' : '') }, [
          el('span', { class: 'shape' }, [SHAPES[i] || '●']),
          el('span', { class: 'otext' }, [o + (isCorrect ? '  ✓' : '')]),
          el('span', { class: 'cnt mono' }, [String(cur.tally[i] || 0)])
        ]));
      });
      document.getElementById('liveHint').textContent = state.questionState === 'open'
        ? 'الإجابة مفتوحة — اضغط «كشف الإجابة» أو انتظر انتهاء الوقت.'
        : revealed ? 'كُشفت الإجابة الصحيحة (المحدّدة بعلامة ✓). اضغط «السؤال التالي».' : '';
    }

    var board = document.getElementById('liveBoard');
    board.innerHTML = '';
    (state.groups || []).forEach(function (g) {
      board.appendChild(el('div', { class: 'lb-row rank-' + g.rank }, [
        el('span', { class: 'lb-rank' }, ['#' + g.rank]),
        el('span', { class: 'lb-name' }, [g.name]),
        el('span', { class: 'lb-score mono' }, [fmt(g.score) + ' نقطة'])
      ]));
    });
    if (!state.groups || !state.groups.length) board.innerHTML = '<p class="muted">لا توجد مجموعات بعد.</p>';
  }

  // بنك الأسئلة
  function renderQuestions() {
    var wrap = document.getElementById('questionList');
    document.getElementById('qCount').textContent = '(' + state.questions.length + ')';
    wrap.innerHTML = '';
    if (!state.questions.length) {
      wrap.innerHTML = '<p class="muted">لا توجد أسئلة — أضِف سؤالًا للبدء.</p>';
      return;
    }
    state.questions.forEach(function (q) {
      var isCurrent = q.index === state.currentIndex;
      var row = el('div', { class: 'qrow' + (isCurrent ? ' is-current' : '') }, [
        el('div', { class: 'qrow-top' }, [
          el('div', { style: 'display:flex; gap:10px; flex:1;' }, [
            el('span', { class: 'qrow-num' }, [(q.index + 1) + '.']),
            el('span', { class: 'qrow-text' }, [q.text])
          ]),
          el('div', { class: 'qrow-actions' }, [
            el('button', { class: 'btn btn-sm btn-ghost', text: '▲', title: 'أعلى', onclick: function () { send('admin:question:move', { id: q.id, dir: 'up' }); } }),
            el('button', { class: 'btn btn-sm btn-ghost', text: '▼', title: 'أسفل', onclick: function () { send('admin:question:move', { id: q.id, dir: 'down' }); } }),
            el('button', { class: 'btn btn-sm', text: '✏', title: 'تحرير', onclick: function () { openQEdit(q); } }),
            el('button', { class: 'btn btn-sm btn-sell', text: '🗑', onclick: function () { if (confirm('حذف هذا السؤال؟')) send('admin:question:remove', { id: q.id }); } })
          ])
        ]),
        el('div', { class: 'qrow-answer' }, ['الإجابة: ' + (SHAPES[q.correctIndex] || '') + ' ' + q.options[q.correctIndex]]),
        el('div', { class: 'qrow-meta' }, [
          q.category ? el('span', { class: 'chip' }, [q.category]) : null,
          el('span', { class: 'chip' }, ['⏱ ' + q.timeLimitSec + 'ث']),
          el('span', { class: 'chip' }, ['⭐ ' + fmt(q.points) + ' نقطة']),
          el('span', { class: 'chip' }, [q.options.length + ' خيارات'])
        ])
      ]);
      wrap.appendChild(row);
    });
  }

  // المجموعات
  function renderGroups() {
    var wrap = document.getElementById('groupTable');
    if (isEditingWithin(wrap)) return;
    document.getElementById('groupCount').textContent = '(' + state.groups.length + ')';
    wrap.innerHTML = '';
    if (!state.groups.length) { wrap.innerHTML = '<p class="muted">لا توجد مجموعات — أضِف مجموعة.</p>'; return; }
    state.groups.forEach(function (g) {
      var nameIn = el('input', { value: g.name, style: 'max-width:200px;' });
      nameIn.addEventListener('change', function () { send('admin:group:update', { id: g.id, name: nameIn.value }); });
      var rankCls = g.rank <= 3 ? ' rank-' + g.rank : '';
      var amountIn = el('input', { type: 'number', placeholder: 'نقاط', style: 'max-width:110px;' });
      var card = el('div', { class: 'gcard' }, [
        el('div', { class: 'gcard-top' }, [
          el('div', { class: 'gcard-name' }, [ el('span', { class: 'rank-pill' + rankCls }, ['#' + g.rank]), nameIn ]),
          el('div', { style: 'display:flex; gap:8px; align-items:center;' }, [
            el('span', { class: 'gscore mono' }, [fmt(g.score)]),
            el('span', { class: 'gcode' }, [g.code]),
            el('button', { class: 'btn btn-sm', text: '📱 QR', onclick: function () { showQR(g); } }),
            el('button', { class: 'btn btn-sm btn-sell', text: '🗑', onclick: function () { if (confirm('حذف «' + g.name + '»؟')) send('admin:group:remove', { id: g.id }); } })
          ])
        ]),
        el('div', { class: 'gcard-actions' }, [
          amountIn,
          el('button', { class: 'btn btn-sm btn-buy', text: '➕ منح', onclick: function () { adjust(g.id, amountIn, 1); } }),
          el('button', { class: 'btn btn-sm btn-sell', text: '➖ خصم', onclick: function () { adjust(g.id, amountIn, -1); } })
        ])
      ]);
      wrap.appendChild(card);
    });
  }
  function adjust(groupId, input, sign) {
    var amt = parseFloat(input.value);
    if (!amt || amt <= 0) { U.toast('أدخل عدد نقاط صحيحًا', 'err'); return; }
    send('admin:score', { groupId: groupId, amount: sign * amt }).then(function () { input.value = ''; });
  }

  function isEditingWithin(container) {
    var a = document.activeElement;
    return a && container.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'SELECT');
  }
})();
