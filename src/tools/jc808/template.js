// Markup from jc-808/index.html (ids prefixed with "jc-"); the power-on gate
// is gone because opening the studio door already unlocks audio.
export const TEMPLATE = `
<div class="app">
  <header class="masthead">
    <div class="brand">
      <h1>JC&#8209;808</h1>
      <span class="model">Rhythm Composer</span>
      <span class="sub">Twelve analogue-modelled voices, sequencer, two-lane synth recorder — built from scratch with the Web Audio API.</span>
    </div>
    <nav>
      <a href="#" data-jump="help">Shortcuts</a>
      <a href="https://www.jakecushway.ca/media/" target="_blank" rel="noopener">Media</a>
      <a href="https://www.jakecushway.ca/" target="_blank" rel="noopener">Portfolio</a>
    </nav>
  </header>

  <section class="panel">
    <div class="transport">
      <div class="transport-group">
        <button class="play-btn" id="jc-playBtn" type="button" aria-label="Play">
          <svg viewBox="0 0 24 24"><path id="jc-playIcon" d="M6 4l14 8-14 8z"></path></svg>
        </button>
        <div class="readout">
          <span class="value" id="jc-bpmReadout">120</span>
          <span class="label">Tempo</span>
        </div>
        <div id="jc-tempoSlot"></div>
        <button class="btn" id="jc-tapBtn" type="button">Tap</button>
      </div>
      <div class="transport-group">
        <div id="jc-swingSlot"></div>
        <div id="jc-accentSlot"></div>
        <div id="jc-driveSlot"></div>
        <div id="jc-volSlot"></div>
      </div>
      <div class="transport-group">
        <div class="field">
          <span>Bank</span>
          <div class="banks" id="jc-banks"></div>
        </div>
        <button class="btn" id="jc-chainBtn" type="button">Chain</button>
        <label class="field">
          <span>Steps</span>
          <select class="select" id="jc-lengthSel"></select>
        </label>
      </div>
      <div class="transport-group">
        <label class="field">
          <span>Preset</span>
          <select class="select" id="jc-presetSel">
            <option value="">Load…</option>
          </select>
        </label>
        <button class="btn" id="jc-randomBtn" type="button">Random</button>
        <button class="btn danger" id="jc-clearBtn" type="button">Clear</button>
        <button class="btn" id="jc-undoBtn" type="button">Undo</button>
      </div>
      <div class="transport-group">
        <button class="btn" id="jc-shareBtn" type="button">Share</button>
        <button class="btn" id="jc-exportBtn" type="button">Export WAV</button>
        <button class="btn" id="jc-tapeBtn" type="button" title="Render two passes into the studio tape library">To tape</button>
      </div>
    </div>
  </section>

  <section class="panel">
    <div class="panel-head rhythm-head">
      <h2 class="panel-title">Rhythm Section</h2>
      <div class="rhythm-tools">
        <div class="field">
          <span>Click paints</span>
          <div class="seg" id="jc-editSeg" title="What a click on a step does"></div>
        </div>
        <div class="fx-sends" title="How much a painted step sends to the echo and the reverb">
          <div id="jc-echoSlot"></div>
          <div id="jc-verbSlot"></div>
        </div>
        <span class="panel-title hint-text">
          Steps marked <i class="fx-key fx-key-e"></i> echo · <i class="fx-key fx-key-r"></i> reverb · shift-click / alt-click paints from any mode · <kbd>▾</kbd> opens level / tune / decay
        </span>
      </div>
    </div>
    <div class="machine-scroll">
      <div class="machine" id="jc-machine"></div>
    </div>
  </section>

  <section class="panel">
    <div class="panel-head">
      <h2 class="panel-title">Synth Lanes</h2>
      <div class="track-tools">
        <button class="btn rec-btn" id="jc-recBtn" type="button" aria-pressed="false" title="Record the keys onto the selected lane (R)"><span class="rec-dot"></span>Rec</button>
        <span class="readout track-readout" title="Bar and beat of the selected lane">
          <span class="value" id="jc-trackPos">1.1</span>
          <span class="label">Bar · Beat</span>
        </span>
        <span class="panel-title" style="letter-spacing:.1em;text-transform:none;">
          Rec writes to the selected lane · <kbd>Q</kbd> switches lanes · each lane loops on its own length · click a note to remove it
        </span>
      </div>
    </div>
    <div class="lanes" id="jc-lanes"></div>
  </section>

  <section class="panel">
    <div class="panel-head">
      <h2 class="panel-title">Synthesiser · <span id="jc-synthLane">Lead</span></h2>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <div class="seg" id="jc-laneSeg" title="Which lane the synth panel and the keys play"></div>
        <label class="field">
          <span>Patch</span>
          <select class="select" id="jc-patchSel" title="Load a preset sound onto the selected lane">
            <option value="">Load…</option>
          </select>
        </label>
        <button class="btn" id="jc-monoBtn" type="button">Poly</button>
        <button class="btn" id="jc-octDown" type="button">Oct &minus;</button>
        <span class="readout" style="min-width:64px;padding:5px 10px;">
          <span class="value" id="jc-octReadout" style="font-size:15px;">+0</span>
          <span class="label">Oct</span>
        </span>
        <button class="btn" id="jc-octUp" type="button">Oct +</button>
        <button class="btn" id="jc-panicBtn" type="button">Panic</button>
      </div>
    </div>
    <div class="keyboard-wrap">
      <div class="keyboard" id="jc-keyboard"></div>
    </div>
    <div class="synth-grid">
      <div class="module">
        <h3>Oscillator</h3>
        <div class="module-row"><div class="seg" id="jc-waveSeg"></div></div>
        <div class="module-row" id="jc-oscSlots" style="margin-top:12px;"></div>
      </div>
      <div class="module">
        <h3>Filter</h3>
        <div class="module-row" id="jc-filterSlots"></div>
      </div>
      <div class="module">
        <h3>Envelope</h3>
        <div class="module-row" id="jc-envSlots"></div>
      </div>
      <div class="module">
        <h3>Arpeggiator</h3>
        <div class="module-row">
          <button class="btn" id="jc-arpBtn" type="button">Arp</button>
          <button class="btn" id="jc-latchBtn" type="button">Latch</button>
          <label class="field">
            <span>Rate</span>
            <select class="select" id="jc-arpRate"></select>
          </label>
        </div>
        <div class="module-row" style="margin-top:10px;"><div class="seg" id="jc-arpModeSeg"></div></div>
        <div class="module-row" id="jc-arpSlots" style="margin-top:12px;"></div>
      </div>
      <div class="module">
        <h3>Mix &amp; Effects</h3>
        <div class="module-row" id="jc-mixSlots"></div>
      </div>
      <div class="module">
        <h3>Output</h3>
        <canvas class="scope" id="jc-scope"></canvas>
      </div>
    </div>
  </section>

  <section class="panel" id="jc-help">
    <div class="panel-head"><h2 class="panel-title">Controls</h2></div>
    <div class="help-grid">
      <div>
        <h4>Transport</h4>
        <dl>
          <dt><kbd>Space</kbd></dt><dd>Play / stop</dd>
          <dt><kbd>Esc</kbd></dt><dd>Back to the room (the beat keeps playing)</dd>
          <dt>Shift + bank</dt><dd>Copy current bank</dd>
        </dl>
      </div>
      <div>
        <h4>Drum pads</h4>
        <dl>
          <dt><kbd>1</kbd>…<kbd>=</kbd></dt><dd>Trigger the twelve voices in order (BD → MA)</dd>
          <dt>Click a name</dt><dd>Audition that voice</dd>
        </dl>
      </div>
      <div>
        <h4>Keyboard</h4>
        <dl>
          <dt><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>…</dt><dd>White keys, C upwards</dd>
          <dt><kbd>W</kbd><kbd>E</kbd><kbd>T</kbd>…</dt><dd>Black keys</dd>
          <dt><kbd>Z</kbd> / <kbd>X</kbd></dt><dd>Octave down / up</dd>
        </dl>
      </div>
      <div>
        <h4>Synth lanes</h4>
        <dl>
          <dt><kbd>R</kbd></dt><dd>Record on / off — onto the selected lane</dd>
          <dt><kbd>Q</kbd></dt><dd>Switch between the Bass and Lead lanes</dd>
          <dt>Rec while stopped</dt><dd>One-bar count-in, then the take starts at bar 1</dd>
          <dt>Rec while playing</dt><dd>Punches in — every pass overdubs onto the loop</dd>
          <dt>Click a note</dt><dd>Removes it (Undo brings it back)</dd>
        </dl>
      </div>
      <div>
        <h4>Faders</h4>
        <dl>
          <dt>Click / drag</dt><dd>Low at the bottom, high at the top — moves only while the button is held</dd>
          <dt>Shift + drag</dt><dd>Fine</dd>
          <dt>Wheel</dt><dd>Nudge</dd>
          <dt>Double-click</dt><dd>Reset to default</dd>
          <dt>Arrow keys</dt><dd>Adjust when focused</dd>
        </dl>
      </div>
      <div>
        <h4>Notes</h4>
        <dl>
          <dt>Accent</dt><dd>The bottom lane lifts every hit on that step</dd>
          <dt>Echo / Reverb</dt><dd>Off by default. Set “Click paints” to Echo or Reverb and click a step to send that hit to the effect (shift-click / alt-click does the same from any mode); the Echo and Reverb faders set how much. Each voice and step is separate, so a reverb on the snare leaves the kick dry</dd>
          <dt>Arp</dt><dd>Runs off the sequencer clock — press play, then hold keys</dd>
          <dt>Latch</dt><dd>Each key toggles in and out of the chord; Panic clears it</dd>
          <dt>Patch</dt><dd>Loads a preset sound (basses, leads, pads, bell, organ, arps) onto the selected lane; the faders then show what it set, so tweak from there. “Lane default” restores the lane's starting sound</dd>
          <dt>Lanes</dt><dd>Bass and Lead each have their own patch, loop length and quantize; a bar is 16 steps, so a 2-bar bass can loop under a 16-bar lead</dd>
          <dt>Arp + Rec</dt><dd>The arpeggio is written to the lane as notes, so the take plays back on its own</dd>
          <dt>Export</dt><dd>Renders the pattern (or the chain) with both lanes to WAV — two drum passes, or the longest lane</dd>
        </dl>
      </div>
    </div>
  </section>

  <footer>
    Built with the Web Audio API — no samples, no libraries. Patterns save to this browser and to the share link.
  </footer>
</div>`;
