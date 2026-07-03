/* مؤثرات صوتية خفيفة مُولَّدة عبر Web Audio API — بلا ملفات صوتية */
(function (global) {
  'use strict';
  let ctx = null;
  let enabled = true;

  function ac() {
    if (!ctx) {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (AC) ctx = new AC();
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, dur, type, vol, when) {
    const c = ac();
    if (!c || !enabled) return;
    const t0 = c.currentTime + (when || 0);
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol || 0.14, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + (dur || 0.2));
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + (dur || 0.2) + 0.02);
  }

  const Sound = {
    setEnabled(v) { enabled = !!v; },
    isEnabled() { return enabled; },
    unlock() { ac(); },
    roundStart() { tone(523, 0.14, 'triangle', 0.14); tone(784, 0.22, 'triangle', 0.12, 0.12); },
    roundEnd() { tone(440, 0.16, 'sawtooth', 0.12); tone(330, 0.26, 'sawtooth', 0.1, 0.14); },
    tickBeep() { tone(880, 0.08, 'square', 0.09); },
    countdown() { tone(660, 0.1, 'square', 0.12); },
    go() { tone(1046, 0.3, 'triangle', 0.16); },
    up() { tone(700, 0.08, 'sine', 0.06); },
    down() { tone(300, 0.08, 'sine', 0.06); },
    buy() { tone(660, 0.09, 'triangle', 0.12); tone(990, 0.12, 'triangle', 0.1, 0.07); },
    sell() { tone(520, 0.09, 'triangle', 0.12); tone(390, 0.12, 'triangle', 0.1, 0.07); },
    win() {
      [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.28, 'triangle', 0.16, i * 0.16));
    },
    error() { tone(200, 0.18, 'sawtooth', 0.12); },
  };

  global.Sound = Sound;
})(window);
