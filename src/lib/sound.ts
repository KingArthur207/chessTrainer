// Tiny synthesized sound effects (no audio assets needed).
import { loadJson, saveJson } from './storage';

let ctx: AudioContext | null = null;
let muted = loadJson<boolean>('sound:muted', false);

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  saveJson('sound:muted', value);
}

function audio(): AudioContext | null {
  if (muted) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, durationMs: number, type: OscillatorType, gain = 0.08, when = 0): void {
  const ac = audio();
  if (!ac) return;
  const osc = ac.createOscillator();
  const vol = ac.createGain();
  const t0 = ac.currentTime + when;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  vol.gain.setValueAtTime(gain, t0);
  vol.gain.exponentialRampToValueAtTime(0.0001, t0 + durationMs / 1000);
  osc.connect(vol).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + durationMs / 1000 + 0.02);
}

export const sounds = {
  success: () => tone(880, 70, 'sine', 0.07),
  miss: () => tone(150, 140, 'square', 0.05),
  start: () => {
    tone(523, 80, 'sine', 0.06);
    tone(784, 120, 'sine', 0.06, 0.09);
  },
  finish: () => {
    tone(659, 120, 'sine', 0.07);
    tone(523, 120, 'sine', 0.07, 0.13);
    tone(392, 220, 'sine', 0.07, 0.26);
  },
};
