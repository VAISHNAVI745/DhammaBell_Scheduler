// audio.js — bell tone playback + spoken announcements.
// A bell rings on a loop (strike every 3s) until stopRinging() is called,
// or until an optional auto-stop duration elapses.

let audioCtx = null;
let ringLoopId = null;
let ringAutoStopId = null;

const BELL_PRESETS = {
  classic: { freq: 880, duration: 1.4, wave: 'sine' },
  temple:  { freq: 220, duration: 2.5, wave: 'sine' },
  chime:   { freq: 1200, duration: 0.9, wave: 'triangle' },
  alert:   { freq: 660, duration: 0.6, wave: 'square' },
};

function getAudioContext() {
  // Created lazily — browsers block audio until a user gesture (a click),
  // so creating it at page-load time can fail silently.
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

  // Temple bell gets a layered overtone for a richer, less "beepy" sound.
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

/**
 * Speaks a text announcement via the browser's built-in speech synthesis.
 * No-ops quietly if unsupported — never breaks the bell from ringing.
 */
function speakAnnouncement(text) {
  if (!text || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel(); // avoid overlapping announcements
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.95;
  window.speechSynthesis.speak(utterance);
}

/**
 * Starts a bell ringing on a loop (tone repeats every 3s) until stopRinging()
 * is called, or until autoStopMs elapses if provided.
 */
function startRinging(sound, announcementText, autoStopMs = null) {
  stopRinging(); // never stack two loops

  const ringOnce = () => {
    playBellTone(sound);
    if (announcementText) setTimeout(() => speakAnnouncement(announcementText), 800);
  };

  ringOnce();
  ringLoopId = setInterval(ringOnce, 3000);

  if (autoStopMs) {
    ringAutoStopId = setTimeout(stopRinging, autoStopMs);
  }
}

/**
 * Stops any active ringing loop, cancels a pending auto-stop, and cancels
 * speech. Safe to call even if nothing is currently ringing.
 */
function stopRinging() {
  if (ringLoopId) {
    clearInterval(ringLoopId);
    ringLoopId = null;
  }
  if (ringAutoStopId) {
    clearTimeout(ringAutoStopId);
    ringAutoStopId = null;
  }
  window.speechSynthesis?.cancel();
}

/**
 * Plays a short, auto-stopping preview — used by the "Test Sound" button
 * so it doesn't ring forever like a real alarm.
 */
function previewBell(sound, announcementText, durationMs = 6000) {
  startRinging(sound, announcementText, durationMs);
}