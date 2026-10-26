// A JC-808 pattern bank: sixteen steps per voice, plus the accent lane and
// the per-step Echo / Reverb flags. Pure data helpers shared by the app and
// the tests — the persistence format packs the effect lanes as "x..x"
// strings and only when they are used, so saves and share links stay short.

export const STEPS = 16;

/** "x..x" (or any array) → 16 booleans. Anything but "." or " " is a hit. */
export function unpackLane(v) {
  const out = new Array(STEPS).fill(false);
  if (typeof v === "string") {
    for (let i = 0; i < STEPS && i < v.length; i++) out[i] = v[i] !== "." && v[i] !== " ";
  } else if (Array.isArray(v)) {
    for (let i = 0; i < STEPS && i < v.length; i++) out[i] = !!v[i];
  }
  return out;
}

export const packLane = (row) => row.map((x) => (x ? "x" : ".")).join("");

export function emptyBank(ids) {
  const steps = {}, echo = {}, verb = {};
  for (const id of ids) {
    steps[id] = new Array(STEPS).fill(false);
    echo[id] = new Array(STEPS).fill(false);
    verb[id] = new Array(STEPS).fill(false);
  }
  return { steps, echo, verb, accent: new Array(STEPS).fill(false), length: STEPS };
}

/** The storable form: full step rows, effect lanes only where something is painted. */
export function packBank(b, ids) {
  const out = { steps: {}, accent: b.accent.slice(0, STEPS), length: b.length, echo: {}, verb: {} };
  for (const id of ids) out.steps[id] = (b.steps[id] || []).slice(0, STEPS);
  for (const k of ["echo", "verb"]) {
    for (const id of ids) {
      const row = b[k] && b[k][id];
      if (row && row.some(Boolean)) out[k][id] = packLane(row);
    }
  }
  return out;
}

/** Rebuild a bank from saved / shared data (any version), dropping anything malformed. */
export function normaliseBank(data, ids) {
  const nb = emptyBank(ids);
  if (!data || typeof data !== "object") return nb;
  if (data.steps) for (const id of ids) if (data.steps[id] != null) nb.steps[id] = unpackLane(data.steps[id]);
  if (data.accent != null) nb.accent = unpackLane(data.accent);
  const len = Number(data.length);
  if (len >= 1 && len <= STEPS) nb.length = Math.round(len);
  for (const k of ["echo", "verb"]) {
    if (!data[k]) continue;
    for (const id of ids) {
      if (data[k][id] == null) continue;
      // an effect only means something on a hit
      nb[k][id] = unpackLane(data[k][id]).map((on, i) => on && nb.steps[id][i]);
    }
  }
  return nb;
}
