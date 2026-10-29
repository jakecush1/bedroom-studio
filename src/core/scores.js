// Public-domain classical pieces as compact scores, written out by hand so
// the room can render them without shipping audio. Each voice is a string of
// tokens in beats (a beat is a quarter note):
//   C5:1      a note, one beat        [C4 E4 G4]:2   a chord, two beats
//   r:0.5     a rest                  C5:1.5         dotted quarter
//   |         a bar line (ignored; it just keeps the text readable)
// `voice` picks the synth in classical.js: pluck (harpsichord), piano,
// strings, organ, bass.

const NAMES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "F#4" → 66. Accepts #, b and ## / bb. */
export function pitchOf(name) {
  const m = /^([A-Ga-g])(#{1,2}|b{1,2})?(-?\d)$/.exec(name.trim());
  if (!m) throw new Error(`bad pitch "${name}"`);
  const acc = m[2] ? (m[2][0] === "#" ? m[2].length : -m[2].length) : 0;
  return 12 * (parseInt(m[3], 10) + 1) + NAMES[m[1].toUpperCase()] + acc;
}

/**
 * Parse one voice into notes { pitch, start, dur } in beats.
 * @returns {{ notes: {pitch:number,start:number,dur:number}[], length: number }}
 */
export function parseVoice(text) {
  const notes = [];
  let t = 0;
  // a chord token holds spaces: match "[...]:dur" or a bare "name:dur"
  const tokens = text.replace(/\|/g, " ").match(/\[[^\]]*\]:[\d.]+|\S+/g) || [];
  for (const tok of tokens) {
    const colon = tok.lastIndexOf(":");
    if (colon < 0) throw new Error(`missing duration in "${tok}"`);
    const dur = parseFloat(tok.slice(colon + 1));
    if (!(dur > 0)) throw new Error(`bad duration in "${tok}"`);
    const head = tok.slice(0, colon);
    if (head === "r") { t += dur; continue; }
    const names = head.startsWith("[") ? head.slice(1, -1).split(/\s+/) : [head];
    for (const n of names) notes.push({ pitch: pitchOf(n), start: t, dur });
    t += dur;
  }
  return { notes, length: t };
}

/** A whole score: every voice parsed, tagged with its synth and level. */
export function parseScore(score) {
  const parts = score.parts.map((p) => {
    const v = parseVoice(p.notes);
    return { voice: p.voice, level: p.level ?? 1, notes: v.notes, length: v.length };
  });
  const beats = Math.max(...parts.map((p) => p.length));
  const repeats = score.repeat || 1;
  return { ...score, parts, beats, repeats, seconds: (beats * repeats * 60) / score.bpm };
}

/* ------------------------------------------------------------------ */
/* Bach — Prelude in C major, BWV 846                                   */
/* Each bar is a five-note chord played as the famous broken figure:    */
/* bass, tenor, then the upper three twice — and the whole half-bar     */
/* again. Bars 1–32 in the original harmony, then the two closing bars  */
/* on the pedal C and the final chord.                                  */
/* ------------------------------------------------------------------ */
const PRELUDE_CHORDS = [
  "C4 E4 G4 C5 E5", "C4 D4 A4 D5 F5", "B3 D4 G4 D5 F5", "C4 E4 G4 C5 E5",
  "C4 E4 A4 E5 A5", "C4 D4 F#4 A4 D5", "B3 D4 G4 D5 G5", "B3 C4 E4 G4 C5",
  "A3 C4 E4 G4 C5", "D3 A3 D4 F#4 C5", "G3 B3 D4 G4 B4", "G3 Bb3 E4 G4 C#5",
  "F3 A3 D4 A4 D5", "F3 Ab3 D4 F4 B4", "E3 G3 C4 G4 C5", "E3 F3 A3 C4 F4",
  "D3 F3 A3 C4 F4", "G2 D3 G3 B3 F4", "C3 E3 G3 C4 E4", "C3 G3 Bb3 C4 E4",
  "F2 F3 A3 C4 E4", "F#2 C3 A3 C4 Eb4", "Ab2 F3 B3 C4 D4", "G2 F3 G3 B3 D4",
  "G2 E3 G3 C4 E4", "G2 D3 G3 C4 F4", "G2 D3 G3 B3 F4", "G2 Eb3 A3 C4 F#4",
  "G2 E3 G3 C4 G4", "G2 D3 G3 C4 F4", "G2 D3 G3 B3 F4", "C2 C3 G3 Bb3 E4"
];
function preludeVoices() {
  let upper = "", lower = "";
  for (const chord of PRELUDE_CHORDS) {
    const [b, t, x, y, z] = chord.split(" ");
    // the two voices overlap in time: bass + tenor hold while the figure runs
    for (let half = 0; half < 2; half++) {
      lower += `${b}:0.25 ${t}:1.75 `;            // tenor enters a 16th after the bass
      upper += `r:0.5 ${x}:0.25 ${y}:0.25 ${z}:0.25 ${x}:0.25 ${y}:0.25 ${z}:0.25 `;
    }
    upper += "| ";
    lower += "| ";
  }
  // bars 33–34 (the long broken line over the pedal) and the final chord
  lower += "C2:2 C3:2 | C2:2 B2:2 | [C2 C3]:4 |";
  upper += "r:0.5 F3:0.25 A3:0.25 C4:0.25 F4:0.25 C4:0.25 A3:0.25 C4:0.25 A3:0.25 F3:0.25 A3:0.25 F3:0.25 D3:0.25 F3:0.25 D3:0.25 | "
         + "r:0.5 G3:0.25 B3:0.25 D4:0.25 F4:0.25 D4:0.25 B3:0.25 D4:0.25 B3:0.25 G3:0.25 B3:0.25 D4:0.25 F4:0.25 E4:0.25 D4:0.25 | [E4 G4 C5]:4 |";
  return { upper, lower };
}
const PRELUDE = preludeVoices();

