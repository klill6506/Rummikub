// Gentle spooky background music, synthesized live (no audio files):
// a slow music-box arpeggio over a low drone in D harmonic minor, with an
// echo, and now and then a wobbly theremin glide.

const BPM = 76;
const EIGHTH = 60 / BPM / 2;
const VOLUME = 0.55;

// Dm – B♭ – Gm – A (the C♯ in A major gives it the creepy harmonic-minor pull)
const CHORDS = [
  [50, 53, 57],
  [46, 50, 53],
  [43, 46, 50],
  [45, 49, 52],
];
const PATTERN = [0, 1, 2, 3, 2, 1, 2, 1]; // root, third, fifth, octave
const THEREMIN = [69, 74, 73, 70, 69]; // A4 D5 C♯5 B♭4 A4

const freq = (midi) => 440 * 2 ** ((midi - 69) / 12);

let ctx = null;
let master = null;
let echo = null;
let timer = null;
let nextTime = 0;
let step = 0;
let playing = false;

function setup() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 2600;
  master.connect(tone).connect(ctx.destination);

  echo = ctx.createDelay(1.5);
  echo.delayTime.value = EIGHTH * 3;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.38;
  const wet = ctx.createGain();
  wet.gain.value = 0.45;
  echo.connect(feedback).connect(echo);
  echo.connect(wet).connect(master);

  document.addEventListener('visibilitychange', () => {
    if (!playing) return;
    if (document.hidden) ctx.suspend();
    else ctx.resume();
  });
  return true;
}

function note(f, t, dur, { type = 'triangle', vol = 0.12, attack = 0.01, wet = true } = {}) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = f;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  if (wet) g.connect(echo);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function drone(chord, t, dur) {
  for (const detune of [-6, 6]) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq(chord[0] - 12);
    o.detune.value = detune;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}

function theremin(t) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  const lfo = ctx.createOscillator();
  const depth = ctx.createGain();
  o.type = 'sine';
  lfo.frequency.value = 5.5;
  depth.gain.value = 9;
  lfo.connect(depth).connect(o.frequency);
  const len = 0.9;
  THEREMIN.forEach((n, i) => {
    if (i === 0) o.frequency.setValueAtTime(freq(n), t);
    else o.frequency.exponentialRampToValueAtTime(freq(n), t + i * len);
  });
  const end = t + THEREMIN.length * len;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.05, t + 0.6);
  g.gain.setValueAtTime(0.05, end - 0.8);
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  o.connect(g).connect(master);
  g.connect(echo);
  o.start(t);
  lfo.start(t);
  o.stop(end + 0.05);
  lfo.stop(end + 0.05);
}

function schedule() {
  while (nextTime < ctx.currentTime + 0.4) {
    const chord = CHORDS[Math.floor(step / 8) % CHORDS.length];
    const beat = step % 8;
    const tones = [chord[0], chord[1], chord[2], chord[0] + 12].map((n) => n + 12);
    const n = tones[PATTERN[beat]];
    if (beat === 0) drone(chord, nextTime, EIGHTH * 8 + 0.4);
    note(freq(n), nextTime, EIGHTH * 2.4, { vol: 0.11 });
    note(freq(n + 12), nextTime, EIGHTH * 1.2, { type: 'sine', vol: 0.025, wet: false });
    if (step % 64 === 40) theremin(nextTime);
    nextTime += EIGHTH;
    step++;
  }
}

export function startMusic() {
  if (playing) return;
  if (!ctx && !setup()) return;
  playing = true;
  ctx.resume();
  const now = ctx.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(master.gain.value, now);
  master.gain.linearRampToValueAtTime(VOLUME, now + 2.5);
  nextTime = now + 0.1;
  step = 0;
  schedule();
  timer = setInterval(schedule, 100);
}

export function stopMusic() {
  if (!playing) return;
  playing = false;
  clearInterval(timer);
  const now = ctx.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(master.gain.value, now);
  master.gain.linearRampToValueAtTime(0, now + 0.8);
}

export const isMusicPlaying = () => playing;
