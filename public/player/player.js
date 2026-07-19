(function () {
  'use strict';
  var el = U.el, fmt = U.fmt;
  var COLORS = 4;

  var room = U.qs('room');
  var socket = null;
  var lastState = null;

  var joinScreen = document.getElementById('joinScreen');
  var gameScreen = document.getElementById('gameScreen');
  var nameInput = document.getElementById('nameInput');
  var joinBtn = document.getElementById('joinBtn');
  var joinErr = document.getElementById('joinErr');
  var roomLabel = document.getElementById('roomLabel');

  if (!room) {
    joinErr.textContent = 'افتح اللعبة من رابط الغرفة أو أدخل رمزها من الصفحة الرئيسية';
    joinBtn.disabled = true;
    setTimeout(function () { location.href = '/'; }, 1800);
    return;
  }
  if (roomLabel) roomLabel.textContent = 'الغرفة: ' + room;

  function connect(code) {
    Sound.unlock();
    socket = io({ auth: { role: 'player', room: room, code: code } });
    socket.on('auth:ok', function () {
      try { localStorage.setItem('code_' + room, code); } catch (e) {}
      joinScreen.classList.add('hidden');
      gameScreen.classList.remove('hidden');
      joinBtn.disabled = false;
    });
    socket.on('auth:error', function (e) {
      try { localStorage.removeItem('code_' + room); } catch (er) {}
      if (socket) { socket.disconnect(); socket = null; }
      joinScreen.classList.remove('hidden');
      gameScreen.classList.add('hidden');
      joinErr.textContent = e.error || 'انتهت الجلسة — أعد الدخول';
      joinBtn.disabled = false;
    });
    socket.on('state', render);
    socket.on('tick', function (t) { if (lastState) { lastState.timeLeft = t.timeLeft; updateStatus(lastState); updateTimer(lastState); } });
    socket.on('question:open', function () { Sound.roundStart(); });
    socket.on('question:pick', function () { Sound.reveal(); });
    socket.on('question:reveal', function () {
      if (lastState && lastState.question) {
        var mc = lastState.question.myPickCorrect;
        if (mc === true) Sound.correct(); else if (mc === false) Sound.wrong(); else Sound.reveal();
      }
    });
    socket.on('room:closed', function () { joinErr.textContent = 'أُغلقت الغرفة'; joinScreen.classList.remove('hidden'); gameScreen.classList.add('hidden'); });
  }

  function doJoin() {
    var name = (nameInput.value || '').trim();
    if (name.length < 1) { joinErr.textContent = 'اكتب اسم مجموعتك'; return; }
    joinErr.textContent = ''; joinBtn.disabled = true; Sound.unlock();
    fetch('/api/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room: room, name: name }) })
      .then(function (r) { return r.json(); }).then(function (res) {
        if (res && res.ok) { try { localStorage.setItem('name_' + room, name); } catch (e) {} connect(res.code); }
        else { joinErr.textContent = (res && res.error) || 'تعذّر الانضمام'; joinBtn.disabled = false; }
      }).catch(function () { joinErr.textContent = 'تعذّر الاتصال بالخادم'; joinBtn.disabled = false; });
  }
  joinBtn.addEventListener('click', doJoin);
  nameInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') doJoin(); });

  var savedCode = null, savedName = '';
  try { savedCode = localStorage.getItem('code_' + room); savedName = localStorage.getItem('name_' + room) || ''; } catch (e) {}
  if (savedName) nameInput.value = savedName;
  if (savedCode) connect(savedCode);

  var soundBtn = document.getElementById('soundBtn');
  soundBtn.addEventListener('click', function () { var on = !Sound.isEnabled(); Sound.setEnabled(on); soundBtn.textContent = on ? '🔊' : '🔇'; });

  function updateStatus(s) {
    var line = document.getElementById('statusLine');
    var txt = document.getElementById('statusText');
    var live = s.question && (s.questionState === 'lies' || s.questionState === 'pick');
    var timeUp = live && s.timeLeft === 0 && !s.paused;
    line.className = 'status-line ' + (live && !timeUp ? 'open' : '');
    if (s.status === 'finished') txt.textContent = 'انتهت اللعبة';
    else if (s.currentIndex < 0) txt.textContent = 'بانتظار البدء';
    else if (timeUp) txt.textContent = 'انتهى الوقت ⏰';
    else if (s.questionState === 'lies') txt.textContent = 'انصبوا الفخ! 🕳️';
    else if (s.questionState === 'pick') txt.textContent = 'اختاروا الإجابة';
    else if (s.questionState === 'revealed') txt.textContent = 'النتيجة';
    else txt.textContent = 'انتظروا...';
  }
  function updateTimer(s) {
    var info = document.getElementById('qInfo');
    if (s.currentIndex >= 0 && s.question) {
      var live = s.questionState === 'lies' || s.questionState === 'pick';
      info.textContent = 'سؤال ' + s.questionNumber + '/' + s.total + (live ? '  •  ⏱ ' + s.timeLeft + 'ث' : '');
    } else info.textContent = '';
  }

  function render(s) {
    var content = document.getElementById('content');
    if (!s || !s.active) {
      document.getElementById('gName').textContent = '—'; content.innerHTML = '';
      content.appendChild(el('div', { class: 'banner banner-wait' }, ['بانتظار اللعبة...'])); lastState = s; return;
    }
    var prev = lastState; lastState = s;
    document.getElementById('gName').textContent = s.group.name;
    document.getElementById('compName').textContent = s.name;
    var scoreEl = document.getElementById('gScore');
    scoreEl.textContent = fmt(s.group.score);
    if (prev && prev.group && prev.group.score !== s.group.score) { scoreEl.classList.remove('flash'); void scoreEl.offsetWidth; scoreEl.classList.add('flash'); }
    updateStatus(s); updateTimer(s);

    if (s.status === 'finished') return renderFinished(s);
    if (s.currentIndex < 0 || !s.question) return renderWaiting(s, 'بانتظار بدء اللعبة', '⏳');
    var ph = s.questionState;
    if (ph === 'lies') return renderLies(s, prev);
    if (ph === 'pick') return renderPick(s);
    if (ph === 'revealed') return renderReveal(s);
    return renderWaiting(s, 'انتظروا...', '⏳');
  }

  function renderWaiting(s, title, emoji) {
    document.getElementById('content').innerHTML = '';
    document.getElementById('content').appendChild(el('div', { class: 'waitscreen' }, [
      el('div', { class: 'emoji' }, [emoji]), el('h2', {}, [title]),
      el('div', { class: 'muted' }, ['استعدّوا!']),
      el('div', { class: 'rankpill' }, ['ترتيبك: #' + (s.group.rank || '—') + '  •  ' + fmt(s.group.score) + ' نقطة'])
    ]));
  }
  function renderFinished(s) {
    var rank = s.group.rank || '—';
    var medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '🎉';
    document.getElementById('content').innerHTML = '';
    document.getElementById('content').appendChild(el('div', { class: 'waitscreen' }, [
      el('div', { class: 'emoji' }, [medal]), el('h2', {}, ['انتهت اللعبة!']),
      el('div', { class: 'rankpill' }, ['المركز #' + rank + '  •  ' + fmt(s.group.score) + ' نقطة'])
    ]));
  }

  // كتابة الفخ (بلا نص السؤال — المقدّم يقرأه)
  function renderLies(s, prev) {
    var q = s.question;
    var content = document.getElementById('content');
    var isNew = !prev || !prev.question || prev.questionState !== 'lies' || prev.currentIndex !== s.currentIndex;
    if (isNew || !content.querySelector('.lie-box')) {
      content.innerHTML = '';
      content.appendChild(el('div', { class: 'panel qcard listen-card' }, [
        el('div', { class: 'listen-emoji' }, ['🎤']),
        el('div', { class: 'qtext' }, ['المقدّم يقرأ السؤال...']),
        q.category ? el('div', { class: 'qcat' }, ['التصنيف: ' + q.category]) : null
      ]));
      var input = el('input', { class: 'lie-input', maxlength: '60', placeholder: 'اكتب جوابًا خاطئًا مقنعًا', value: q.myLie || '' });
      var btn = el('button', { class: 'btn btn-sell btn-block', style: 'margin-top:10px; font-size:17px; padding:14px;', text: '🕳️ انصب الفخ' });
      btn.onclick = function () { submitLie(input.value); };
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submitLie(input.value); });
      content.appendChild(el('div', { class: 'lie-box' }, [
        el('div', { class: 'lie-hint' }, ['🎯 اكتب إجابة خاطئة تُوهم غيرك أنها صحيحة!']),
        input, btn, el('div', { class: 'lie-status', id: 'lieStatus' }, [])
      ]));
    }
    var st = document.getElementById('lieStatus');
    if (st) st.innerHTML = q.myLie ? '' : '';
    if (st && q.myLie) { st.appendChild(el('div', { class: 'banner banner-wait' }, ['✔ فخك: «' + q.myLie + '» — يمكنك تعديله'])); }
  }
  function submitLie(text) {
    if (!socket) return;
    var t = (text || '').trim();
    if (!t) { U.toast('اكتب جوابًا', 'err'); return; }
    socket.emit('player:lie', { text: t }, function (res) {
      if (res && res.ok) { Sound.lockIn(); U.toast('نُصب الفخ 🕳️', 'ok'); }
      else { Sound.error(); U.toast((res && res.error) || 'تعذّر الإرسال', 'err'); }
    });
  }

  // الاختيار
  function renderPick(s) {
    var q = s.question;
    var content = document.getElementById('content');
    var sig = 'pick:' + s.currentIndex + ':' + q.options.map(function (o) { return o.id; }).join(',');
    if (content.dataset.sig !== sig) {
      content.innerHTML = '';
      content.appendChild(el('div', { class: 'panel qcard' }, [
        q.category ? el('div', { class: 'qcat' }, [q.category]) : null,
        el('div', { class: 'qtext' }, ['اختر الإجابة الصحيحة']),
        el('div', { class: 'qhint muted' }, ['احذر أفخاخ غيرك!'])
      ]));
      var opts = el('div', { class: 'opts cols1' });
      q.options.forEach(function (o, i) {
        var btn = el('button', { class: 'opt-btn opt-' + (i % COLORS), 'data-id': o.id }, [el('span', { class: 'otext' }, [o.text + (o.mine ? '  (فخك)' : '')])]);
        if (o.mine) { btn.disabled = true; btn.classList.add('dimmed'); }
        else btn.onclick = function () { submitPick(o.id); };
        opts.appendChild(btn);
      });
      content.appendChild(opts);
      content.appendChild(el('div', { class: 'fbslot' }));
      content.dataset.sig = sig;
    }
    var picked = q.myPick;
    content.querySelectorAll('.opt-btn').forEach(function (b) {
      var mine = b.classList.contains('dimmed');
      b.classList.toggle('chosen', picked && b.getAttribute('data-id') === picked);
      b.disabled = mine || !!picked;
    });
    var slot = content.querySelector('.fbslot');
    slot.innerHTML = '';
    if (picked) slot.appendChild(el('div', { class: 'banner banner-wait' }, ['✔ تم اختياركم — بانتظار البقية']));
  }
  function submitPick(optionId) {
    if (!socket) return;
    socket.emit('player:pick', { optionId: optionId }, function (res) {
      if (res && res.ok) { Sound.lockIn(); U.toast('تم الاختيار ✅', 'ok'); }
      else { Sound.error(); U.toast((res && res.error) || 'تعذّر الاختيار', 'err'); }
    });
  }

  // الكشف
  function renderReveal(s) {
    var q = s.question;
    var content = document.getElementById('content');
    content.innerHTML = ''; content.dataset.sig = '';
    content.appendChild(el('div', { class: 'panel qcard' }, [
      q.category ? el('div', { class: 'qcat' }, [q.category]) : null,
      el('div', { class: 'qtext' }, ['الإجابة الصحيحة: ' + q.answer])
    ]));
    var opts = el('div', { class: 'opts cols1' });
    q.options.forEach(function (o, i) {
      var cls = 'opt-btn opt-' + (i % COLORS) + (o.truth ? ' correct' : ' dimmed');
      var label = o.text; if (o.truth) label += '  ✅'; if (o.mine) label += '  (فخك)';
      opts.appendChild(el('button', { class: cls + (o.picked ? ' chosen' : ''), disabled: true }, [el('span', { class: 'otext' }, [label])]));
    });
    content.appendChild(opts);

    var fb;
    if (q.myPickCorrect === true) fb = el('div', { class: 'feedback ok' }, [el('span', { class: 'big' }, ['✅ أصبت الصحيح!']), el('span', { class: 'pts' }, ['+' + fmt(q.awarded) + ' نقطة'])]);
    else if (q.myPickCorrect === false) fb = el('div', { class: 'feedback no' }, [el('span', { class: 'big' }, ['💥 وقعت في فخ ' + (q.myTrapOwners && q.myTrapOwners.length ? q.myTrapOwners.join('، ') : '')])]);
    else fb = el('div', { class: 'feedback no' }, [el('span', { class: 'big' }, ['— لم تختاروا'])]);
    content.appendChild(fb);

    if (q.myTrapTakers && q.myTrapTakers.length) {
      content.appendChild(el('div', { class: 'feedback ok', style: 'margin-top:10px;' }, [
        el('span', { class: 'big' }, ['🕳️ فخك أوقع ' + q.myTrapTakers.length + '!']),
        el('span', { class: 'pts' }, [q.myTrapTakers.join('، ')])
      ]));
    }
  }
})();