/* ------------------------------------------------------------------ */
/* Bach (Petzold) — Minuet in G, BWV Anh. 114, first section            */
/* ------------------------------------------------------------------ */
const MINUET_MELODY = `
D5:1 G4:0.5 A4:0.5 B4:0.5 C5:0.5 | D5:1 G4:1 G4:1 | E5:1 C5:0.5 D5:0.5 E5:0.5 F#5:0.5 | G5:1 G4:1 G4:1 |
C5:1 D5:0.5 C5:0.5 B4:0.5 A4:0.5 | B4:1 C5:0.5 B4:0.5 A4:0.5 G4:0.5 | F#4:1 G4:0.5 A4:0.5 B4:0.5 G4:0.5 | B4:1 A4:2 |
D5:1 G4:0.5 A4:0.5 B4:0.5 C5:0.5 | D5:1 G4:1 G4:1 | E5:1 C5:0.5 D5:0.5 E5:0.5 F#5:0.5 | G5:1 G4:1 G4:1 |
C5:1 D5:0.5 C5:0.5 B4:0.5 A4:0.5 | B4:1 C5:0.5 B4:0.5 A4:0.5 G4:0.5 | A4:1 B4:0.5 A4:0.5 G4:0.5 F#4:0.5 | G4:3 |`;
// the left hand, kept simple and in the original harmony
const MINUET_LH = `
[G3 B3 D4]:2 A3:1 | B3:1 G3:2 | C4:2 B3:1 | [G3 B3]:1 D3:1 B3:1 |
A3:1 F#3:1 D3:1 | G3:1 B3:1 G3:1 | D3:1 B3:1 G3:1 | D4:1 C4:1 F#3:1 |
[G3 B3 D4]:2 A3:1 | B3:1 G3:2 | C4:2 B3:1 | [G3 B3]:1 D3:1 B3:1 |
A3:1 F#3:1 D3:1 | G3:1 B3:1 G3:1 | C4:1 D4:1 D3:1 | [G3 B3]:1 D3:1 G2:1 |`;

