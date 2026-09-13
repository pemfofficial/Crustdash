// Soft sci-fi alert chime, synthesized with Web Audio (no audio files, nothing to license or download):
// three rising notes (E5 → B5 → E6) from pairs of slightly detuned sine voices that glide up into pitch,
// a quiet triangle "sparkle", and a filtered feedback delay for a spacey tail.

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Browsers only allow audio after a user gesture: call this from any click to pre-warm the context. */
export function unlockAudio() {
  context();
}

export function playChime(volume = 0.6) {
  const ac = context();
  if (!ac) return;
  const now = ac.currentTime + 0.02;

  const master = ac.createGain();
  master.gain.value = Math.max(0, Math.min(1, volume)) * 0.32;
  const delay = ac.createDelay(1);
  delay.delayTime.value = 0.23;
  const feedback = ac.createGain();
  feedback.gain.value = 0.3;
  const tone = ac.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 2400;

  master.connect(ac.destination);
  master.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(tone);
  tone.connect(ac.destination);

  const notes = [
    { freq: 659.25, at: 0 },
    { freq: 987.77, at: 0.13 },
    { freq: 1318.51, at: 0.26 },
  ];
  for (const n of notes) {
    for (const detune of [-5, 5]) {
      const osc = ac.createOscillator();
      osc.type = "sine";
      osc.detune.value = detune;
      osc.frequency.setValueAtTime(n.freq * 0.985, now + n.at);
      osc.frequency.exponentialRampToValueAtTime(n.freq, now + n.at + 0.09);
      const env = ac.createGain();
      env.gain.setValueAtTime(0.0001, now + n.at);
      env.gain.exponentialRampToValueAtTime(0.45, now + n.at + 0.025);
      env.gain.exponentialRampToValueAtTime(0.0001, now + n.at + 0.95);
      osc.connect(env);
      env.connect(master);
      osc.start(now + n.at);
      osc.stop(now + n.at + 1);
    }
  }

  const sparkle = ac.createOscillator();
  sparkle.type = "triangle";
  sparkle.frequency.value = 2637;
  const sparkleEnv = ac.createGain();
  sparkleEnv.gain.setValueAtTime(0.0001, now + 0.26);
  sparkleEnv.gain.exponentialRampToValueAtTime(0.06, now + 0.29);
  sparkleEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.75);
  sparkle.connect(sparkleEnv);
  sparkleEnv.connect(master);
  sparkle.start(now + 0.26);
  sparkle.stop(now + 0.8);

  // Let the delay tail ring out, then tear the graph down
  setTimeout(() => {
    for (const node of [master, delay, feedback, tone]) {
      try {
        node.disconnect();
      } catch {}
    }
  }, 3500);
}
