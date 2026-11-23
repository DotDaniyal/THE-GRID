// Procedural Web Audio synthesizer for THE GRID 3D stadium intro.
// Zero external audio asset dependencies; respects browser autoplay constraints.

export class StadiumIntroAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private bedStarted = false;
  private bedGain: GainNode | null = null;
  private bedNodes: AudioNode[] = [];
  private _enabled = false;
  private _disposed = false;

  public get enabled(): boolean {
    return this._enabled;
  }

  private ensureContext(): AudioContext | null {
    if (this._disposed || typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;

    if (!this.ctx) {
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this._enabled ? 0.72 : 0.0;
      this.masterGain.connect(this.ctx.destination);
      this.noiseBuffer = this.createNoiseBuffer(this.ctx);
    }
    return this.ctx;
  }

  private createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = ctx.sampleRate * 3;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      // Pink/brown-tinted noise for realistic wind, turf & crowd beds
      lastOut = (lastOut + 0.04 * white) / 1.04;
      data[i] = lastOut * 3.2 + white * 0.25;
    }
    return buffer;
  }

  public async setEnabled(enable: boolean): Promise<boolean> {
    if (this._disposed) return false;
    this._enabled = enable;
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) {
      this._enabled = false;
      return false;
    }

    if (enable) {
      try {
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }
        const now = ctx.currentTime;
        this.masterGain.gain.cancelScheduledValues(now);
        this.masterGain.gain.setTargetAtTime(0.75, now, 0.08);
        this.startStadiumBed();
        return true;
      } catch {
        this._enabled = false;
        return false;
      }
    } else {
      const now = ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setTargetAtTime(0.0, now, 0.05);
      return false;
    }
  }

  public startStadiumBed(): void {
    if (this._disposed || !this._enabled) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || !this.noiseBuffer || this.bedStarted) return;

    this.bedStarted = true;
    const now = ctx.currentTime;
    const bedGain = ctx.createGain();
    bedGain.gain.setValueAtTime(0.001, now);
    bedGain.gain.exponentialRampToValueAtTime(0.28, now + 0.9);
    bedGain.connect(this.masterGain);
    this.bedGain = bedGain;

    // Distant night stadium atmosphere
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = this.noiseBuffer;
    noiseSrc.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 210;
    filter.Q.value = 0.75;
    noiseSrc.connect(filter);
    filter.connect(bedGain);
    noiseSrc.start(now);

    // Sub-bass cinema drone
    const subOsc = ctx.createOscillator();
    subOsc.type = 'sine';
    subOsc.frequency.value = 55; // A1
    const subGain = ctx.createGain();
    subGain.gain.value = 0.24;
    subOsc.connect(subGain);
    subGain.connect(bedGain);
    subOsc.start(now);

    this.bedNodes.push(noiseSrc, filter, subOsc, subGain, bedGain);
  }

  public fadeOutBed(durationSec = 1.2): void {
    if (!this.ctx || !this.bedGain) return;
    const now = this.ctx.currentTime;
    this.bedGain.gain.cancelScheduledValues(now);
    this.bedGain.gain.setTargetAtTime(0.04, now, durationSec * 0.35);
  }

  public playFloodlightIgnition(intensityIndex: number): void {
    if (!this._enabled || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Crisp mechanical breaker snap
    const snap = ctx.createBufferSource();
    snap.buffer = this.noiseBuffer;
    const snapFilter = ctx.createBiquadFilter();
    snapFilter.type = 'bandpass';
    snapFilter.frequency.value = 1750 + intensityIndex * 240;
    snapFilter.Q.value = 3.2;
    const snapGain = ctx.createGain();
    snapGain.gain.setValueAtTime(0.32, now);
    snapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    snap.connect(snapFilter);
    snapFilter.connect(snapGain);
    snapGain.connect(this.masterGain);
    snap.start(now);
    snap.stop(now + 0.09);

    // Ballast / power surge hum
    const humOsc = ctx.createOscillator();
    humOsc.type = 'sawtooth';
    humOsc.frequency.setValueAtTime(110 + intensityIndex * 18, now);
    humOsc.frequency.exponentialRampToValueAtTime(160 + intensityIndex * 24, now + 0.28);

    const humFilter = ctx.createBiquadFilter();
    humFilter.type = 'lowpass';
    humFilter.frequency.value = 420;

    const humGain = ctx.createGain();
    humGain.gain.setValueAtTime(0.001, now);
    humGain.gain.linearRampToValueAtTime(0.12, now + 0.04);
    humGain.gain.exponentialRampToValueAtTime(0.001, now + 0.52);

    humOsc.connect(humFilter);
    humFilter.connect(humGain);
    humGain.connect(this.masterGain);
    humOsc.start(now);
    humOsc.stop(now + 0.55);
  }

  public playFootstep(intensity = 0.7): void {
    if (!this._enabled || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const turf = ctx.createBufferSource();
    turf.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 520;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.14 * intensity, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

    turf.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    turf.start(now, Math.random() * 1.2);
    turf.stop(now + 0.1);
  }

  public playDribbleTap(): void {
    if (!this._enabled || !this.ctx || !this.masterGain) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(155, now);
    osc.frequency.exponentialRampToValueAtTime(58, now + 0.065);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.09);
  }

  public playKickStrike(): void {
    if (!this._enabled || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Deep leather impact punch
    const punch = ctx.createOscillator();
    punch.type = 'sine';
    punch.frequency.setValueAtTime(135, now);
    punch.frequency.exponentialRampToValueAtTime(36, now + 0.19);
    const punchGain = ctx.createGain();
    punchGain.gain.setValueAtTime(0.55, now);
    punchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    punch.connect(punchGain);
    punchGain.connect(this.masterGain);
    punch.start(now);
    punch.stop(now + 0.24);

    // Snap & air whoosh
    const snap = ctx.createBufferSource();
    snap.buffer = this.noiseBuffer;
    const snapFilter = ctx.createBiquadFilter();
    snapFilter.type = 'bandpass';
    snapFilter.frequency.setValueAtTime(1250, now);
    snapFilter.frequency.exponentialRampToValueAtTime(340, now + 0.25);
    snapFilter.Q.value = 1.4;
    const snapGain = ctx.createGain();
    snapGain.gain.setValueAtTime(0.38, now);
    snapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
    snap.connect(snapFilter);
    snapFilter.connect(snapGain);
    snapGain.connect(this.masterGain);
    snap.start(now);
    snap.stop(now + 0.28);
  }

  public playGoalImpact(): void {
    if (!this._enabled || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Sub-bass boom
    const boom = ctx.createOscillator();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(74, now);
    boom.frequency.exponentialRampToValueAtTime(28, now + 0.65);
    const boomGain = ctx.createGain();
    boomGain.gain.setValueAtTime(0.52, now);
    boomGain.gain.exponentialRampToValueAtTime(0.001, now + 0.72);
    boom.connect(boomGain);
    boomGain.connect(this.masterGain);
    boom.start(now);
    boom.stop(now + 0.75);

    // Taut net snap
    const netSnap = ctx.createBufferSource();
    netSnap.buffer = this.noiseBuffer;
    const netFilter = ctx.createBiquadFilter();
    netFilter.type = 'highpass';
    netFilter.frequency.value = 950;
    const netGain = ctx.createGain();
    netGain.gain.setValueAtTime(0.28, now);
    netGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    netSnap.connect(netFilter);
    netFilter.connect(netGain);
    netGain.connect(this.masterGain);
    netSnap.start(now);
    netSnap.stop(now + 0.2);

    // Crowd stadium roar swell
    const crowd = ctx.createBufferSource();
    crowd.buffer = this.noiseBuffer;
    crowd.loop = true;
    const crowdFilter = ctx.createBiquadFilter();
    crowdFilter.type = 'bandpass';
    crowdFilter.frequency.setValueAtTime(480, now);
    crowdFilter.frequency.exponentialRampToValueAtTime(1180, now + 0.38);
    crowdFilter.frequency.exponentialRampToValueAtTime(620, now + 2.0);
    crowdFilter.Q.value = 0.65;

    const crowdGain = ctx.createGain();
    crowdGain.gain.setValueAtTime(0.001, now);
    crowdGain.gain.linearRampToValueAtTime(0.36, now + 0.16);
    crowdGain.gain.exponentialRampToValueAtTime(0.001, now + 2.2);

    crowd.connect(crowdFilter);
    crowdFilter.connect(crowdGain);
    crowdGain.connect(this.masterGain);
    crowd.start(now);
    crowd.stop(now + 2.25);
  }

  public playLogoReveal(): void {
    if (!this._enabled || !this.ctx || !this.masterGain) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const notes = [110, 164.81, 220, 277.18, 329.63]; // A major resonant stadium chord
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(340, now);
    filter.frequency.exponentialRampToValueAtTime(2400, now + 0.65);
    filter.frequency.exponentialRampToValueAtTime(750, now + 2.1);

    const chordGain = ctx.createGain();
    chordGain.gain.setValueAtTime(0.001, now);
    chordGain.gain.linearRampToValueAtTime(0.24, now + 0.18);
    chordGain.gain.exponentialRampToValueAtTime(0.001, now + 2.3);

    filter.connect(chordGain);
    chordGain.connect(this.masterGain);

    for (let i = 0; i < notes.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = i < 2 ? 'sawtooth' : 'triangle';
      osc.frequency.value = notes[i];
      osc.detune.value = (i - 2) * 5;
      const g = ctx.createGain();
      g.gain.value = 1 / notes.length;
      osc.connect(g);
      g.connect(filter);
      osc.start(now);
      osc.stop(now + 2.35);
    }
  }

  public dispose(): void {
    this._disposed = true;
    this._enabled = false;
    for (const node of this.bedNodes) {
      try {
        if ('stop' in node && typeof (node as AudioScheduledSourceNode).stop === 'function') {
          (node as AudioScheduledSourceNode).stop();
        }
        node.disconnect();
      } catch {
        // Ignore already-stopped audio nodes
      }
    }
    this.bedNodes = [];
    this.bedStarted = false;
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.masterGain = null;
    this.noiseBuffer = null;
  }
}
