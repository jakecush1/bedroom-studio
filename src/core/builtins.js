// Built-in carts and tapes that ship with the room.
// MIDI: outputs of the G6 LSTM models plus public-domain Bach chorales and
// their chipified versions. Audio: a procedurally rendered lofi demo loop.
import { renderDemoLoop } from "./demo.js";

const base = `${import.meta.env.BASE_URL}assets/midi/`;

const CARTS = [
  ...[0, 1, 2, 3].map((i) => [`single_voice_chiptune${i}.mid`, `G6 · 1-voice LSTM #${i}`]),
  ...Array.from({ length: 18 }, (_, i) => [`four_voice_chiptune${i}.mid`, `G6 · 4-voice LSTM #${i}`]),
  ...Array.from({ length: 10 }, (_, i) => [`novel_big_multi_chiptune${i}.mid`, `G6 · 4-voice (more training) #${i}`]),
  ["novel_single_chiptune.mid", "G6 · novel single chiptune"],
  ["novel_single_chiptune0.mid", "G6 · novel single chiptune 0"],
  ["novel_single_chiptune1.mid", "G6 · novel single chiptune 1"],
  ...["bwv101_7", "bwv347", "bwv364", "bwv66_6"].flatMap((b) => [
    [`bach_${b}.mid`, `Bach ${b.replace("_", ".").toUpperCase()} (chorale)`],
    [`bach_${b}_chipified.mid`, `Bach ${b.replace("_", ".").toUpperCase()} · chipified`]
  ])
];

export function registerBuiltins(library) {
  library.addAudio({
    name: "Late Night Loop (demo · 84 bpm)",
    source: "demo",
    builtin: true,
    meta: { bpm: 84, key: "C major", chords: ["Fmaj7", "Em7", "Dm7", "Cmaj7"] },
    loader: (audio) => renderDemoLoop(audio)
  });
  // oldest first so the newest generations sit on top of the list
  CARTS.forEach(([file, name], i) => {
    library.addMidi({ name, url: base + file, source: "built-in", builtin: true, meta: { file }, createdAt: i });
  });
}
