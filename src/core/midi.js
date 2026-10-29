// MIDI parsing / writing.
// parseMidi() is a port of the dependency-free parser in
// MP1_G1_Sound_Engine/group1_render_cli.py (parse_track_chunk, build_note_events,
// normalize_tempo_map) plus ticks_to_seconds() from symbolic_events.py.
// writeMidi() produces the NES-MDB style layout: one track per voice with a
// track name, tempo and program change.

export const DEFAULT_TEMPO = 500000; // microseconds per quarter note (120 bpm)

function readVarLen(data, index) {
  let value = 0;
  for (;;) {
    const byte = data[index++];
    value = (value << 7) | (byte & 0x7f);
    if (byte < 0x80) return [value, index];
  }
}

function normalizeTempoMap(changes) {
  const def = { tick: 0, tempo: DEFAULT_TEMPO, bpm: 120 };
  if (!changes.length) return [def];
  const sorted = [...changes].sort((a, b) => a.tick - b.tick);
  const map = [];
  for (const c of sorted) {
    const cur = { tick: c.tick | 0, tempo: c.tempo | 0, bpm: 60000000 / c.tempo };
    if (map.length && map[map.length - 1].tick === cur.tick) map[map.length - 1] = cur;
    else map.push(cur);
  }
  if (map[0].tick !== 0) map.unshift(def);
  return map;
}

function parseTrackChunk(trackData, trackIndex) {
  let absTick = 0;
  let index = 0;
  let running = null;
  let order = 0;
  const tempos = [];
  const messages = [];
  const meta = { name: null, programs: {} };

  while (index < trackData.length) {
    let delta;
    [delta, index] = readVarLen(trackData, index);
    absTick += delta;
    if (index >= trackData.length) break;

    const statusByte = trackData[index];
    let firstData = null;
    let status;
    if (statusByte < 0x80) {
      if (running === null) break;
      status = running;
      firstData = statusByte;
      index += 1;
    } else {
      status = statusByte;
      index += 1;
      running = status < 0xf0 ? status : null;
    }

    if (status === 0xff) {
      if (index >= trackData.length) break;
      const metaType = trackData[index++];
      let len;
      [len, index] = readVarLen(trackData, index);
      const payload = trackData.subarray(index, index + len);
      index += len;
      if (metaType === 0x51 && len === 3) {
        tempos.push({ tick: absTick, tempo: (payload[0] << 16) | (payload[1] << 8) | payload[2] });
        order += 1;
      } else if (metaType === 0x03 && meta.name === null) {
        meta.name = new TextDecoder("latin1").decode(payload);
      }
      if (metaType === 0x2f) break;
      continue;
    }
    if (status === 0xf0 || status === 0xf7) {
      let len;
      [len, index] = readVarLen(trackData, index);
      index += len;
      continue;
    }

    const type = status & 0xf0;
    const channel = status & 0x0f;
    const dataLen = type === 0xc0 || type === 0xd0 ? 1 : 2;
    const bytes = [];
    if (firstData !== null) bytes.push(firstData);
    while (bytes.length < dataLen) bytes.push(trackData[index++]);

    if (type === 0x80 || type === 0x90) {
      messages.push({
        tick: absTick,
        track: trackIndex,
        channel,
        note: bytes[0],
        velocity: dataLen > 1 ? bytes[1] : 0,
        type: type === 0x90 ? "on" : "off",
        order: order++
      });
    } else if (type === 0xc0) {
      if (meta.programs[channel] === undefined) meta.programs[channel] = bytes[0];
    }
  }
  return { tempos, messages, meta };
}

function buildNoteEvents(messages) {
  const active = new Map();
  const events = [];
  let seq = 0;
  const ordered = [...messages].sort((a, b) => a.tick - b.tick || a.track - b.track || a.order - b.order);
  for (const m of ordered) {
    const key = `${m.track}:${m.channel}:${m.note}`;
    const isOff = m.type === "off" || (m.type === "on" && m.velocity === 0);
    if (!isOff) {
      if (!active.has(key)) active.set(key, []);
      active.get(key).push({ seq: seq++, pitch: m.note, velocity: m.velocity, ch: m.channel, track: m.track, startTick: m.tick });
      continue;
    }
    const queue = active.get(key);
    if (!queue || !queue.length) continue;
    const note = queue.shift();
    const durTicks = m.tick - note.startTick;
    if (durTicks <= 0) continue;
    note.durTicks = durTicks;
    events.push(note);
  }
  events.sort((a, b) => a.startTick - b.startTick || a.seq - b.seq);
  return events;
}

/** ticks_to_seconds() from symbolic_events.py */
export function ticksToSeconds(tick, ticksPerBeat, tempoMap) {
  let total = 0;
  let prev = 0;
  let tempo = tempoMap[0].tempo;
  for (let i = 1; i < tempoMap.length; i++) {
    const ch = tempoMap[i];
    if (tick <= ch.tick) break;
    total += ((ch.tick - prev) * tempo) / (ticksPerBeat * 1e6);
    prev = ch.tick;
    tempo = ch.tempo;
  }
  return total + ((tick - prev) * tempo) / (ticksPerBeat * 1e6);
}

/**
 * Parse a Standard MIDI File into a note sequence with times in seconds.
 * @param {ArrayBuffer|Uint8Array} input
 */
