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
  },
  engine: {
    title: "CHIP-4 Sound Engine",
    subtitle: "MIDI → chip voices · envelopes · drum synthesis · WAV render",
    origin: "MP1_G1_Sound_Engine/group1_render_cli.py · sound_engine.py",
    width: "",
    load: () => import("./engine/index.js"),
    wip: "Loads MIDI carts and renders them with square / triangle / saw / noise voices, the six envelope presets and the drum synths from the sound engine."
  },
  scribe: {
    title: "SCRIBE",
    subtitle: "Audio → sheet music · melody (pYIN) or polyphonic (Basic Pitch) · MusicXML / MIDI / PDF",
    origin: "Melody-extractor · midi.py · sheet_music.py",
    width: "",
    load: null,
    wip: "Hum, sing, play or drop a song: the pitch tracker finds the notes, snaps them to the beat and engraves the score."
  },
  analyzer: {
    title: "Song Analyzer",
    subtitle: "Tempo · beat grid · key · chord progression",
    origin: "MP1_G2_Audio_analyzer · beats + Chord_Detection",
    width: "",
    load: null,
    wip: "BPM, key and chords of any song — the beat trackers and chord detector from the analyser group, merged."
  }
};
