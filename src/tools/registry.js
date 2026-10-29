// Every machine's panel, loaded on first use. `origin` names the project code
// each tool was translated from.
export const TOOLS = {
  jc808: {
    title: "JC-808 Rhythm Composer",
    subtitle: "12 analogue-modelled voices · 16-step sequencer · bass & lead synth lanes with a looping recorder",
    origin: "jc-808/app.js",
    width: "",
    load: () => import("./jc808/index.js")
  },
  tuner: {
    title: "Guitar Tuner",
    subtitle: "Mic pitch detection · standard, half-step down (E♭), drop D and more",
    origin: "new · built on the ME-1 pitch tracker",
    width: "narrow",
    layout: "side",
    load: () => import("./tuner/index.js")
  },
  master: {
    title: "MASTER-1 Mastering",
    subtitle: "Warm · Balanced · Open · loudness targets · reference matching · true-peak limiter",
    origin: "new · after LANDR, Matchering & ITU-R BS.1770",
    width: "",
    load: () => import("./master/index.js")
  },
  autotune: {
    title: "VOX-1 Autotune",
    subtitle: "Record or load a vocal · Subtle → Hard · detected or chosen key · formants kept",
    origin: "new · pYIN pitch tracking + TD-PSOLA",
    width: "",
    load: () => import("./autotune/index.js")
  },
  scribe: {
    title: "SCRIBE",
    subtitle: "Audio → sheet music · melody (pYIN) or polyphonic (Basic Pitch) · MusicXML / MIDI / ABC / PDF",
    origin: "Melody-extractor · midi.py · sheet_music.py · engraved with abcjs",
    width: "",
    load: () => import("./scribe/index.js")
  },
  arcade: {
    title: "ASTEROIDS",
    subtitle: "Upright arcade · rotate, thrust, fire, hyperspace · high score kept in this browser",
    origin: "new · after Atari's 1979 vector cabinet",
    width: "medium",
    load: () => import("./arcade/index.js")
  },
  radio: {
    title: "Room 808 FM",
    subtitle: "Local & national stations · streams into the room · add your own",
    origin: "new · stations in src/tools/radio/stations.js",
    width: "medium",
    layout: "side",
    load: () => import("./radio/index.js")
  },
  chipify: {
    title: "CHIPIFY",
    subtitle: "Any song → NES / Game Boy / SEGA / C64 chiptune · beat, melody, bass, chords, drums",
    origin: "ChipWorld chipify · Melody-extractor · demucs_extract.py · Basic Pitch",
    width: "",
    load: () => import("./chipify/index.js")
  }
};
