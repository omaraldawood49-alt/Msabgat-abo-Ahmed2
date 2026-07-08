(function () {
  'use strict';
  var el = U.el, fmt = U.fmt;

  var socket = null;
  var state = null;
  var lastCompId = null;
  var qrLoaded = false;

  var loginScreen = document.getElementById('loginScreen');
  var dashboard = document.getElementById('dashboard');
  var pinInput = document.getElementById('pinInput');
  var loginBtn = document.getElementById('loginBtn');
  var loginErr = document.getElementById('loginErr');

  // ---------- تسجيل الدخول ----------
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
      loginScreen.classList.remove('hidden');
      loginErr.textContent = e.error || 'رمز غير صحيح';
      loginBtn.disabled = false;
      if (socket) socket.disconnect();
    });
    socket.on('state', function (s) { state = s; render(); });
    socket.on('tick', function (t) {
      if (state) { state.timeLeft = t.timeLeft; document.getElementById('cbTimer').textContent = state.questionState === 'open' ? '⏱ ' + t.timeLeft : ''; }
    });
  }
  loginBtn.addEventListener('click', function () { login(false); });
  pinInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') login(false); });

  // إن لم يكن هناك رمز مطلوب، ندخل مباشرة
  fetch('/api/config').then(function (r) { return r.json(); }).then(function (c) {
    if (!c || !c.requiresPin) { pinInput.value = ''; login(true); return; }
    loginScreen.classList.remove('hidden');
    try { var saved = sessionStorage.getItem('quiz_pin'); if (saved) { pinInput.value = saved; login(false); } } catch (e) {}
  }).catch(function () { loginScreen.classList.remove('hidden'); });

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
  document.getElementById('btnToPick').onclick = function () { send('admin:toPick'); };
  document.getElementById('btnReveal').onclick = function () { send('admin:reveal'); };
  document.getElementById('btnNext').onclick = function () { send('admin:next'); };
  document.getElementById('btnFinish').onclick = function () { if (confirm('إنهاء المسابقة الآن؟')) send('admin:finish'); };
  document.getElementById('btnReset').onclick = function () { if (confirm('بدء مسابقة جديدة وحذف الحالية؟')) send('admin:reset'); };

  // ---------- الإعداد ----------
  document.getElementById('btnCreate').onclick = function () {
    var opts = readSetup();
    if (state && state.active && !confirm('سيؤدي هذا لإنشاء مسابقة جديدة واستبدال الحالية. متابعة؟')) return;
    send('admin:create', opts).then(function () { U.toast('تم إنشاء المسابقة', 'ok'); });
  };
  document.getElementById('btnSaveSettings').onclick = function () {
    send('admin:updateSettings', readSetup()).then(function () { U.toast('تم حفظ الإعدادات', 'ok'); });
  };
  function readSetup() {
    return {
      name: document.getElementById('setName').value || 'مسابقة الأسئلة',
      defaultTimeSec: parseInt(document.getElementById('setTime').value, 10) || 20,
      defaultPoints: parseInt(document.getElementById('setPoints').value, 10) || 1000,
      speedBonus: document.getElementById('setSpeed').value === '1',
      useSeed: document.getElementById('setSeed').value === '1',
      questionCount: parseInt(document.getElementById('setCount').value, 10) || 10,
      groupCount: 0,
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

  // ---------- الرابط الأساسي ----------
  document.getElementById('btnSaveBase').onclick = function () {
    send('admin:setBaseUrl', { baseUrl: document.getElementById('baseUrlInput').value }).then(function () {
      qrLoaded = false; U.toast('تم حفظ الرابط الأساسي', 'ok');
    });
  };
  function loadConfig() {
    fetch('/api/config').then(function (r) { return r.json(); }).then(function (c) {
      if (!document.getElementById('baseUrlInput').value) document.getElementById('baseUrlInput').value = c.baseUrl || '';
      document.getElementById('joinUrl').textContent = (c.baseUrl || '') + '/player';
    }).catch(function () {});
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
    document.getElementById('qeAnswer').value = q ? q.answer : '';
    document.getElementById('qeCat').value = q ? q.category : '';
    document.getElementById('qeTime').value = q ? q.timeLimitSec : (state ? state.defaultTimeSec : 45);
    document.getElementById('qePoints').value = q ? q.points : (state ? state.defaultPoints : 1000);
    qEditModal.classList.remove('hidden');
  }

  document.getElementById('qeSave').onclick = function () {
    var text = document.getElementById('qeText').value.trim();
    var answer = document.getElementById('qeAnswer').value.trim();
    if (!text) { U.toast('اكتب نص السؤال', 'err'); return; }
    if (!answer) { U.toast('اكتب الجواب الصحيح', 'err'); return; }
    var payload = {
      text: text,
      answer: answer,
      category: document.getElementById('qeCat').value.trim(),
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
      : state.currentIndex < 0 ? 'بانتظار الانضمام'
      : state.questionState === 'lies' ? 'كتابة الألغام 💣'
      : state.questionState === 'pick' ? 'الاختيار'
      : state.questionState === 'revealed' ? 'كُشفت الإجابة' : '—';
    document.getElementById('cbNum').textContent = active && state.currentIndex >= 0 ? state.questionNumber : 0;
    document.getElementById('cbTotal').textContent = active ? ' / ' + state.total : '';
    document.getElementById('cbTimer').textContent = (active && state.questionState === 'open') ? '⏱ ' + state.timeLeft : '';

    updateControlButtons();

    var joinPanel = document.getElementById('joinPanel');
    var liveCard = document.getElementById('liveCard');
    var liveEmpty = document.getElementById('liveEmpty');
    var boardPanel = document.getElementById('boardPanel');

    if (!active) {
      joinPanel.classList.add('hidden'); liveCard.classList.add('hidden'); boardPanel.classList.add('hidden');
      liveEmpty.classList.remove('hidden');
      document.getElementById('questionList').innerHTML = '<p class="muted">أنشئ مسابقة أولًا.</p>';
      document.getElementById('setupHint').textContent = 'لا توجد مسابقة — اضبط الإعدادات ثم اضغط «إنشاء مسابقة جديدة».';
      return;
    }
    liveEmpty.classList.add('hidden');
    boardPanel.classList.remove('hidden');

    if (state.id !== lastCompId) { lastCompId = state.id; fillSetup(state); }
    document.getElementById('setupHint').textContent = state.currentIndex >= 0
      ? 'المسابقة قيد التشغيل.'
      : 'جاهزة — انتظر انضمام المجموعات ثم اضغط «ابدأ اللعبة».';

    // قبل البدء: لوحة الانضمام. بعد البدء/الانتهاء: بطاقة السؤال.
    var lobby = state.currentIndex < 0 && state.status !== 'finished';
    if (lobby) {
      joinPanel.classList.remove('hidden'); liveCard.classList.add('hidden');
      renderJoin();
    } else {
      joinPanel.classList.add('hidden');
      renderLive();
    }
    renderQuestions();
    renderBoard();
  }

  function updateControlButtons() {
    var a = state && state.active;
    var lies = a && state.questionState === 'lies';
    var pick = a && state.questionState === 'pick';
    var revealed = a && state.questionState === 'revealed';
    var finished = a && state.status === 'finished';
    var notStarted = a && state.currentIndex < 0;
    function set(id, show, dis) {
      var b = document.getElementById(id);
      b.style.display = show ? '' : 'none';
      b.disabled = !!dis;
    }
    set('btnStart', notStarted, false);
    set('btnToPick', lies, false);
    set('btnReveal', pick, false);
    set('btnNext', revealed, false);
    set('btnFinish', a && !finished && state.currentIndex >= 0, false);
    set('btnReset', a, false);
  }

  // لوحة الانضمام
  function renderJoin() {
    document.getElementById('joinCount').textContent = state.groups ? state.groups.length : 0;
    if (!qrLoaded) { document.getElementById('joinQr').src = '/api/join-qr.png?t=' + Date.now(); qrLoaded = true; }
    var wrap = document.getElementById('joinGroups');
    wrap.innerHTML = '';
    (state.groups || []).forEach(function (g) {
      wrap.appendChild(el('span', { class: 'join-chip' }, [
        g.name,
        el('button', { class: 'chip-x', text: '✕', title: 'حذف', onclick: function () { send('admin:group:remove', { id: g.id }); } })
      ]));
    });
    if (!state.groups || !state.groups.length) wrap.innerHTML = '<span class="muted">لم تنضم أي مجموعة بعد...</span>';
  }

  // بطاقة السؤال (حسب المرحلة)
  function renderLive() {
    var card = document.getElementById('liveCard');
    var cur = state.current;
    if (!cur) { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');
    var ph = cur.phase;
    document.getElementById('liveCat').textContent = cur.category || 'سؤال';
    document.getElementById('liveText').textContent = cur.text;
    document.getElementById('liveAnswerBox').innerHTML =
      '<span class="ans-label">الجواب الصحيح:</span> ' + escapeHtml(cur.answer);

    var liesWrap = document.getElementById('liveLies');
    var optsWrap = document.getElementById('liveOpts');
    liesWrap.innerHTML = ''; optsWrap.innerHTML = '';

    if (ph === 'lies') {
      document.getElementById('liveAnswered').textContent = 'زرع لغمه ' + cur.liesCount + ' من ' + cur.total;
      (cur.lies || []).forEach(function (l) {
        liesWrap.appendChild(el('div', { class: 'lie-item' }, [
          el('b', {}, [l.group + ': ']), l.text
        ]));
      });
      if (!cur.lies || !cur.lies.length) liesWrap.innerHTML = '<p class="muted">لم تُكتب ألغام بعد...</p>';
      document.getElementById('liveHint').textContent = 'انتظر كتابة الألغام ثم اضغط «اعرض الخيارات».';
    } else {
      document.getElementById('liveAnswered').textContent = 'اختار ' + cur.picksCount + ' من ' + cur.total;
      (cur.options || []).forEach(function (o, i) {
        var revealed = ph === 'revealed';
        var cls = 'live-opt opt-' + (i % 4);
        if (revealed && o.truth) cls += ' correct';
        var meta = [];
        if (o.truth) meta.push('✅');
        if (revealed && o.owners && o.owners.length) meta.push('💣 ' + o.owners.join('، '));
        optsWrap.appendChild(el('div', { class: cls }, [
          el('span', { class: 'otext' }, [o.text + (meta.length ? '  — ' + meta.join(' ') : '')]),
          el('span', { class: 'cnt mono' }, [String(o.pickCount || 0)])
        ]));
      });
      document.getElementById('liveHint').textContent = ph === 'pick'
        ? 'يختار المشاركون الآن — اضغط «اكشف الإجابة» عند الجاهزية.'
        : ph === 'revealed' ? '✅ الصحيح مميّز، و💣 يدل على صاحب اللغم. اضغط «التالي».' : '';
    }
  }
  function escapeHtml(t) { var d = document.createElement('div'); d.textContent = t == null ? '' : t; return d.innerHTML; }

  function renderBoard() {
    document.getElementById('groupCount').textContent = '(' + (state.groups ? state.groups.length : 0) + ')';
    var board = document.getElementById('liveBoard');
    board.innerHTML = '';
    (state.groups || []).forEach(function (g) {
      board.appendChild(el('div', { class: 'lb-row rank-' + g.rank }, [
        el('span', { class: 'lb-rank' }, ['#' + g.rank]),
        el('span', { class: 'lb-name' }, [g.name]),
        el('span', { class: 'lb-score mono' }, [fmt(g.score) + ' نقطة']),
        el('button', { class: 'btn btn-sm btn-ghost lb-del', text: '✕', title: 'حذف', onclick: function () { if (confirm('حذف «' + g.name + '»؟')) send('admin:group:remove', { id: g.id }); } })
      ]));
    });
    if (!state.groups || !state.groups.length) board.innerHTML = '<p class="muted">لا توجد مجموعات بعد.</p>';
  }

  // الأسئلة
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
        el('div', { class: 'qrow-answer' }, ['✅ الجواب: ' + q.answer]),
        el('div', { class: 'qrow-meta' }, [
          q.category ? el('span', { class: 'chip' }, [q.category]) : null,
          el('span', { class: 'chip' }, ['⏱ ' + q.timeLimitSec + 'ث']),
          el('span', { class: 'chip' }, ['⭐ ' + fmt(q.points) + ' نقطة'])
        ])
      ]);
      wrap.appendChild(row);
    });
  }
})();
