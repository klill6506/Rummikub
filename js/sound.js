// Tiny synthesized sound effects (no audio files needed).

let ctx = null;
let muted = false;

export const isMuted = () => muted;
export const setMuted = (value) => {
  muted = value;
};

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, { at = 0, dur = 0.12, type = 'sine', vol = 0.12, slide = 0 } = {}) {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + at;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

const SOUNDS = {
  tick: () => tone(880, { dur: 0.05, vol: 0.05, type: 'triangle' }),
  pick: () => tone(520, { dur: 0.08, vol: 0.08, type: 'triangle', slide: 1.4 }),
  drop: () => {
    tone(300, { dur: 0.09, vol: 0.12, type: 'triangle', slide: 0.7 });
    tone(1200, { dur: 0.03, vol: 0.03, type: 'square' });
  },
  undo: () => tone(500, { dur: 0.12, vol: 0.07, type: 'triangle', slide: 0.6 }),
  draw: () => tone(420, { dur: 0.18, vol: 0.09, type: 'sine', slide: 1.8 }),
  bot: () => {
    tone(392, { dur: 0.1, vol: 0.06, type: 'triangle' });
    tone(523, { at: 0.08, dur: 0.12, vol: 0.06, type: 'triangle' });
  },
  play: () => [523, 659, 784].forEach((f, i) => tone(f, { at: i * 0.07, dur: 0.16, vol: 0.09, type: 'triangle' })),
  error: () => {
    tone(160, { dur: 0.18, vol: 0.1, type: 'sawtooth' });
    tone(150, { at: 0.12, dur: 0.2, vol: 0.08, type: 'sawtooth' });
  },
  win: () =>
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) =>
      tone(f, { at: i * 0.11, dur: 0.25, vol: 0.1, type: 'triangle' }),
    ),
  lose: () => [392, 349, 311, 262].forEach((f, i) => tone(f, { at: i * 0.16, dur: 0.3, vol: 0.08, type: 'sine' })),
};

export function sfx(name) {
  if (muted) return;
  try {
    SOUNDS[name]?.();
  } catch {
    /* audio not available */
  }
}
