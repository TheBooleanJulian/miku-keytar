// What the engine needs from any voice, whatever instrument made it (lead synth or vocal).

export const VOICE_PEAK = 0.22;
/** Time constant (s) for smoothing parameter changes so they never click. */
export const PARAM_TC = 0.025;

export interface VoiceHandle {
  /** Envelope gain: the engine releases a voice by ramping this to zero. */
  env: GainNode;
  /** Every source node that must be stopped when the voice ends. The first one's `onended` triggers cleanup. */
  sources: AudioScheduledSourceNode[];
  setPitch(freq: number, now: number, timeConstant: number): void;
  /** Vertical performance position 0..1 (lead: brightness; vocal: vowel morph or brightness). */
  setControl(y: number, now: number): void;
  /** Re-apply the current settings to a sounding voice (preset switch, tuner edits). */
  refresh(now: number): void;
  /** Release time in seconds under the settings in force right now. */
  releaseSeconds(): number;
  /** Disconnect every node so the voice can be garbage collected. */
  disconnect(): void;
}
