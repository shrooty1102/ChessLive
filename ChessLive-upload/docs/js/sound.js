// Small synthesized sounds, so the game needs no audio files.
let ctx = null;
let enabled = true;

function ac() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

export function unlockAudio() { ac(); }
export function setSoundEnabled(on) { enabled = on; }
export function isSoundEnabled() { return enabled; }

function knock({ freq = 900, q = 6, dur = 0.07, gain = 0.6, delay = 0 } = {}) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
  const src = a.createBufferSource();
  src.buffer = buf;
  const bp = a.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(gain, t);
  src.connect(bp).connect(g).connect(a.destination);
  src.start(t);
}

function tone(freq, { dur = 0.18, gain = 0.12, delay = 0, type = "sine" } = {}) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export function playMove(kind) {
  if (!enabled) return;
  switch (kind) {
    case "capture":
      knock({ freq: 520, q: 3, dur: 0.1, gain: 0.9 });
      knock({ freq: 1100, q: 5, dur: 0.05, gain: 0.4, delay: 0.03 });
      break;
    case "check":
      knock({ freq: 900 });
      tone(880, { delay: 0.04, dur: 0.15, gain: 0.08, type: "triangle" });
      break;
    case "castle":
      knock({ freq: 900 });
      knock({ freq: 820, delay: 0.09 });
      break;
    case "end":
      tone(523.25, { dur: 0.5, gain: 0.1 });
      tone(659.25, { dur: 0.5, gain: 0.08, delay: 0.08 });
      tone(783.99, { dur: 0.7, gain: 0.08, delay: 0.16 });
      break;
    case "notify":
      tone(740, { dur: 0.12, gain: 0.08 });
      tone(988, { dur: 0.18, gain: 0.08, delay: 0.1 });
      break;
    default:
      knock({ freq: 900 });
  }
}
