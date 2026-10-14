// Ten basic rhythm patterns. One bar = 16 sixteenth-note steps; every string is exactly 16 characters.
//
//   kick / snare / hat / open : 'x' = hit, 'o' = soft hit, '.' = rest
//   bass : '1' = chord root, '5' = chord fifth, '8' = root octave up, '.' = rest (a note lasts until the next one)
//   arp  : '0'..'3' = chord tone index (3 = the 7th, or the octave root for triads), '.' = rest
//   pad  : 'S...' = sustained chord, re-voiced each bar; otherwise 'x' = short chord stab at that step
//   swing: fraction of a step that odd (off-beat) 16ths are delayed by

export interface Pattern {
  name: string;
  bpm: number;
  swing: number;
  kick: string;
  snare: string;
  hat: string;
  open: string;
  bass: string;
  arp: string;
  pad: string;
}

const NONE = "................";
const SUSTAIN = "S...............";

export const PATTERNS: readonly Pattern[] = [
  {
    name: "Pop Rock",
    bpm: 110,
    swing: 0,
    kick: "x.......x.x.....",
    snare: "....x.......x...",
    hat: "x.x.x.x.x.x.x.x.",
    open: NONE,
    bass: "1.1.1.1.1.1.1.1.",
    arp: NONE,
    pad: SUSTAIN,
  },
  {
    name: "Four on the Floor",
    bpm: 124,
    swing: 0,
    kick: "x...x...x...x...",
    snare: "....x.......x...",
    hat: "o.o.o.o.o.o.o.o.",
    open: "..x...x...x...x.",
    bass: "..1...1...1...1.",
    arp: NONE,
    pad: "..x...x...x...x.",
  },
  {
    name: "Pop Ballad",
    bpm: 72,
    swing: 0,
    kick: "x.......x.......",
    snare: "........x.......",
    hat: "o...o...o...o...",
    open: NONE,
    bass: "1.......5.......",
    arp: "0.1.2.1.0.1.2.1.",
    pad: SUSTAIN,
  },
  {
    name: "Funk",
    bpm: 100,
    swing: 0.12,
    kick: "x..x..x...x..x..",
    snare: "....x..o.o..x..o",
    hat: "xoxoxoxoxoxoxoxo",
    open: "..............x.",
    bass: "1..1..8..1.5.1..",
    arp: NONE,
    pad: "..x..x....x..x..",
  },
  {
    name: "Reggae One Drop",
    bpm: 80,
    swing: 0,
    kick: "........x.......",
    snare: "........x.......",
    hat: "..x...x...x...x.",
    open: NONE,
    bass: "1..1....5....1..",
    arp: NONE,
    pad: "..x...x...x...x.",
  },
  {
    name: "Hip-Hop",
    bpm: 90,
    swing: 0.2,
    kick: "x.....x..x......",
    snare: "....x.......x...",
    hat: "o.x.o.x.o.x.o.x.",
    open: NONE,
    bass: "1.....1..1......",
    arp: NONE,
    pad: SUSTAIN,
  },
  {
    name: "Bossa Nova",
    bpm: 128,
    swing: 0,
    kick: "x..x....x..x....",
    snare: "..x..x...x..x...",
    hat: "o.o.o.o.o.o.o.o.",
    open: NONE,
    bass: "1..5....1..5....",
    arp: NONE,
    pad: "x..x..x.x..x..x.",
  },
  {
    name: "Blues Shuffle",
    bpm: 96,
    swing: 0.33,
    kick: "x.....x...x.....",
    snare: "....x.......x...",
    hat: "x.x.x.x.x.x.x.x.",
    open: NONE,
    bass: "1.1.5.1.1.1.5.8.",
    arp: NONE,
    pad: SUSTAIN,
  },
  {
    name: "Trap",
    bpm: 140,
    swing: 0,
    kick: "x.....x....x....",
    snare: "........x.......",
    hat: "x.xxx.x.x.xxx.x.",
    open: "..............x.",
    bass: "1.......1.....1.",
    arp: "0.......2.......",
    pad: SUSTAIN,
  },
  {
    name: "Synthwave",
    bpm: 118,
    swing: 0,
    kick: "x...x...x...x...",
    snare: "....x.......x...",
    hat: "o.x.o.x.o.x.o.x.",
    open: "......x.......x.",
    bass: "1.1.1.1.1.1.1.1.",
    arp: "0123210301232103",
    pad: SUSTAIN,
  },
];