/* ------------------------------------------------------------------ */
/* Mozart — Twelve Variations on "Ah vous dirai-je, Maman", K. 265      */
/* The theme, with Mozart's left-hand figure.                           */
/* ------------------------------------------------------------------ */
const K265_THEME = `
C5:1 C5:1 G5:1 G5:1 | A5:1 A5:1 G5:2 | F5:1 F5:1 E5:1 E5:1 | D5:1 D5:1 C5:2 |
G5:1 G5:1 F5:1 F5:1 | E5:1 E5:1 D5:2 | G5:1 G5:1 F5:1 F5:1 | E5:1 E5:1 D5:2 |
C5:1 C5:1 G5:1 G5:1 | A5:1 A5:1 G5:2 | F5:1 F5:1 E5:1 E5:1 | D5:1 D5:1 C5:2 |`;
const K265_LH = `
C4:1 r:1 E4:1 E4:1 | F4:1 F4:1 E4:2 | D4:1 D4:1 C4:1 C4:1 | B3:1 B3:1 C4:2 |
E4:1 E4:1 D4:1 D4:1 | C4:1 C4:1 B3:2 | E4:1 E4:1 D4:1 D4:1 | C4:1 C4:1 B3:2 |
C4:1 r:1 E4:1 E4:1 | F4:1 F4:1 E4:2 | D4:1 D4:1 C4:1 C4:1 | B3:1 G3:1 C4:2 |`;
const K265_BASS = `
C3:2 C3:2 | F3:2 C3:2 | G3:2 C3:2 | G3:2 C3:2 |
C3:2 G3:2 | C3:2 G3:2 | C3:2 G3:2 | C3:2 G3:2 |
C3:2 C3:2 | F3:2 C3:2 | G3:2 C3:2 | G2:2 C3:2 |`;

/* ------------------------------------------------------------------ */
/* Mozart — Symphony No. 40 in G minor, K. 550, opening                 */
/* ------------------------------------------------------------------ */
const K550_MELODY = `
Eb5:0.5 D5:0.5 D5:1 Eb5:0.5 D5:0.5 D5:1 | Eb5:0.5 D5:0.5 D5:1 Bb5:2 |
Bb5:1 A5:0.5 A5:0.5 G5:1 G5:0.5 G5:0.5 | F5:1 F5:0.5 F5:0.5 Eb5:1 Eb5:0.5 Eb5:0.5 | D5:2 r:2 |
D5:0.5 C5:0.5 C5:1 D5:0.5 C5:0.5 C5:1 | D5:0.5 C5:0.5 C5:1 A5:2 |
A5:1 G5:0.5 G5:0.5 F5:1 F5:0.5 F5:0.5 | Eb5:1 Eb5:0.5 Eb5:0.5 D5:1 D5:0.5 D5:0.5 | C5:2 r:2 |`;
const K550_ACC = `
[G3 Bb3]:0.5 [G3 Bb3]:0.5 [G3 Bb3]:0.5 [G3 Bb3]:0.5 [G3 Bb3]:0.5 [G3 Bb3]:0.5 [G3 Bb3]:0.5 [G3 Bb3]:0.5 |
[G3 Bb3]:0.5 [G3 Bb3]:0.5 [G3 Bb3]:0.5 [G3 Bb3]:0.5 [G3 Bb3]:0.5 [G3 Bb3]:0.5 [G3 Bb3]:0.5 [G3 Bb3]:0.5 |
[G3 Bb3]:0.5 [G3 Bb3]:0.5 [G3 Bb3]:0.5 [G3 Bb3]:0.5 [A3 C4]:0.5 [A3 C4]:0.5 [A3 C4]:0.5 [A3 C4]:0.5 |
[A3 D4]:0.5 [A3 D4]:0.5 [A3 D4]:0.5 [A3 D4]:0.5 [A3 C4]:0.5 [A3 C4]:0.5 [A3 C4]:0.5 [A3 C4]:0.5 |
[Bb3 D4]:2 r:2 |
[F3 A3]:0.5 [F3 A3]:0.5 [F3 A3]:0.5 [F3 A3]:0.5 [F3 A3]:0.5 [F3 A3]:0.5 [F3 A3]:0.5 [F3 A3]:0.5 |
[F3 A3]:0.5 [F3 A3]:0.5 [F3 A3]:0.5 [F3 A3]:0.5 [F3 A3]:0.5 [F3 A3]:0.5 [F3 A3]:0.5 [F3 A3]:0.5 |
[F3 A3]:0.5 [F3 A3]:0.5 [F3 A3]:0.5 [F3 A3]:0.5 [G3 Bb3]:0.5 [G3 Bb3]:0.5 [G3 Bb3]:0.5 [G3 Bb3]:0.5 |
[G3 C4]:0.5 [G3 C4]:0.5 [G3 C4]:0.5 [G3 C4]:0.5 [G3 Bb3]:0.5 [G3 Bb3]:0.5 [G3 Bb3]:0.5 [G3 Bb3]:0.5 |
[A3 C4]:2 r:2 |`;
const K550_BASS = `
G2:4 | G2:4 | G2:2 F2:2 | F2:2 F2:2 | Bb2:2 r:2 | F2:4 | F2:4 | F2:2 Eb2:2 | Eb2:2 Eb2:2 | F2:2 r:2 |`;

