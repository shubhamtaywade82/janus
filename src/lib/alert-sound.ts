// Synthesizes a short two-tone alert chime via the Web Audio API.
// Extracted from AlertsModal so the component file only exports components
// (keeps Vite fast-refresh happy).

export function playAlertChime() {
  try {
    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    const audioCtx = new AudioCtor();
    const playTone = (freq: number, start: number, duration: number) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.12, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + duration);
    };
    const now = audioCtx.currentTime;
    playTone(523.25, now, 0.15);
    playTone(783.99, now + 0.1, 0.3);
  } catch (err) {
    console.error("Failed to synthesize audio chime:", err);
  }
}
