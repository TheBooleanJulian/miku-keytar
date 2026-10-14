import type { Chord } from "../audio/chords.ts";

interface Props {
  chords: Chord[];
  /** Bit n set = chord n is sounding / latched. */
  mask: number;
  onPress: (degree: number, pointerId: number) => void;
  onRelease: (pointerId: number) => void;
}

/** Seven diatonic chord buttons. Each button tracks its own pointer, so several can be held at once. */
export function ChordBar({ chords, mask, onPress, onRelease }: Props) {
  return (
    <nav className="chordbar" aria-label="Chords">
      {chords.map((c) => {
        const on = ((mask >> c.degree) & 1) === 1;
        return (
          <button
            key={c.degree}
            type="button"
            className={`chord${on ? " on" : ""}`}
            aria-pressed={on}
            onPointerDown={(e) => {
              e.preventDefault();
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                // pointer already gone
              }
              onPress(c.degree, e.pointerId);
            }}
            onPointerUp={(e) => onRelease(e.pointerId)}
            onPointerCancel={(e) => onRelease(e.pointerId)}
            onLostPointerCapture={(e) => onRelease(e.pointerId)}
            onContextMenu={(e) => e.preventDefault()}
          >
            <b className="mono">{c.roman}</b>
            <span>{c.name}</span>
          </button>
        );
      })}
    </nav>
  );
}