/* ------------------------------------------------------------------ */
/* Vivaldi — "Spring" from The Four Seasons, RV 269, opening ritornello */
/* ------------------------------------------------------------------ */
const SPRING_VIOLIN = `
E5:0.5 G#5:0.5 G#5:0.5 G#5:0.5 F#5:0.5 E5:0.5 B5:1 | B5:0.5 A5:0.5 G#5:0.5 G#5:0.5 F#5:0.5 E5:0.5 B5:1 | B5:0.5 A5:0.5 G#5:0.5 A5:0.5 B5:1 B5:1 |
E5:0.5 G#5:0.5 G#5:0.5 G#5:0.5 F#5:0.5 E5:0.5 B5:1 | B5:0.5 A5:0.5 G#5:0.5 G#5:0.5 F#5:0.5 E5:0.5 B5:1 | B5:0.5 A5:0.5 G#5:0.5 A5:0.5 B5:1 B5:1 |
E5:0.5 G#5:0.5 G#5:0.5 G#5:0.5 F#5:0.5 E5:0.5 B5:1 | B5:0.5 A5:0.5 G#5:0.5 G#5:0.5 F#5:0.5 E5:0.5 B5:1 | B5:0.5 A5:0.5 G#5:0.5 A5:0.5 B5:1 E5:1 |`;
const SPRING_SECOND = `
B4:0.5 E5:0.5 E5:0.5 E5:0.5 D#5:0.5 B4:0.5 G#5:1 | G#5:0.5 F#5:0.5 E5:0.5 E5:0.5 D#5:0.5 B4:0.5 G#5:1 | G#5:0.5 F#5:0.5 E5:0.5 F#5:0.5 G#5:1 G#5:1 |
B4:0.5 E5:0.5 E5:0.5 E5:0.5 D#5:0.5 B4:0.5 G#5:1 | G#5:0.5 F#5:0.5 E5:0.5 E5:0.5 D#5:0.5 B4:0.5 G#5:1 | G#5:0.5 F#5:0.5 E5:0.5 F#5:0.5 G#5:1 G#5:1 |
B4:0.5 E5:0.5 E5:0.5 E5:0.5 D#5:0.5 B4:0.5 G#5:1 | G#5:0.5 F#5:0.5 E5:0.5 E5:0.5 D#5:0.5 B4:0.5 G#5:1 | G#5:0.5 F#5:0.5 E5:0.5 F#5:0.5 G#5:1 G#4:1 |`;
const SPRING_BASS = `
E3:0.5 E3:0.5 E3:0.5 E3:0.5 E3:0.5 E3:0.5 E3:1 | E3:0.5 E3:0.5 E3:0.5 E3:0.5 E3:0.5 E3:0.5 E3:1 | B2:0.5 B2:0.5 B2:0.5 B2:0.5 E3:1 E3:1 |
E3:0.5 E3:0.5 E3:0.5 E3:0.5 E3:0.5 E3:0.5 E3:1 | E3:0.5 E3:0.5 E3:0.5 E3:0.5 E3:0.5 E3:0.5 E3:1 | B2:0.5 B2:0.5 B2:0.5 B2:0.5 E3:1 E3:1 |
E3:0.5 E3:0.5 E3:0.5 E3:0.5 E3:0.5 E3:0.5 E3:1 | E3:0.5 E3:0.5 E3:0.5 E3:0.5 E3:0.5 E3:0.5 E3:1 | B2:0.5 B2:0.5 B2:0.5 B2:0.5 E3:1 E2:1 |`;

