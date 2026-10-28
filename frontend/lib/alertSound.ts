/**
 * Alert sound — a short two-note chime generated with the Web Audio API (no audio file to ship).
 *
 * Browsers only allow sound after the visitor has interacted with the page, so `unlockAudio()` is
 * called from the first click / tap / key press. If an alert arrives before that, `playAlertSound()`
 * returns false (the toast still shows) and the next interaction unlocks sound for later alerts.
 */
const SOUND_KEY = 'piitrade_alert_sound';

type AudioCtor = typeof AudioContext;
let ctx: AudioContext | null = null;

function getCtor(): AudioCtor | null {
  if (typeof window === 'undefined') return null;
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext ?? null;
}

/** Sound is ON unless the visitor turned it off in this browser. */
export function isSoundEnabled(): boolean {
  try { return window.localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; }
}

export function setSoundEnabled(on: boolean): void {
  try { window.localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch { /* storage unavailable */ }
}

/** Create / resume the audio context. Safe to call repeatedly; must run inside a user gesture to take effect. */
export function unlockAudio(): void {
  const Ctor = getCtor();
  if (!Ctor) return;
  try {
    if (!ctx) ctx = new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch { /* audio unsupported */ }
}

export function audioIsReady(): boolean {
  return !!ctx && ctx.state === 'running';
}

/** Play the chime. Resolves true if a sound was actually scheduled, false if the browser is blocking audio. */
export async function playAlertSound(): Promise<boolean> {
  if (!ctx) unlockAudio();
  if (!ctx) return false;
  try {
    if (ctx.state === 'suspended') await ctx.resume();
  } catch { /* still blocked */ }
  if (ctx.state !== 'running') return false;
  const now = ctx.currentTime;
  const note = (freq: number, start: number, dur: number) => {
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + start);
    gain.gain.exponentialRampToValueAtTime(0.25, now + start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
    osc.connect(gain).connect(ctx!.destination);
    osc.start(now + start);
    osc.stop(now + start + dur + 0.05);
  };
  note(880, 0, 0.18);      // A5
  note(1318.5, 0.16, 0.3); // E6
  return true;
}
