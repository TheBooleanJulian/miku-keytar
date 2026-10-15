// Tap tempo: average the gaps between recent taps. Pure logic, no DOM.

const MAX_TAPS = 6; // use the last 6 taps (5 gaps) so one sloppy tap fades out quickly
const RESET_GAP_MS = 2000; // a pause this long starts a new count
const MIN_BPM = 50;
const MAX_BPM = 200;

export class TapTempo {
  private taps: number[] = [];

  /** Register a tap at `timeMs`. Returns the tempo once there are at least two taps, else null. */
  tap(timeMs: number): number | null {
    const last = this.taps[this.taps.length - 1];
    if (last !== undefined && timeMs - last > RESET_GAP_MS) this.taps.length = 0;
    this.taps.push(timeMs);
    if (this.taps.length > MAX_TAPS) this.taps.shift();
    if (this.taps.length < 2) return null;
    const avg = (this.taps[this.taps.length - 1] - this.taps[0]) / (this.taps.length - 1);
    if (avg <= 0) return null;
    return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(60000 / avg)));
  }

  get count(): number {
    return this.taps.length;
  }

  reset(): void {
    this.taps.length = 0;
  }
}
