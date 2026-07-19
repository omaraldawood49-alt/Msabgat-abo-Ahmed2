(function () {
  'use strict';
  var el = U.el, fmt = U.fmt;

  var room = U.qs('room');
  var hostToken = null;
  try { hostToken = room ? localStorage.getItem('host_' + room) : null; } catch (e) {}

  var socket = null;
  var state = null;
  var qrLoaded = false;

  var errScreen = document.getElementById('errScreen');
  var dashboard = document.getElementById('dashboard');
  function fail(msg) {
    document.getElementById('errMsg').textContent = msg;
    errScreen.classList.remove('hidden');
    dashboard.classList.add('hidden');
  }

  if (!room) { fail('لا توجد غرفة. أنشئ لعبة من الصفحة الرئيسية.'); return; }
  if (!hostToken) { fail('لست مضيف هذه الغرفة على هذا الجهاز. أنشئ لعبة جديدة أو استضِفها من نفس الجهاز.'); return; }

  socket = io({ auth: { role: 'admin', room: room, hostToken: hostToken } });
  socket.on('auth:ok', function () {
    dashboard.classList.remove('hidden');
    document.getElementById('roomCode').textContent = room;
    document.getElementById('roomBig').textContent = room;
    setupLinks();
  });
  socket.on('auth:error', function (e) { fail(e.error || 'تعذّر الدخول كمضيف'); if (socket) socket.disconnect(); });
  socket.on('state', function (s) { state = s; render(); });
  socket.on('tick', function (t) {
    if (state) { state.timeLeft = t.timeLeft; document.getElementById('cbTimer').textContent = (state.questionState === 'lies' || state.questionState === 'pick') ? '⏱ ' + t.timeLeft : ''; }
  });
  socket.on('room:closed', function () { fail('أُغلقت الغرفة.'); });

  function setupLinks() {
    fetch('/api/config').then(function (r) { return r.json(); }).then(function (c) {
      var base = c.baseUrl || location.origin;
      document.getElementById('joinUrl').textContent = base + '/player?room=' + room;
      document.getElementById('lnkPlayer').href = '/player?room=' + room;
      document.getElementById('lnkPlayer').textContent = base + '/player?room=' + room;
      document.getElementById('lnkDisplay').href = '/display?room=' + room;
      document.getElementById('lnkDisplay').textContent = base + '/display?room=' + room;
    }).catch(function () {});
  }

  function send(event, payload) {
    return new Promise(function (resolve) {
      socket.emit(event, payload || {}, function (res) {
        if (res && res.ok) resolve(res.data || {});
        else { U.toast((res && res.error) || 'حدث خطأ', 'err'); resolve(null); }
      });
    });
  }

  // التبويبات
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
      document.querySelectorAll('.tab-pane').forEach(function (x) { x.classList.remove('active'); });
      t.classList.add('active');
      document.getElementById('tab-' + t.dataset.tab).classList.add('active');
    });
  });

  // أزرار التحكم
  document.getElementById('btnStart').onclick = function () { send('admin:start'); };
  document.getElementById('btnToPick').onclick = function () { send('admin:toPick'); };
  document.getElementById('btnReveal').onclick = function () { send('admin:reveal'); };
  document.getElementById('btnNext').onclick = function () { send('admin:next'); };
  document.getElementById('btnFinish').onclick = function () { if (confirm('إنهاء اللعبة الآن؟')) send('admin:finish'); };
  document.getElementById('btnRestart').onclick = function () { if (confirm('لعبة جديدة بأسئلة جديدة؟ (النقاط تُصفّر والمشاركون يبقون)')) send('admin:restart'); };
  document.getElementById('btnClose').onclick = function () {
    if (!confirm('إغلاق الغرفة نهائيًا؟ لن يستطيع أحد الدخول بعدها.')) return;
    send('admin:close');
    try { localStorage.removeItem('host_' + room); localStorage.removeItem('lastHostRoom'); } catch (e) {}
    setTimeout(function () { location.href = '/'; }, 400);
  };

  // الإعداد
  document.getElementById('btnSaveSettings').onclick = function () {
    send('admin:updateSettings', {
      name: document.getElementById('setName').value,
      defaultTimeSec: parseInt(document.getElementById('setTime').value, 10) || 45,
      defaultPoints: parseInt(document.getElementById('setPoints').value, 10) || 1000,
      speedBonus: document.getElementById('setSpeed').value === '1'
    }).then(function () { U.toast('تم الحفظ', 'ok'); });
  };
  function fillSetup(s) {
    document.getElementById('setName').value = s.name || '';
    document.getElementById('setTime').value = s.defaultTimeSec || 45;
    document.getElementById('setPoints').value = s.defaultPoints || 1000;
    document.getElementById('setSpeed').value = s.speedBonus ? '1' : '0';
  }
  var settingsFilled = false;

  document.getElementById('btnAddQuestion').onclick = function () { openQEdit(null); };

  // نافذة تحرير سؤال
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
      text: text, answer: answer, category: document.getElementById('qeCat').value.trim(),
      timeLimitSec: parseInt(document.getElementById('qeTime').value, 10) || undefined,
      points: parseInt(document.getElementById('qePoints').value, 10)
    };
    var evt = editingId ? 'admin:question:update' : 'admin:question:add';
    if (editingId) payload.id = editingId;
    send(evt, payload).then(function (r) { if (r !== null) { qEditModal.classList.add('hidden'); U.toast('تم الحفظ', 'ok'); } });
  };

  // ---------- العرض ----------
  function render() {
    if (!state || !state.active) return;
    if (!settingsFilled) { settingsFilled = true; fillSetup(state); }

    document.getElementById('statusBadge').textContent =
      state.status === 'finished' ? 'انتهت'
      : state.currentIndex < 0 ? 'بانتظار الانضمام'
      : state.questionState === 'lies' ? 'كتابة الأفخاخ 🕳️'
      : state.questionState === 'pick' ? 'الاختيار'
      : state.questionState === 'revealed' ? 'كُشفت الإجابة' : '—';
    document.getElementById('cbNum').textContent = state.currentIndex >= 0 ? state.questionNumber : 0;
    document.getElementById('cbTotal').textContent = ' / ' + state.total;
    document.getElementById('cbTimer').textContent = (state.questionState === 'lies' || state.questionState === 'pick') ? '⏱ ' + state.timeLeft : '';

    updateControlButtons();

    var lobby = state.currentIndex < 0 && state.status !== 'finished';
    document.getElementById('joinPanel').classList.toggle('hidden', !lobby);
    if (lobby) renderJoin();
    document.getElementById('liveCard').classList.toggle('hidden', lobby || !state.current);
    if (!lobby && state.current) renderLive();
    document.getElementById('liveEmpty').classList.add('hidden');

    renderQuestions();
    renderBoard();
  }

  function updateControlButtons() {
    var lies = state.questionState === 'lies';
    var pick = state.questionState === 'pick';
    var revealed = state.questionState === 'revealed';
    var finished = state.status === 'finished';
    var notStarted = state.currentIndex < 0;
    function set(id, show) { document.getElementById(id).style.display = show ? '' : 'none'; }
    set('btnStart', notStarted);
    set('btnToPick', lies);
    set('btnReveal', pick);
    set('btnNext', revealed);
    set('btnFinish', !finished && state.currentIndex >= 0);
  }

  function renderJoin() {
    document.getElementById('joinCount').textContent = state.groups ? state.groups.length : 0;
    if (!qrLoaded) { document.getElementById('joinQr').src = '/api/join-qr/' + room + '.png?t=' + Date.now(); qrLoaded = true; }
    var wrap = document.getElementById('joinGroups');
    wrap.innerHTML = '';
    (state.groups || []).forEach(function (g) {
      wrap.appendChild(el('span', { class: 'join-chip' }, [g.name,
        el('button', { class: 'chip-x', text: '✕', onclick: function () { send('admin:group:remove', { id: g.id }); } })]));
    });
    if (!state.groups || !state.groups.length) wrap.innerHTML = '<span class="muted">لم تنضم أي مجموعة بعد...</span>';
  }

  function renderLive() {
    var cur = state.current;
    var ph = cur.phase;
    document.getElementById('liveCat').textContent = cur.category || 'سؤال';
    document.getElementById('liveText').textContent = cur.text;
    document.getElementById('liveAnswerBox').innerHTML = '<span class="ans-label">الجواب الصحيح:</span> ' + escapeHtml(cur.answer);
    var liesWrap = document.getElementById('liveLies');
    var optsWrap = document.getElementById('liveOpts');
    var trapWrap = document.getElementById('liveTrapMap');
    liesWrap.innerHTML = ''; optsWrap.innerHTML = ''; trapWrap.innerHTML = '';

    if (ph === 'lies') {
      document.getElementById('liveAnswered').textContent = 'نصب فخه ' + cur.liesCount + ' من ' + cur.total;
      (cur.lies || []).forEach(function (l) { liesWrap.appendChild(el('div', { class: 'lie-item' }, [el('b', {}, [l.group + ': ']), l.text])); });
      if (!cur.lies || !cur.lies.length) liesWrap.innerHTML = '<p class="muted">لم تُنصب أفخاخ بعد...</p>';
      document.getElementById('liveHint').textContent = 'اقرأ السؤال بصوتٍ. انتظر نصب الأفخاخ ثم اضغط «اعرض الخيارات».';
    } else {
      document.getElementById('liveAnswered').textContent = 'اختار ' + cur.picksCount + ' من ' + cur.total;
      (cur.options || []).forEach(function (o, i) {
        var revealed = ph === 'revealed';
        var cls = 'live-opt opt-' + (i % 4);
        if (revealed && o.truth) cls += ' correct';
        var meta = [];
        if (o.truth) meta.push('✅');
        if (revealed && o.owners && o.owners.length) meta.push('🕳️ ' + o.owners.join('، '));
        optsWrap.appendChild(el('div', { class: cls }, [
          el('span', { class: 'otext' }, [o.text + (meta.length ? '  — ' + meta.join(' ') : '')]),
          el('span', { class: 'cnt mono' }, [String((o.pickedBy || []).length)])
        ]));
      });
      if (ph === 'revealed' && cur.trapMap && cur.trapMap.length) {
        trapWrap.appendChild(el('h4', { style: 'margin:14px 0 6px;' }, ['🕳️ خريطة الأفخاخ']));
        cur.trapMap.forEach(function (t) {
          trapWrap.appendChild(el('div', { class: 'trap-row' }, [
            el('b', {}, ['فخ «' + t.text + '» (' + t.owners.join('، ') + '): ']),
            t.caught.length ? ('أوقع ' + t.caught.join('، ')) : 'لم يقع فيه أحد'
          ]));
        });
      }
      document.getElementById('liveHint').textContent = ph === 'pick'
        ? 'يختار المشاركون الآن — اضغط «اكشف الإجابة» عند الجاهزية.'
        : ph === 'revealed' ? 'اضغط «التالي» للسؤال القادم.' : '';
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
    if (!state.groups || !state.groups.length) board.innerHTML = '<p class="muted">لا مجموعات بعد.</p>';
  }

  function renderQuestions() {
    var wrap = document.getElementById('questionList');
    document.getElementById('qCount').textContent = '(' + state.questions.length + ')';
    wrap.innerHTML = '';
    if (!state.questions.length) { wrap.innerHTML = '<p class="muted">لا أسئلة.</p>'; return; }
    state.questions.forEach(function (q) {
      var isCurrent = q.index === state.currentIndex;
      wrap.appendChild(el('div', { class: 'qrow' + (isCurrent ? ' is-current' : '') }, [
        el('div', { class: 'qrow-top' }, [
          el('div', { style: 'display:flex; gap:10px; flex:1;' }, [
            el('span', { class: 'qrow-num' }, [(q.index + 1) + '.']),
            el('span', { class: 'qrow-text' }, [q.text])
          ]),
          el('div', { class: 'qrow-actions' }, [
            el('button', { class: 'btn btn-sm btn-ghost', text: '▲', onclick: function () { send('admin:question:move', { id: q.id, dir: 'up' }); } }),
            el('button', { class: 'btn btn-sm btn-ghost', text: '▼', onclick: function () { send('admin:question:move', { id: q.id, dir: 'down' }); } }),
            el('button', { class: 'btn btn-sm', text: '✏', onclick: function () { openQEdit(q); } }),
            el('button', { class: 'btn btn-sm btn-sell', text: '🗑', onclick: function () { if (confirm('حذف السؤال؟')) send('admin:question:remove', { id: q.id }); } })
          ])
        ]),
        el('div', { class: 'qrow-answer' }, ['✅ الجواب: ' + q.answer]),
        el('div', { class: 'qrow-meta' }, [
          q.category ? el('span', { class: 'chip' }, [q.category]) : null,
          el('span', { class: 'chip' }, ['⏱ ' + q.timeLimitSec + 'ث']),
          el('span', { class: 'chip' }, ['⭐ ' + fmt(q.points)])
        ])
      ]));
    });
  }
})();