/* ------------------------------------------------------------------ */
/* Beethoven — Für Elise, WoO 59, the A section (3/8, written in 16ths) */
/* ------------------------------------------------------------------ */
const ELISE_RH = `
E5:0.25 D#5:0.25 | E5:0.25 D#5:0.25 E5:0.25 B4:0.25 D5:0.25 C5:0.25 | A4:0.5 r:0.25 C4:0.25 E4:0.25 A4:0.25 | B4:0.5 r:0.25 E4:0.25 G#4:0.25 B4:0.25 |
C5:0.5 r:0.25 E4:0.25 E5:0.25 D#5:0.25 | E5:0.25 D#5:0.25 E5:0.25 B4:0.25 D5:0.25 C5:0.25 | A4:0.5 r:0.25 C4:0.25 E4:0.25 A4:0.25 | B4:0.5 r:0.25 E4:0.25 C5:0.25 B4:0.25 |
A4:0.5 r:0.25 B4:0.25 C5:0.25 D5:0.25 | E5:0.75 G4:0.25 F5:0.25 E5:0.25 | D5:0.75 F4:0.25 E5:0.25 D5:0.25 | C5:0.75 E4:0.25 D5:0.25 C5:0.25 |
B4:0.5 r:0.25 E4:0.25 E5:0.25 r:0.25 | r:0.25 E5:0.25 E6:0.25 r:0.25 D#5:0.25 E5:0.25 | r:0.25 D#5:0.25 E5:0.25 D#5:0.25 E5:0.25 D#5:0.25 |
E5:0.25 D#5:0.25 E5:0.25 B4:0.25 D5:0.25 C5:0.25 | A4:0.5 r:0.25 C4:0.25 E4:0.25 A4:0.25 | B4:0.5 r:0.25 E4:0.25 G#4:0.25 B4:0.25 |
C5:0.5 r:0.25 E4:0.25 E5:0.25 D#5:0.25 | E5:0.25 D#5:0.25 E5:0.25 B4:0.25 D5:0.25 C5:0.25 | A4:0.5 r:0.25 C4:0.25 E4:0.25 A4:0.25 | B4:0.5 r:0.25 E4:0.25 C5:0.25 B4:0.25 | A4:1.5 |`;
const ELISE_LH = `
r:0.5 | r:1.5 | A2:0.25 E3:0.25 A3:0.25 r:0.75 | E2:0.25 E3:0.25 G#3:0.25 r:0.75 |
A2:0.25 E3:0.25 A3:0.25 r:0.75 | r:1.5 | A2:0.25 E3:0.25 A3:0.25 r:0.75 | E2:0.25 E3:0.25 G#3:0.25 r:0.75 |
A2:0.25 E3:0.25 A3:0.25 r:0.75 | C3:0.25 G3:0.25 C4:0.25 r:0.75 | G2:0.25 G3:0.25 B3:0.25 r:0.75 | A2:0.25 E3:0.25 A3:0.25 r:0.75 |
E2:0.25 E3:0.25 E4:0.25 r:0.75 | r:1.5 | r:1.5 |
r:1.5 | A2:0.25 E3:0.25 A3:0.25 r:0.75 | E2:0.25 E3:0.25 G#3:0.25 r:0.75 |
A2:0.25 E3:0.25 A3:0.25 r:0.75 | r:1.5 | A2:0.25 E3:0.25 A3:0.25 r:0.75 | E2:0.25 E3:0.25 G#3:0.25 r:0.75 | A2:0.25 E3:0.25 A3:0.25 r:0.75 |`;

