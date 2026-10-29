// Local reference-audio player for tuning by ear and by eye. The file is decoded in the browser and never
// uploaded. It plays into the master volume/mute and has its own analyser, so its spectrum can be drawn next to
// the synth's. Pause/resume works by remembering the position and restarting a fresh buffer source.

export type ReferenceState = "empty" | "stopped" | "playing" | "paused";

export interface ReferenceTarget {
  ctx: AudioContext;
  out: AudioNode;
}

const MAX_BYTES = 60 * 1024 * 1024;

export class ReferencePlayer {
  private getTarget: () => ReferenceTarget | null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private offset = 0; // seconds into the file where playback resumes
  private startedAt = 0; // ctx time corresponding to offset 0 of the current run
  private listeners = new Set<() => void>();
  state: ReferenceState = "empty";
  name = "";

  constructor(getTarget: () => ReferenceTarget | null) {
    this.getTarget = getTarget;
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  /** Decodes a user-chosen audio file. Throws an Error with a readable message on failure. */
  async load(file: File): Promise<void> {
    const target = this.getTarget();
    if (!target) throw new Error("Start audio first, then choose a reference file.");
    if (file.size > MAX_BYTES) throw new Error("That file is larger than 60 MB; try a shorter clip.");
    this.stop();
    let buffer: AudioBuffer;
    try {
      buffer = await target.ctx.decodeAudioData(await file.arrayBuffer());
    } catch {
      throw new Error("This browser could not decode that file. Try a WAV, MP3 or M4A clip.");
    }
    this.ctx = target.ctx;
    this.buffer = buffer;
    this.name = file.name;
    this.offset = 0;
    if (!this.analyser) {
      const a = target.ctx.createAnalyser();
      a.fftSize = 2048;
      a.smoothingTimeConstant = 0.8;
      a.minDecibels = -100;
      a.maxDecibels = -20;
      a.connect(target.out);
      this.analyser = a;
    }
    this.setState("stopped");
  }

  play(): void {
    const ctx = this.ctx;
    if (!ctx || !this.buffer || !this.analyser || this.state === "playing") return;
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.analyser);
    src.onended = () => {
      // Only treat it as finished if we weren't the ones who stopped it.
      if (this.source === src && this.state === "playing") {
        this.source = null;
        this.offset = 0;
        this.setState("stopped");
      }
    };
    this.startedAt = ctx.currentTime - this.offset;
    src.start(0, this.offset);
    this.source = src;
    this.setState("playing");
  }

  pause(): void {
    const ctx = this.ctx;
    if (!ctx || this.state !== "playing") return;
    this.offset = Math.min(ctx.currentTime - this.startedAt, this.duration);
    this.halt();
    this.setState("paused");
  }

  stop(): void {
    if (this.state === "empty" || this.state === "stopped") return;
    this.offset = 0;
    this.halt();
    this.setState("stopped");
  }

  /** Spectrum of the reference (same bin layout as the synth analyser). False when it isn't playing. */
  readSpectrum(out: Float32Array<ArrayBuffer>): boolean {
    if (this.state !== "playing" || !this.analyser || out.length < this.analyser.frequencyBinCount) return false;
    this.analyser.getFloatFrequencyData(out);
    return true;
  }

  dispose(): void {
    this.halt();
    this.analyser?.disconnect();
    this.analyser = null;
    this.buffer = null;
    this.listeners.clear();
    this.state = "empty";
  }

  private halt(): void {
    const src = this.source;
    this.source = null;
    if (!src) return;
    try {
      src.stop();
    } catch {
      // already stopped
    }
    src.disconnect();
  }

  private setState(s: ReferenceState): void {
    this.state = s;
    for (const cb of this.listeners) cb();
  }
}
