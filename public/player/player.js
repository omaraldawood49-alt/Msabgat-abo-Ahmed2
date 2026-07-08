(function () {
  'use strict';
  var el = U.el, fmt = U.fmt;
  var SHAPES = ['▲', '◆', '●', '■'];

  var socket = null;
  var lastState = null;
  var lastQKey = null;      // لتمييز سؤال جديد
  var revealPlayed = false; // لتشغيل صوت الكشف مرة واحدة

  var joinScreen = document.getElementById('joinScreen');
  var gameScreen = document.getElementById('gameScreen');
  var nameInput = document.getElementById('nameInput');
  var joinBtn = document.getElementById('joinBtn');
  var joinErr = document.getElementById('joinErr');

  // ---------- الاتصال بكود مجموعة (بعد الانضمام أو عند العودة) ----------
  function connect(code) {
    Sound.unlock();
    socket = io({ auth: { role: 'player', code: code } });

    socket.on('auth:ok', function () {
      try { localStorage.setItem('quiz_code', code); } catch (e) {}
      joinScreen.classList.add('hidden');
      gameScreen.classList.remove('hidden');
      joinBtn.disabled = false;
    });
    socket.on('auth:error', function (e) {
      // الكود لم يعد صالحًا (أُعيد تعيين المسابقة مثلاً) — نعود لشاشة الاسم
      try { localStorage.removeItem('quiz_code'); } catch (er) {}
      if (socket) { socket.disconnect(); socket = null; }
      joinScreen.classList.remove('hidden');
      gameScreen.classList.add('hidden');
      joinErr.textContent = e.error || 'انتهت الجلسة — أعد الدخول';
      joinBtn.disabled = false;
    });
    socket.on('state', render);
    socket.on('tick', function (t) {
      if (lastState) { lastState.timeLeft = t.timeLeft; updateStatus(lastState); updateTimer(lastState); }
    });
    socket.on('question:open', function () { Sound.roundStart(); });
    socket.on('question:reveal', function () {
      if (lastState && lastState.question && lastState.question.answered) {
        (lastState.question.myCorrect ? Sound.correct : Sound.wrong)();
      } else { Sound.reveal(); }
    });
    socket.on('disconnect', function () { });
  }

  // ---------- الانضمام الذاتي بالاسم ----------
  function doJoin() {
    var name = (nameInput.value || '').trim();
    if (name.length < 1) { joinErr.textContent = 'اكتب اسم مجموعتك'; return; }
    joinErr.textContent = '';
    joinBtn.disabled = true;
    Sound.unlock();
    fetch('/api/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name })
    }).then(function (r) { return r.json(); }).then(function (res) {
      if (res && res.ok) {
        try { localStorage.setItem('quiz_name', name); } catch (e) {}
        connect(res.code);
      } else {
        joinErr.textContent = (res && res.error) || 'تعذّر الانضمام';
        joinBtn.disabled = false;
      }
    }).catch(function () {
      joinErr.textContent = 'تعذّر الاتصال بالخادم';
      joinBtn.disabled = false;
    });
  }
  joinBtn.addEventListener('click', doJoin);
  nameInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') doJoin(); });

  // عند العودة/تحديث الصفحة: إن كان لدينا كود محفوظ نعيد الاتصال مباشرة
  var savedCode = null;
  try { savedCode = localStorage.getItem('quiz_code'); } catch (e) {}
  var savedName = '';
  try { savedName = localStorage.getItem('quiz_name') || ''; } catch (e) {}
  if (savedName) nameInput.value = savedName;
  if (savedCode) { connect(savedCode); }

  // ---------- زر الصوت ----------
  var soundBtn = document.getElementById('soundBtn');
  soundBtn.addEventListener('click', function () {
    var on = !Sound.isEnabled();
    Sound.setEnabled(on);
    soundBtn.textContent = on ? '🔊' : '🔇';
  });

  // ---------- الحالة العلوية ----------
  function updateStatus(s) {
    var line = document.getElementById('statusLine');
    var txt = document.getElementById('statusText');
    var open = s.question && s.questionState === 'open';
    line.className = 'status-line ' + (open ? 'open' : '');
    if (s.status === 'finished') txt.textContent = 'انتهت المسابقة';
    else if (s.currentIndex < 0) txt.textContent = 'بانتظار البدء';
    else if (open) txt.textContent = 'الإجابة مفتوحة';
    else if (s.questionState === 'revealed') txt.textContent = 'ظهرت الإجابة';
    else txt.textContent = 'انتظر...';
  }
  function updateTimer(s) {
    var info = document.getElementById('qInfo');
    if (s.currentIndex >= 0 && s.question) {
      info.textContent = 'سؤال ' + s.questionNumber + '/' + s.total +
        (s.questionState === 'open' ? '  •  ⏱ ' + s.timeLeft + 'ث' : '');
    } else { info.textContent = ''; }
  }

  // ---------- العرض ----------
  function render(s) {
    var content = document.getElementById('content');
    if (!s || !s.active) {
      document.getElementById('gName').textContent = '—';
      content.innerHTML = '';
      content.appendChild(el('div', { class: 'banner banner-wait' }, ['لا توجد مسابقة نشطة حاليًا']));
      lastState = s;
      return;
    }
    var prev = lastState;
    lastState = s;

    document.getElementById('gName').textContent = s.group.name;
    document.getElementById('compName').textContent = s.name;
    var scoreEl = document.getElementById('gScore');
    scoreEl.textContent = fmt(s.group.score);
    if (prev && prev.group && prev.group.score !== s.group.score) {
      scoreEl.classList.remove('flash'); void scoreEl.offsetWidth; scoreEl.classList.add('flash');
    }
    updateStatus(s);
    updateTimer(s);

    // تمييز سؤال جديد لإعادة بناء الأزرار
    var qKey = s.currentIndex + ':' + s.questionState;
    var isNewQuestion = !prev || prev.currentIndex !== s.currentIndex;
    if (isNewQuestion) revealPlayed = false;

    if (s.status === 'finished') { renderFinished(s); return; }
    if (s.currentIndex < 0 || !s.question) { renderWaiting(s, 'بانتظار بدء المسابقة', '⏳'); return; }

    renderQuestion(s, isNewQuestion);
  }

  function renderWaiting(s, title, emoji) {
    var content = document.getElementById('content');
    content.innerHTML = '';
    content.appendChild(el('div', { class: 'waitscreen' }, [
      el('div', { class: 'emoji' }, [emoji]),
      el('h2', {}, [title]),
      el('div', { class: 'muted' }, ['استعدّوا للسؤال التالي!']),
      el('div', { class: 'rankpill' }, ['ترتيبك: #' + (s.group.rank || '—') + '  •  ' + fmt(s.group.score) + ' نقطة'])
    ]));
  }

  function renderFinished(s) {
    var content = document.getElementById('content');
    content.innerHTML = '';
    var rank = s.group.rank || '—';
    var medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '🎉';
    content.appendChild(el('div', { class: 'waitscreen' }, [
      el('div', { class: 'emoji' }, [medal]),
      el('h2', {}, ['انتهت المسابقة!']),
      el('div', { class: 'rankpill' }, ['المركز #' + rank + '  •  ' + fmt(s.group.score) + ' نقطة'])
    ]));
  }

  var optBtns = [];
  function renderQuestion(s, rebuild) {
    var q = s.question;
    var content = document.getElementById('content');
    var revealed = s.questionState === 'revealed';
    var open = s.questionState === 'open';

    // بناء الهيكل عند سؤال جديد
    if (rebuild || !content.querySelector('.opts')) {
      content.innerHTML = '';
      content.appendChild(el('div', { class: 'panel qcard' }, [
        q.category ? el('div', { class: 'qcat' }, [q.category]) : null,
        el('div', { class: 'qtext' }, [q.text])
      ]));
      var opts = el('div', { class: 'opts' + (q.options.length <= 2 ? ' cols1' : '') });
      optBtns = [];
      q.options.forEach(function (o, i) {
        var btn = el('button', { class: 'opt-btn opt-' + i, onclick: function () { answer(i); } }, [
          el('span', { class: 'shape' }, [SHAPES[i] || '●']),
          el('span', { class: 'otext' }, [o.text])
        ]);
        optBtns.push(btn);
        opts.appendChild(btn);
      });
      content.appendChild(opts);
      content.appendChild(el('div', { class: 'fbslot' }));
    }

    var myOption = q.myOption;
    optBtns.forEach(function (btn, i) {
      btn.classList.remove('chosen', 'dimmed', 'correct');
      btn.disabled = !open || q.answered;
      if (q.answered && i === myOption) btn.classList.add('chosen');
      if (revealed) {
        btn.disabled = true;
        if (i === q.correctIndex) btn.classList.add('correct');
        else btn.classList.add('dimmed');
        if (i === myOption && i === q.correctIndex) btn.classList.remove('dimmed');
      }
    });

    // منطقة التغذية الراجعة
    var slot = content.querySelector('.fbslot');
    slot.innerHTML = '';
    if (revealed && q.answered) {
      slot.appendChild(el('div', { class: 'feedback ' + (q.myCorrect ? 'ok' : 'no') }, [
        el('span', { class: 'big' }, [q.myCorrect ? '✅ إجابة صحيحة!' : '❌ إجابة خاطئة']),
        q.myCorrect ? el('span', { class: 'pts' }, ['+' + fmt(q.myAwarded) + ' نقطة']) : null
      ]));
    } else if (revealed && !q.answered) {
      slot.appendChild(el('div', { class: 'banner banner-wait' }, ['لم تسجّلوا إجابة على هذا السؤال']));
    } else if (open && q.answered) {
      slot.appendChild(el('div', { class: 'banner banner-wait' }, ['✔ تم تسجيل إجابتكم — بانتظار البقية']));
    }
  }

  function answer(optionIndex) {
    if (!socket) return;
    socket.emit('player:answer', { optionIndex: optionIndex }, function (res) {
      if (res && res.ok) {
        Sound.lockIn();
        U.toast('تم تسجيل إجابتكم ✅', 'ok');
      } else {
        Sound.error();
        U.toast((res && res.error) || 'تعذّر الإرسال', 'err');
      }
    });
  }
})();
