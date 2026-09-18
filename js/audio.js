// audio.js — bell tone playback + spoken announcements.
//
// The ringing loop is strictly SEQUENTIAL: play the tone/custom sound →
// wait for it to fully finish → speak the announcement (if any) → wait
// for the speech to fully finish → pause → repeat. Nothing is scheduled
// on a fixed timer independent of what's still playing, so a tone,
// custom clip, and announcement can never overlap or cut each other off.
//
// Two ways to stop:
//   - stopRinging() — HARD stop (Stop button). Silences everything
//     immediately, even mid-playback/mid-speech.
//   - autoStopMs — a SOFT stop. Never interrupts what's currently playing;
//     it only prevents the NEXT cycle from starting once the current one
//     finishes naturally.

let audioCtx = null;
let isRinging = false;
let stopRequested = false; // soft-stop flag; checked only between cycles, never mid-playback
let ringTimeoutId = null;
let ringAutoStopId = null;
let currentAudioEl = null;           // the one custom-sound <audio> currently playing, if any
let currentInternalObjectUrl = null; // object URL WE created (from an id lookup); revoked on hard stop

const STRIKE_GAP_MS = 1000; // silence between full cycles
const BELL_PRESETS = {
  classic: { freq: 880, duration: 1.4, wave: 'sine' },
  temple:  { freq: 220, duration: 2.5, wave: 'sine' },
  chime:   { freq: 1200, duration: 0.9, wave: 'triangle' },
  alert:   { freq: 660, duration: 0.6, wave: 'square' },
};

function getAudioContext() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

/**
 * Plays a single synthesized bell strike.
 */
function playBellTone(type = 'classic') {
  const ctx = getAudioContext();
  const preset = BELL_PRESETS[type] || BELL_PRESETS.classic;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = preset.wave;
  osc.frequency.setValueAtTime(preset.freq, ctx.currentTime);
  gain.gain.setValueAtTime(0.4, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + preset.duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + preset.duration);

  if (type === 'temple') {
    const overtone = ctx.createOscillator();
    const overtoneGain = ctx.createGain();
    overtone.type = 'sine';
    overtone.frequency.setValueAtTime(preset.freq * 2.4, ctx.currentTime);
    overtoneGain.gain.setValueAtTime(0.15, ctx.currentTime);
    overtoneGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + preset.duration);
    overtone.connect(overtoneGain);
    overtoneGain.connect(ctx.destination);
    overtone.start();
    overtone.stop(ctx.currentTime + preset.duration);
  }
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Speaks one announcement and resolves ONLY once it has genuinely
 * finished (or immediately if there's no text / no speech support).
 * Never overlaps with itself since nothing calls this again until the
 * previous call's promise has resolved.
 */
function speakAnnouncementAsync(text) {
  return new Promise(resolve => {
    if (!text || !('speechSynthesis' in window)) {
      resolve();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.onend = resolve;
    utterance.onerror = resolve; // never let a speech error hang the loop forever
    window.speechSynthesis.speak(utterance);
  });
}

/**
 * Plays a custom audio clip and resolves ONLY once it has genuinely
 * finished playing (or immediately on error).
 */
function playCustomSoundAsync(objectUrl) {
  return new Promise(resolve => {
    const audioEl = new Audio(objectUrl);
    currentAudioEl = audioEl;

    const finish = () => {
      if (currentAudioEl === audioEl) currentAudioEl = null;
      resolve();
    };
    audioEl.onended = finish;
    audioEl.onerror = () => {
      console.warn('Custom sound playback failed');
      finish();
    };
    audioEl.play().catch(err => {
      console.warn('Custom sound playback failed:', err);
      finish();
    });
  });
}

/**
 * HARD stop: silences everything immediately, even mid-playback or
 * mid-speech. Used when the user taps "Stop", or before starting a new
 * ringing session. Safe to call even if nothing is currently ringing.
 */
function stopRinging() {
  isRinging = false;
  stopRequested = false;
  clearTimeout(ringTimeoutId);
  clearTimeout(ringAutoStopId);
  ringTimeoutId = null;
  ringAutoStopId = null;
  window.speechSynthesis?.cancel();

  if (currentAudioEl) {
    currentAudioEl.onended = null;
    currentAudioEl.onerror = null;
    currentAudioEl.pause();
    currentAudioEl = null;
  }
  if (currentInternalObjectUrl) {
    URL.revokeObjectURL(currentInternalObjectUrl);
    currentInternalObjectUrl = null;
  }
}

/**
 * Starts a bell ringing on a loop until stopRinging() is called (hard
 * stop), or, if autoStopMs is given, until the currently-running cycle
 * (sound + announcement) finishes on or after that duration (soft stop —
 * never truncates audio or speech).
 *
 * customSound (only used when sound === 'custom'), one of:
 *   { blobUrl: '...' } — play this object URL directly (caller owns/revokes it —
 *                        used for previewing a not-yet-saved upload)
 *   { id: '...' }      — fetch the Blob from IndexedDB by this id, and manage
 *                        the resulting object URL's lifetime internally
 */
async function startRinging(sound, announcementText, autoStopMs = null, customSound = null) {
  stopRinging(); // hard-reset before starting a fresh session
  isRinging = true;
  const sessionId = Symbol(); // guards against a stale session's async chain resuming after a new one starts
  activeSession = sessionId;

  let soundUrl = null;
  if (sound === 'custom' && customSound) {
    if (customSound.blobUrl) {
      soundUrl = customSound.blobUrl;
    } else if (customSound.id) {
      try {
        const blob = await getCustomSound(customSound.id);
        if (blob) {
          soundUrl = URL.createObjectURL(blob);
          currentInternalObjectUrl = soundUrl;
        } else {
          console.warn('Custom sound not found in storage for id:', customSound.id);
        }
      } catch (err) {
        console.warn('Failed to load custom sound:', err);
      }
    }
  }

  if (!isRinging || activeSession !== sessionId) return; // stopped/superseded while the lookup above was in flight

  if (autoStopMs) {
    ringAutoStopId = setTimeout(() => { stopRequested = true; }, autoStopMs);
  }

  async function runCycle() {
    if (!isRinging || activeSession !== sessionId) return;

    // 1) Play the sound and wait for it to fully finish.
    if (sound === 'custom' && soundUrl) {
      await playCustomSoundAsync(soundUrl);
    } else {
      playBellTone(sound);
      const preset = BELL_PRESETS[sound] || BELL_PRESETS.classic;
      await wait(preset.duration * 1000);
    }
    if (!isRinging || activeSession !== sessionId) return;

    // 2) Speak the announcement (if any) and wait for it to fully finish.
    await speakAnnouncementAsync(announcementText);
    if (!isRinging || activeSession !== sessionId) return;

    // 3) Soft-stop check happens ONLY here, between cycles — never mid-playback.
    if (stopRequested) {
      stopRinging();
      return;
    }

    // 4) Short pause, then repeat.
    ringTimeoutId = setTimeout(runCycle, STRIKE_GAP_MS);
  }

  runCycle();
}

let activeSession = null;

/**
 * Plays a preview that stops after roughly durationMs — but always lets
 * the current cycle (sound + announcement) finish completely first, so a
 * custom clip or a long announcement is never cut short even during a
 * quick "Test Sound" preview.
 */
async function previewBell(sound, announcementText, durationMs = 6000, customSound = null) {
  await startRinging(sound, announcementText, durationMs, customSound);
}