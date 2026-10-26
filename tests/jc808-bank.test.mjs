// JC-808 pattern banks: the per-step Echo / Reverb lanes and the compact
// save format they travel in.
import test from "node:test";
import assert from "node:assert/strict";
import { STEPS, emptyBank, packBank, normaliseBank, unpackLane, packLane } from "../src/tools/jc808/bank.js";

const IDS = ["BD", "SD", "CH"];

test("a new bank is dry: no echo or reverb on any step", () => {
  const b = emptyBank(IDS);
  for (const id of IDS) {
    assert.equal(b.steps[id].length, STEPS);
    assert.ok(b.echo[id].every((x) => x === false));
    assert.ok(b.verb[id].every((x) => x === false));
  }
  assert.equal(b.length, 16);
});

test("lanes pack to x... strings and unpack from strings or arrays", () => {
  assert.equal(packLane(unpackLane("x...x...x...x...")), "x...x...x...x...");
  assert.deepEqual(unpackLane([1, 0, true, false]).slice(0, 5), [true, false, true, false, false]);
  assert.equal(unpackLane("xx").length, STEPS);
  assert.equal(unpackLane(undefined).filter(Boolean).length, 0);
});

test("packBank only writes the effect lanes that are used, and a round trip keeps them", () => {
  const b = emptyBank(IDS);
  b.steps.SD[4] = b.steps.SD[12] = true;
  b.verb.SD[4] = true;
  b.steps.CH[2] = true;
  b.echo.CH[2] = true;
  b.length = 12;
  const packed = packBank(b, IDS);
  assert.deepEqual(Object.keys(packed.echo), ["CH"]);
  assert.deepEqual(Object.keys(packed.verb), ["SD"]);
  assert.equal(packed.verb.SD, "....x...........");
  assert.equal(packed.length, 12);
  const back = normaliseBank(JSON.parse(JSON.stringify(packed)), IDS);
  assert.deepEqual(back, b);
});

test("normaliseBank reads saves from before the effect lanes existed", () => {
  const old = { steps: { BD: unpackLane("x...x...x...x..."), SD: unpackLane("....x.......x...") }, accent: unpackLane("x..............."), length: 16 };
  const b = normaliseBank(old, IDS);
  assert.equal(b.steps.BD[0], true);
  assert.equal(b.steps.CH.filter(Boolean).length, 0);
  assert.ok(b.echo.BD.every((x) => x === false));
  assert.ok(b.verb.SD.every((x) => x === false));
  assert.deepEqual(normaliseBank(null, IDS), emptyBank(IDS));
  assert.deepEqual(normaliseBank("junk", IDS), emptyBank(IDS));
});

test("an effect flag on a step with no hit is dropped, and lengths are clamped", () => {
  const b = normaliseBank({ steps: { BD: "x..............." }, echo: { BD: "xx.............." }, length: 99 }, IDS);
  assert.deepEqual(b.echo.BD.slice(0, 3), [true, false, false]);
  assert.equal(b.length, 16);
  assert.equal(normaliseBank({ length: 0.4 }, IDS).length, 16);
  assert.equal(normaliseBank({ length: 8 }, IDS).length, 8);
});
