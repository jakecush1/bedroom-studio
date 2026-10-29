// Built-in tapes that ship with the room: a procedurally rendered lofi demo
// loop, a synthetic off-key singer for the autotune, and a shelf of classical
// pieces (Bach, Mozart, Vivaldi, Beethoven, Pachelbel) rendered from scores
// the first time they are picked — something for Chipify and the SCRIBE to
// chew on without shipping audio files.
import { renderDemoLoop } from "./demo.js";
import { renderDemoVocal } from "./demovocal.js";
import { SCORES } from "./scores.js";
import { renderScore, renderMidiFile } from "./classical.js";

const midiBase = `${import.meta.env.BASE_URL}assets/midi/`;

// four-part chorales from the Bach-chorales corpus, rendered as organ
const CHORALES = [
  ["bach_bwv347.mid", "Bach · Chorale BWV 347 (Jesu, meine Freude)"],
  ["bach_bwv364.mid", "Bach · Chorale BWV 364 (Jesus Christus, unser Heiland)"],
  ["bach_bwv101_7.mid", "Bach · Chorale BWV 101/7 (Nimm von uns, Herr)"],
  ["bach_bwv66_6.mid", "Bach · Chorale BWV 66/6 (Christ ist erstanden)"]
];

export function registerBuiltins(library) {
  library.addAudio({
    name: "Late Night Loop (demo · 84 bpm)",
    source: "demo",
    builtin: true,
    meta: { bpm: 84, key: "C major", chords: ["Fmaj7", "Em7", "Dm7", "Cmaj7"] },
    loader: (audio) => renderDemoLoop(audio)
  });
  library.addAudio({
    name: "Off-key vocal (demo · A minor)",
    source: "demo-vocal",
    builtin: true,
    meta: { key: "A minor" },
    loader: (audio) => renderDemoVocal(audio)
  });
  // the classical shelf, in listing order (newest createdAt sorts first)
  let order = SCORES.length + CHORALES.length;
  for (const score of SCORES) {
    library.addAudio({
      name: `${score.composer} · ${score.title}`,
      source: "classical",
      builtin: true,
      meta: { bpm: score.bpm, key: score.key, composer: score.composer, score: score.id },
      loader: (audio) => renderScore(audio, score),
      createdAt: order--
    });
  }
  for (const [file, name] of CHORALES) {
    library.addAudio({
      name,
      source: "classical",
      builtin: true,
      meta: { composer: "Bach", file },
      loader: (audio) => renderMidiFile(audio, midiBase + file, { voice: "organ", bpm: 72 }),
      createdAt: order--
    });
  }
}
