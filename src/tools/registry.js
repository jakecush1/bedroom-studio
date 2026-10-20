// Every machine's panel, loaded on first use. `origin` names the project code
// each tool was translated from.
export const TOOLS = {
  jc808: {
    title: "JC-808 Rhythm Composer",
    subtitle: "12 analogue-modelled voices · 16-step sequencer · synth & arpeggiator",
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
  radio: {
    title: "Room 808 FM",
    subtitle: "Search the Internet Archive · stream · send tracks to any machine",
    origin: "Fronend_Files/server/Index.js",
    width: "medium",
    layout: "side",
    load: null,
    wip: "The turntable digs through the Internet Archive for chiptunes (same search the ChipWorld web app's server did, now straight from the browser) and plays them through the room."
  },
  chipify: {
    title: "CHIPIFY",
    subtitle: "Song → beats + melody + chords + dynamics → 4-channel chiptune",
    origin: "ChipWorld project goal · G1 + G2 pipeline",
    width: "",
    load: null,
    wip: "Drop in any song: it tracks the beat, extracts the melody, detects chords and dynamics, then re-performs it on Pulse 1, Pulse 2, Triangle and Noise."
  },
  engine: {
    title: "CHIP-4 Sound Engine",
    subtitle: "MIDI → chip voices · envelopes · drum synthesis · WAV render",
    origin: "MP1_G1_Sound_Engine/group1_render_cli.py · sound_engine.py",
    width: "",
    load: () => import("./engine/index.js"),
    wip: "Loads MIDI carts and renders them with square / triangle / saw / noise voices, the six envelope presets and the drum synths from the sound engine."
  },
  crusher: {
    title: "8-BIT CRUSHER",
    subtitle: "Bit depth + sample-rate reduction · crush a tape or the whole room",
    origin: "MP1_G1_Sound_Engine/bitcrusher.py",
    width: "medium",
    layout: "side",
    load: () => import("./crusher/index.js"),
    wip: "A real-time AudioWorklet version of bitcrusher_effect()."
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