/* ------------------------------------------------------------------ */
/* Pachelbel — Canon in D: the ground bass with the first three         */
/* entries of the violin canon.                                         */
/* ------------------------------------------------------------------ */
const CANON_BASS_BAR = "D3:2 A2:2 | B2:2 F#2:2 | G2:2 D2:2 | G2:2 A2:2 |";
const CANON_BASS = CANON_BASS_BAR.repeat(7);
const CANON_V1 = `
r:4 | r:4 | r:4 | r:4 |
F#5:2 E5:2 | D5:2 C#5:2 | B4:2 A4:2 | B4:2 C#5:2 |
D5:2 C#5:2 | B4:2 A4:2 | G4:2 F#4:2 | G4:2 E4:2 |
D4:1 F#4:1 A4:1 G4:1 | F#4:1 D4:1 F#4:1 E4:1 | D4:1 B3:1 D4:1 A4:1 | G4:1 B4:1 A4:1 G4:1 |
F#4:1 D4:1 E4:1 C#5:1 | D5:1 F#5:1 A5:1 A4:1 | B4:1 G4:1 A4:1 F#4:1 | D4:1 D5:1 D5:0.5 C#5:0.5 D5:1 |
F#5:2 E5:2 | D5:2 C#5:2 | B4:2 A4:2 | B4:2 C#5:2 |
D5:2 C#5:2 | B4:2 A4:2 | G4:2 F#4:2 | G4:2 E4:2 |`;
const CANON_V2 = `
r:4 | r:4 | r:4 | r:4 | r:4 | r:4 | r:4 | r:4 |
F#5:2 E5:2 | D5:2 C#5:2 | B4:2 A4:2 | B4:2 C#5:2 |
D5:2 C#5:2 | B4:2 A4:2 | G4:2 F#4:2 | G4:2 E4:2 |
D4:1 F#4:1 A4:1 G4:1 | F#4:1 D4:1 F#4:1 E4:1 | D4:1 B3:1 D4:1 A4:1 | G4:1 B4:1 A4:1 G4:1 |
F#4:1 D4:1 E4:1 C#5:1 | D5:1 F#5:1 A5:1 A4:1 | B4:1 G4:1 A4:1 F#4:1 | D4:1 D5:1 D5:0.5 C#5:0.5 D5:1 |
F#5:2 E5:2 | D5:2 C#5:2 | B4:2 A4:2 | B4:2 C#5:2 |`;
const CANON_V3 = `
r:4 | r:4 | r:4 | r:4 | r:4 | r:4 | r:4 | r:4 | r:4 | r:4 | r:4 | r:4 |
F#5:2 E5:2 | D5:2 C#5:2 | B4:2 A4:2 | B4:2 C#5:2 |
D5:2 C#5:2 | B4:2 A4:2 | G4:2 F#4:2 | G4:2 E4:2 |
D4:1 F#4:1 A4:1 G4:1 | F#4:1 D4:1 F#4:1 E4:1 | D4:1 B3:1 D4:1 A4:1 | G4:1 B4:1 A4:1 G4:1 |
F#4:1 D4:1 E4:1 C#5:1 | D5:1 F#5:1 A5:1 A4:1 | B4:1 G4:1 A4:1 F#4:1 | D4:1 D5:1 D5:0.5 C#5:0.5 D5:1 |`;

export const SCORES = [
  {
    id: "bach-prelude-c", composer: "Bach", title: "Prelude in C major, BWV 846", bpm: 72, key: "C major", meter: [4, 4],
    parts: [{ voice: "pluck", notes: PRELUDE.upper }, { voice: "pluck", notes: PRELUDE.lower, level: 0.85 }]
  },
  {
    id: "bach-minuet-g", composer: "Bach", title: "Minuet in G, BWV Anh. 114", bpm: 116, key: "G major", meter: [3, 4], repeat: 2,
    parts: [{ voice: "pluck", notes: MINUET_MELODY }, { voice: "pluck", notes: MINUET_LH, level: 0.7 }]
  },
  {
    id: "mozart-k265", composer: "Mozart", title: "Ah vous dirai-je, Maman, K. 265 (theme)", bpm: 100, key: "C major", meter: [2, 4],
    parts: [{ voice: "piano", notes: K265_THEME }, { voice: "piano", notes: K265_LH, level: 0.6 }, { voice: "bass", notes: K265_BASS, level: 0.7 }]
  },
  {
    id: "mozart-k550", composer: "Mozart", title: "Symphony No. 40 in G minor (opening)", bpm: 108, key: "G minor", meter: [4, 4], repeat: 2,
    parts: [{ voice: "strings", notes: K550_MELODY }, { voice: "strings", notes: K550_ACC, level: 0.45 }, { voice: "bass", notes: K550_BASS, level: 0.8 }]
  },
  {
    id: "vivaldi-spring", composer: "Vivaldi", title: "Spring, from The Four Seasons (ritornello)", bpm: 104, key: "E major", meter: [4, 4],
    parts: [{ voice: "strings", notes: SPRING_VIOLIN }, { voice: "strings", notes: SPRING_SECOND, level: 0.5 }, { voice: "bass", notes: SPRING_BASS, level: 0.8 }]
  },
  {
    id: "beethoven-elise", composer: "Beethoven", title: "Für Elise, WoO 59 (A section)", bpm: 76, key: "A minor", meter: [3, 8], repeat: 2,
    parts: [{ voice: "piano", notes: ELISE_RH }, { voice: "piano", notes: ELISE_LH, level: 0.75 }]
  },
  {
    id: "pachelbel-canon", composer: "Pachelbel", title: "Canon in D", bpm: 60, key: "D major", meter: [4, 4],
    parts: [{ voice: "strings", notes: CANON_V1 }, { voice: "strings", notes: CANON_V2, level: 0.8 }, { voice: "strings", notes: CANON_V3, level: 0.65 }, { voice: "bass", notes: CANON_BASS, level: 0.9 }]
  }
];
