// VAULT RAIDER - procedural audio. SPEC v0.8 sections 10, 11, 14.
//
// M3 SCOPE IS THE INTRUSION SIREN ONLY. Section 14's M3 row asks for "floor
// timer + intrusion + siren"; the full cue set is M9. The dispatch shape below
// exists so M9 adds cues rather than rewriting this, but no other cue is wired.
//
// AudioContext is created LAZILY ON THE FIRST USER GESTURE, never at load
// (section 10) - browser autoplay policy otherwise leaves the game silent with
// no error at all.
//
// Section 11 forbids audio-only information: the siren has a matching on-screen
// indicator in render.js. This module must never be the sole carrier of a fact
// the player needs.
//
// No DOM or AudioContext access at import time. Safe to import from tests/.

import { TUNING } from '../data/tuning.js';

const SIREN_BASE_HZ = 220;
const SIREN_PEAK_HZ = 880;
const SIREN_GAIN = 0.12;
const SIREN_RAMP_SEC = 0.05;

export function createAudio() {
  return {
    ctx: null,
    master: null,
    muted: false,
    started: false,
    sirenOsc: null,
    sirenGain: null
  };
}

// Call from a real user gesture (keydown, pointerdown). Idempotent.
export function initAudioOnGesture(audio, win) {
  if (audio.started) return audio;
  const Ctor = win.AudioContext || win.webkitAudioContext;
  if (!Ctor) return audio;
  try {
    audio.ctx = new Ctor();
    audio.master = audio.ctx.createGain();
    audio.master.gain.value = TUNING.a11y.masterVolume;
    audio.master.connect(audio.ctx.destination);
    audio.started = true;
  } catch (err) {
    // A blocked or unavailable AudioContext must never break the game.
    audio.ctx = null;
    audio.started = false;
  }
  return audio;
}

export function setMasterVolume(audio, value) {
  if (audio.master) audio.master.gain.value = value;
}

export function muteAudio(audio, on) {
  audio.muted = !!on;
  if (audio.master) {
    audio.master.gain.value = on ? 0 : TUNING.a11y.masterVolume;
  }
}

// Section 10: rising siren, begins intrusionWarnSec before the WARDEN enters,
// "must be unmistakable". level runs 0..1 as the deadline approaches.
export function setSirenLevel(audio, level) {
  if (!audio.started || !audio.ctx || audio.muted) return;

  if (level <= 0) {
    if (audio.sirenOsc) {
      audio.sirenGain.gain.setTargetAtTime(0, audio.ctx.currentTime, SIREN_RAMP_SEC);
      audio.sirenOsc.stop(audio.ctx.currentTime + SIREN_RAMP_SEC * 4);
      audio.sirenOsc = null;
      audio.sirenGain = null;
    }
    return;
  }

  if (!audio.sirenOsc) {
    audio.sirenOsc = audio.ctx.createOscillator();
    audio.sirenOsc.type = 'sawtooth';
    audio.sirenGain = audio.ctx.createGain();
    audio.sirenGain.gain.value = 0;
    audio.sirenOsc.connect(audio.sirenGain);
    audio.sirenGain.connect(audio.master);
    audio.sirenOsc.start();
  }
  const hz = SIREN_BASE_HZ + (SIREN_PEAK_HZ - SIREN_BASE_HZ) * level;
  audio.sirenOsc.frequency.setTargetAtTime(hz, audio.ctx.currentTime, SIREN_RAMP_SEC);
  audio.sirenGain.gain.setTargetAtTime(SIREN_GAIN * level, audio.ctx.currentTime, SIREN_RAMP_SEC);
}

export function stopAllAudio(audio) {
  setSirenLevel(audio, 0);
}
