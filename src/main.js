import "./styles/base.css";
import { StudioAudio } from "./core/audio.js";
import { Library } from "./core/library.js";
import { Ambience } from "./core/ambience.js";
import { World } from "./scene/world.js";
import { Shell } from "./ui/shell.js";
import { registerBuiltins } from "./core/builtins.js";

const audio = new StudioAudio();
const studio = {
  audio,
  state: {}, // live state each machine publishes for its 3D model
  panelOpen: false
};
studio.library = new Library(audio);
studio.ambience = new Ambience(audio);
registerBuiltins(studio.library);

document.body.classList.add("entering");

async function boot() {
  const stage = document.getElementById("stage");
  let world;
  try {
    world = new World(stage, studio);
  } catch (err) {
    console.error(err);
    document.getElementById("gate-enter").textContent = "WebGL is unavailable in this browser";
    return;
  }
  studio.world = world;
  if (import.meta.env.DEV) window.__studio = studio;
  const shell = new Shell(studio, world);
  shell.gateProgress(0.5);

  // compile every shader, upload every texture and draw the first frames
  // behind the gate, so nothing stalls once the door opens
  if (new URLSearchParams(location.search).get("warm") === "0") world.warmFrameMs = 0;   // ?warm=0: skip, to compare
  else await world.warmUp((p) => shell.gateProgress(0.5 + p * 0.5));
  if (import.meta.env.DEV) console.info("[room] warm-up", { frameMs: +world.warmFrameMs.toFixed(1), quality: world.quality, merged: world.mergeStats });

  const deepLink = location.hash.replace(/^#/, "");
  const sound = await shell.gateReady();
  if (sound) {
    await audio.start();
    studio.ambience.start();
  }
  shell.hideGate();
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  await world.enter(reduce || !!deepLink);
  document.body.classList.remove("entering");
  if (deepLink.startsWith("jc808=") || deepLink.startsWith("p=")) shell.open("jc808");
  else if (world.byId.has(deepLink)) shell.open(deepLink);
}

boot();
