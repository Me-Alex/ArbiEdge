/**
 * Web Audio API Audio Chimes for Arbitrage Alerts & UI Notifications.
 * Synthesizes crisp chimes dynamically without external audio assets.
 */

export class AudioAlertManager {
  constructor(options = {}) {
    this.storageKey = options.storageKey || 'arbDeskSound';
    this.soundEnabled = this.loadEnabledPreference();
    this.volume = options.volume ?? 0.8;
    this.minIntervalMs = options.minIntervalMs ?? 1200;
    this.lastPlayTime = 0;

    this.ctx = null;
    this.unlocked = false;

    this.bindUnlockEvents();
  }

  loadEnabledPreference() {
    try {
      const saved = localStorage.getItem(this.storageKey);
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  }

  saveEnabledPreference(enabled) {
    try {
      localStorage.setItem(this.storageKey, String(enabled));
    } catch {
      /* ignore storage failure */
    }
  }

  bindUnlockEvents() {
    if (typeof window === 'undefined') return;
    const unlock = () => {
      this.ensureContext();
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().then(() => {
          this.unlocked = true;
        }).catch(() => {});
      } else if (this.ctx) {
        this.unlocked = true;
      }
      if (this.unlocked) {
        ['click', 'keydown', 'touchstart', 'pointerdown'].forEach((evt) => {
          window.removeEventListener(evt, unlock);
        });
      }
    };

    ['click', 'keydown', 'touchstart', 'pointerdown'].forEach((evt) => {
      window.addEventListener(evt, unlock, { passive: true, once: false });
    });
  }

  ensureContext() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
  }

  toggleSound(enabled) {
    this.soundEnabled = typeof enabled === 'boolean' ? enabled : !this.soundEnabled;
    this.saveEnabledPreference(this.soundEnabled);
    return this.soundEnabled;
  }

  isEnabled() {
    return this.soundEnabled;
  }

  /**
   * Main entry point for playing arbitrage alert chimes.
   * Dynamically alters chime based on edge percentage or high profit value.
   */
  playArbAlert(opportunityOrEdge = 0) {
    if (!this.soundEnabled) return false;

    const now = Date.now();
    if (now - this.lastPlayTime < this.minIntervalMs) {
      return false; // throttled
    }

    let edge = 0;
    if (typeof opportunityOrEdge === 'number') {
      edge = opportunityOrEdge;
    } else if (opportunityOrEdge && typeof opportunityOrEdge.profitMargin === 'number') {
      edge = opportunityOrEdge.profitMargin * 100;
    } else if (opportunityOrEdge && typeof opportunityOrEdge.edge === 'number') {
      edge = opportunityOrEdge.edge;
    }

    this.lastPlayTime = now;

    if (edge >= 5.0) {
      this.playHighArbChime();
    } else {
      this.playStandardChime();
    }
    return true;
  }

  /**
   * Play specific chime sound by preset name.
   */
  playChime(preset = 'chime') {
    if (!this.soundEnabled) return false;

    const now = Date.now();
    if (now - this.lastPlayTime < this.minIntervalMs) {
      return false;
    }
    this.lastPlayTime = now;

    switch (preset) {
      case 'highArb':
        this.playHighArbChime();
        break;
      case 'alert':
        this.playWarningChime();
        break;
      case 'ping':
        this.playPingTone();
        break;
      case 'chime':
      default:
        this.playStandardChime();
        break;
    }
    return true;
  }

  /**
   * Synthesize a crisp 2-note ascending chime (E5 -> B5).
   */
  playStandardChime() {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(this.volume * 0.35, now);
    masterGain.connect(ctx.destination);

    // Note 1: E5 (659.25 Hz)
    this.playTone(ctx, masterGain, 659.25, now, 0.25, 'sine');
    // Note 2: B5 (987.77 Hz)
    this.playTone(ctx, masterGain, 987.77, now + 0.12, 0.4, 'sine');
  }

  /**
   * Synthesize a high-value arbitrage 4-note ascending major arpeggio (C5 -> E5 -> G5 -> C6).
   */
  playHighArbChime() {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(this.volume * 0.4, now);
    masterGain.connect(ctx.destination);

    const notes = [
      { freq: 523.25, time: now, duration: 0.2 },        // C5
      { freq: 659.25, time: now + 0.09, duration: 0.2 }, // E5
      { freq: 783.99, time: now + 0.18, duration: 0.2 }, // G5
      { freq: 1046.50, time: now + 0.27, duration: 0.5 } // C6
    ];

    notes.forEach(({ freq, time, duration }) => {
      this.playTone(ctx, masterGain, freq, time, duration, 'triangle');
    });
  }

  /**
   * Synthesize a warning tone.
   */
  playWarningChime() {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(this.volume * 0.3, now);
    masterGain.connect(ctx.destination);

    this.playTone(ctx, masterGain, 440, now, 0.15, 'sawtooth');
    this.playTone(ctx, masterGain, 349.23, now + 0.12, 0.3, 'sawtooth');
  }

  /**
   * Synthesize a single soft pop/ping.
   */
  playPingTone() {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(this.volume * 0.3, now);
    masterGain.connect(ctx.destination);

    this.playTone(ctx, masterGain, 880, now, 0.15, 'sine');
  }

  /**
   * Low-level helper to trigger an oscillator tone with envelope.
   */
  playTone(ctx, destination, frequency, startTime, duration, type = 'sine') {
    const osc = ctx.createOscillator();
    const noteGain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, startTime);

    // Envelope: Quick attack, exponential decay
    noteGain.gain.setValueAtTime(0.001, startTime);
    noteGain.gain.exponentialRampToValueAtTime(1.0, startTime + 0.015);
    noteGain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    osc.connect(noteGain);
    noteGain.connect(destination);

    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);
  }
}

export const audioAlerts = new AudioAlertManager();