export function parseMidi(input, name = "untitled.mid") {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  const tag = String.fromCharCode(...data.subarray(0, 4));
  if (tag !== "MThd") throw new Error("Expected a MIDI file (missing MThd header)");
  const be32 = (o) => ((data[o] << 24) >>> 0) + (data[o + 1] << 16) + (data[o + 2] << 8) + data[o + 3];
  const be16 = (o) => (data[o] << 8) | data[o + 1];
  const headerLen = be32(4);
  const trackCount = be16(10);
  const division = be16(12);
  if (division & 0x8000) throw new Error("SMPTE time division is not supported");
  const ticksPerBeat = division;

  let index = 8 + headerLen;
  const tempos = [];
  const messages = [];
  const tracks = [];
  for (let t = 0; t < trackCount && index + 8 <= data.length; t++) {
    const len = be32(index + 4);
    const chunk = data.subarray(index + 8, index + 8 + len);
    if (String.fromCharCode(...data.subarray(index, index + 4)) === "MTrk") {
      const r = parseTrackChunk(chunk, t);
      tempos.push(...r.tempos);
      messages.push(...r.messages);
      tracks.push({ index: t, name: r.meta.name, programs: r.meta.programs });
    }
    index += 8 + len;
  }

  const tempoMap = normalizeTempoMap(tempos);
  const raw = buildNoteEvents(messages);
  const notes = raw.map((n) => {
    const start = ticksToSeconds(n.startTick, ticksPerBeat, tempoMap);
    const end = ticksToSeconds(n.startTick + n.durTicks, ticksPerBeat, tempoMap);
    return {
      pitch: n.pitch,
      start,
      dur: Math.max(1e-4, end - start),
      vel: n.velocity / 127,
      ch: n.ch,
      track: n.track,
      seq: n.seq,
      startTick: n.startTick,
      durTicks: n.durTicks
    };
  });
  notes.sort((a, b) => a.start - b.start || a.seq - b.seq);
  const duration = notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
  return {
    name,
    ticksPerBeat,
    tempoMap,
    bpm: tempoMap[0].bpm,
    tracks,
    notes,
    duration
  };
}

/** Channels used by a sequence, in ascending order. */
export function channelsOf(seq) {
  return [...new Set(seq.notes.map((n) => n.ch))].sort((a, b) => a - b);
}

/* ------------------------------------------------------------------ */
/* Writer                                                              */
/* ------------------------------------------------------------------ */

function varLen(value) {
  const bytes = [value & 0x7f];
  value >>= 7;
  while (value > 0) {
    bytes.unshift((value & 0x7f) | 0x80);
    value >>= 7;
  }
  return bytes;
}

/**
 * Write a format-1 MIDI file.
 * @param {{bpm?:number, tracks:{name?:string, channel:number, program?:number,
 *          notes:{pitch:number,start:number,dur:number,vel?:number}[]}[]}} song
 *   note times are in seconds and converted with the single tempo `bpm`.
 */
export function writeMidi(song, ticksPerBeat = 480) {
  const bpm = song.bpm || 120;
  const secToTick = (s) => Math.max(0, Math.round((s * bpm * ticksPerBeat) / 60));
  const chunks = [];
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, (song.tracks.length >> 8) & 0xff, song.tracks.length & 0xff, (ticksPerBeat >> 8) & 0xff, ticksPerBeat & 0xff];
  chunks.push(Uint8Array.from(header));

  song.tracks.forEach((track, ti) => {
    const events = [];
    const ch = track.channel & 0x0f;
    const nameBytes = [...new TextEncoder().encode(track.name || `track ${ti}`)];
    events.push({ tick: 0, prio: 0, bytes: [0xff, 0x03, ...varLen(nameBytes.length), ...nameBytes] });
    if (ti === 0) {
      const tempo = Math.round(60000000 / bpm);
      events.push({ tick: 0, prio: 1, bytes: [0xff, 0x51, 0x03, (tempo >> 16) & 0xff, (tempo >> 8) & 0xff, tempo & 0xff] });
    }
    if (track.program != null) events.push({ tick: 0, prio: 2, bytes: [0xc0 | ch, track.program & 0x7f] });
    for (const n of track.notes) {
      const on = secToTick(n.start);
      const off = Math.max(on + 1, secToTick(n.start + n.dur));
      const vel = Math.max(1, Math.min(127, Math.round((n.vel == null ? 0.79 : n.vel) * 127)));
      const p = n.pitch & 0x7f;
      events.push({ tick: on, prio: 4, bytes: [0x90 | ch, p, vel] });
      events.push({ tick: off, prio: 3, bytes: [0x80 | ch, p, 0] });
    }
    events.sort((a, b) => a.tick - b.tick || a.prio - b.prio);
    const body = [];
    let last = 0;
    for (const e of events) {
      body.push(...varLen(e.tick - last), ...e.bytes);
      last = e.tick;
    }
    body.push(0x00, 0xff, 0x2f, 0x00);
    const len = body.length;
    chunks.push(Uint8Array.from([0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff, ...body]));
  });

  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/** Convert a seconds-based sequence's notes into writeMidi() tracks grouped by channel. */
export function seqToSong(seq, names = {}, programs = {}) {
  const byCh = new Map();
  for (const n of seq.notes) {
    if (!byCh.has(n.ch)) byCh.set(n.ch, []);
    byCh.get(n.ch).push(n);
  }
  const tracks = [...byCh.keys()].sort((a, b) => a - b).map((ch) => ({
    name: names[ch] || `ch${ch}`,
    channel: ch,
    program: programs[ch],
    notes: byCh.get(ch)
  }));
  return { bpm: seq.bpm || 120, tracks };
}

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const noteName = (m) => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const ftom = (f) => 12 * Math.log2(f / 440) + 69;
