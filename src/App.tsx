import { useState, useRef, useCallback, useEffect } from "react";

const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

type NoteInfo = {
  r: number;
  g: number;
  b: number;
  h: number;
  s: number;
  l: number;
  note: string;
  octave: number;
  octaveF: number;
  freq: number;
  noteIdx: number;
};

type SynthNodes = {
  osc: OscillatorNode;
  gain: GainNode;
  filter: BiquadFilterNode;
};

type ThrottleRef = {
  current?: number;
  _freq?: number;
};

type OrganNodes = {
  ctx: AudioContext;
  oscs: Array<{ osc: OscillatorNode; gain: GainNode; mult: number }>;
  master: GainNode;
  lp: BiquadFilterNode;
};

const RELEASE_SEC = 0.05;

type GatedVoice = {
  gain: GainNode;
  fb?: GainNode;
  nodes: AudioNode[];
  released: boolean;
};

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h = 0,
    s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }
  return [h * 360, s * 100, l * 100];
}

function lightnessToOctave(l: number) {
  return 1 + Math.pow(l / 100, 0.75) * 5;
}

function hslToNote(h: number, l: number) {
  const noteIdx = Math.floor((h / 360) * 12) % 12;
  const octaveF = lightnessToOctave(l);
  const octave = Math.round(octaveF);
  const midiF = (octaveF + 1) * 12 + noteIdx;
  return {
    note: NOTES[noteIdx],
    octave,
    octaveF,
    freq: 440 * Math.pow(2, (midiF - 69) / 12),
    noteIdx,
  };
}

function lightnessToCutoff(l: number) {
  return 200 + Math.pow(l / 100, 1.4) * 8800;
}

const compressors = new WeakMap<AudioContext, DynamicsCompressorNode>();

function getCompressor(ctx: AudioContext) {
  const existing = compressors.get(ctx);
  if (existing) return existing;
  const c = ctx.createDynamicsCompressor();
  c.threshold.value = -18;
  c.knee.value = 12;
  c.ratio.value = 4;
  c.attack.value = 0.01;
  c.release.value = 0.2;
  c.connect(ctx.destination);
  compressors.set(ctx, c);
  return c;
}

function fadeGain(gain: AudioParam, now: number, seconds = RELEASE_SEC) {
  gain.cancelScheduledValues(now);
  const current = Math.max(gain.value, 0.0001);
  gain.setValueAtTime(current, now);
  gain.exponentialRampToValueAtTime(0.0001, now + seconds);
}

function playSynth(
  ctx: AudioContext,
  freq: number,
  s: number,
  l: number,
  nodes: SynthNodes,
) {
  const now = ctx.currentTime;
  nodes.osc.frequency.setTargetAtTime(freq, now, 0.03);
  nodes.gain.gain.cancelScheduledValues(now);
  nodes.gain.gain.setTargetAtTime(0.08 + (s / 100) * 0.28, now, 0.02);
  nodes.filter.frequency.setTargetAtTime(lightnessToCutoff(l), now, 0.04);
}

function playPiano(
  ctx: AudioContext,
  freq: number,
  s: number,
  l: number,
  lnt: ThrottleRef,
) {
  const now = ctx.currentTime;
  if (lnt.current && now - lnt.current < 0.06) return;
  lnt.current = now;
  const comp = getCompressor(ctx);
  const vel = 0.1 + (s / 100) * 0.18;
  const dur = 0.5 + Math.pow(l / 100, 0.5) * 2.2;
  const partials = [
    { r: 1, a: 1.0, d: dur },
    { r: 2, a: 0.38, d: dur * 0.65 },
    { r: 3, a: 0.15, d: dur * 0.4 },
    { r: 4, a: 0.07, d: dur * 0.25 },
    { r: 4.98, a: 0.03, d: dur * 0.18 },
  ];
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = Math.min(800 + freq * 2, 3200);
  lp.Q.value = 0.3;
  const out = ctx.createGain();
  out.gain.value = 1;
  lp.connect(out);
  out.connect(comp);
  partials.forEach(({ r, a, d }) => {
    const o = ctx.createOscillator(),
      g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = freq * r;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(vel * a, now + 0.004);
    g.gain.exponentialRampToValueAtTime(vel * a * 0.3, now + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, now + d);
    o.connect(g);
    g.connect(lp);
    o.start(now);
    o.stop(now + d + 0.05);
  });
  const blen = Math.floor(ctx.sampleRate * 0.008);
  const buf = ctx.createBuffer(1, blen, ctx.sampleRate);
  const dd = buf.getChannelData(0);
  for (let i = 0; i < blen; i++)
    dd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / blen, 4);
  const ns = ctx.createBufferSource();
  ns.buffer = buf;
  const ng = ctx.createGain();
  ng.gain.value = vel * 0.025;
  const nlp = ctx.createBiquadFilter();
  nlp.type = "lowpass";
  nlp.frequency.value = 600;
  ns.connect(nlp);
  nlp.connect(ng);
  ng.connect(comp);
  ns.start(now);
}

function makeDriveCurve(amount: number) {
  const n = 256;
  const curve = new Float32Array(n);
  const k = Math.max(0.2, amount);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

function exciteDelay(
  ctx: AudioContext,
  delay: DelayNode,
  freq: number,
  amp: number,
) {
  const period = Math.max(8, Math.floor(ctx.sampleRate / Math.max(freq, 40)));
  const buf = ctx.createBuffer(1, period, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < period; i++) {
    const window = Math.pow(1 - i / period, 0.35);
    data[i] = (Math.random() * 2 - 1) * amp * window;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(delay);
  src.start();
  return src;
}

const gatedVoices: GatedVoice[] = [];

function registerVoice(voice: GatedVoice) {
  gatedVoices.push(voice);
}

function disconnectNodes(nodes: AudioNode[]) {
  for (const node of nodes) {
    try {
      node.disconnect();
    } catch {
      /* already disconnected */
    }
  }
}

function releaseVoice(voice: GatedVoice, ctx: AudioContext) {
  if (voice.released) return;
  voice.released = true;
  const now = ctx.currentTime;
  if (voice.fb) fadeGain(voice.fb.gain, now, 0.02);
  fadeGain(voice.gain.gain, now);
  window.setTimeout(
    () => disconnectNodes(voice.nodes),
    Math.round((RELEASE_SEC + 0.04) * 1000),
  );
}

function releaseGatedVoices(ctx: AudioContext) {
  const voices = gatedVoices.splice(0);
  for (const voice of voices) releaseVoice(voice, ctx);
}

function playBass(
  ctx: AudioContext,
  freq: number,
  s: number,
  l: number,
  lnt: ThrottleRef,
) {
  const now = ctx.currentTime;
  if (lnt.current && now - lnt.current < 0.09) return;
  lnt.current = now;
  const bassFreq = Math.max(freq / 2, 32);
  const delay = ctx.createDelay(0.08);
  delay.delayTime.value = 1 / bassFreq;
  const loopFilter = ctx.createBiquadFilter();
  loopFilter.type = "lowpass";
  loopFilter.frequency.value = Math.min(700 + (l / 100) * 900, 1600);
  loopFilter.Q.value = 0.35;
  const fb = ctx.createGain();
  fb.gain.value = 0.9;
  const body = ctx.createBiquadFilter();
  body.type = "peaking";
  body.frequency.value = 110;
  body.gain.value = 3.5;
  body.Q.value = 0.9;
  const lowMid = ctx.createBiquadFilter();
  lowMid.type = "peaking";
  lowMid.frequency.value = 420;
  lowMid.gain.value = 3.2;
  lowMid.Q.value = 0.85;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 38;
  const shelf = ctx.createBiquadFilter();
  shelf.type = "highshelf";
  shelf.frequency.value = 1400;
  shelf.gain.value = -8;
  const out = ctx.createGain();
  const vol = 0.26 + (s / 100) * 0.12;
  const dur = 0.55 + (l / 100) * 0.25;
  out.gain.setValueAtTime(0.0001, now);
  out.gain.linearRampToValueAtTime(vol, now + 0.012);
  out.gain.setTargetAtTime(vol * 0.45, now + 0.05, 0.08);
  out.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  fb.gain.setTargetAtTime(0.62, now + 0.18, 0.12);
  delay.connect(loopFilter);
  loopFilter.connect(fb);
  fb.connect(delay);
  delay.connect(hp);
  hp.connect(body);
  body.connect(lowMid);
  lowMid.connect(shelf);
  shelf.connect(out);
  out.connect(getCompressor(ctx));
  exciteDelay(ctx, delay, bassFreq, 0.9);
  registerVoice({
    gain: out,
    fb,
    released: false,
    nodes: [delay, loopFilter, fb, body, lowMid, hp, shelf, out],
  });
}

let organNodes: OrganNodes | null = null;

function getOrganNodes(ctx: AudioContext) {
  if (organNodes && organNodes.ctx === ctx) return organNodes;
  const comp = getCompressor(ctx);
  const drawbars = [0.5, 1, 2, 3, 4];
  const vols = [0.1, 0.45, 0.22, 0.12, 0.06];
  const oscs = drawbars.map((mult, i) => {
    const o = ctx.createOscillator(),
      g = ctx.createGain();
    o.type = "sine";
    g.gain.value = vols[i];
    o.connect(g);
    o.start();
    return { osc: o, gain: g, mult };
  });
  const mix = ctx.createGain();
  mix.gain.value = 1;
  oscs.forEach(({ gain: g }) => g.connect(mix));
  const ws = ctx.createWaveShaper();
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = (i * 2) / 256 - 1;
    curve[i] = x / (1 + 2 * Math.abs(x));
  }
  ws.curve = curve;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 1800;
  lp.Q.value = 0.5;
  const lfo = ctx.createOscillator(),
    lfoG = ctx.createGain(),
    trem = ctx.createGain();
  lfo.type = "sine";
  lfo.frequency.value = 5.5;
  lfoG.gain.value = 0.06;
  trem.gain.value = 0.94;
  lfo.connect(lfoG);
  lfoG.connect(trem.gain);
  lfo.start();
  const master = ctx.createGain();
  master.gain.value = 0;
  mix.connect(ws);
  ws.connect(lp);
  lp.connect(trem);
  trem.connect(master);
  master.connect(comp);
  organNodes = { ctx, oscs, master, lp };
  return organNodes;
}

function playOrgan(
  ctx: AudioContext,
  freq: number,
  s: number,
  l: number,
  lnt: ThrottleRef,
) {
  const now = ctx.currentTime;
  if (lnt.current && now - lnt.current < 0.07) return;
  lnt.current = now;
  const n = getOrganNodes(ctx);
  n.oscs.forEach(({ osc, mult }) =>
    osc.frequency.setTargetAtTime(freq * mult, now, 0.02),
  );
  n.lp.frequency.setTargetAtTime(lightnessToCutoff(l) * 0.7, now, 0.05);
  const vol = 0.12 + (s / 100) * 0.14;
  n.master.gain.setValueAtTime(vol * 1.3, now);
  n.master.gain.setTargetAtTime(vol, now, 0.03);
}

function stopOrgan(ctx: AudioContext) {
  if (!organNodes || organNodes.ctx !== ctx) return;
  fadeGain(organNodes.master.gain, ctx.currentTime);
}

function playAcousticGuitar(
  ctx: AudioContext,
  freq: number,
  s: number,
  l: number,
  lnt: ThrottleRef,
) {
  const now = ctx.currentTime;
  if (lnt.current && now - lnt.current < 0.075) return;
  lnt.current = now;
  const delayTime = 1 / Math.max(freq, 50);
  const delay = ctx.createDelay(0.06);
  delay.delayTime.value = delayTime;
  const loopFilter = ctx.createBiquadFilter();
  loopFilter.type = "lowpass";
  loopFilter.frequency.value = Math.min(1400 + freq * 1.8, 3800);
  loopFilter.Q.value = 0.25;
  const fb = ctx.createGain();
  fb.gain.value = 0.86;
  const body = ctx.createBiquadFilter();
  body.type = "peaking";
  body.frequency.value = 165;
  body.gain.value = 5;
  body.Q.value = 1.3;
  const wood = ctx.createBiquadFilter();
  wood.type = "peaking";
  wood.frequency.value = 430;
  wood.gain.value = 3.2;
  wood.Q.value = 1.05;
  const air = ctx.createBiquadFilter();
  air.type = "highshelf";
  air.frequency.value = 3200;
  air.gain.value = -5.5;
  const out = ctx.createGain();
  const vol = 0.28 + (s / 100) * 0.16;
  const dur = 0.42 + (l / 100) * 0.22;
  out.gain.setValueAtTime(vol, now);
  out.gain.setTargetAtTime(vol * 0.35, now + 0.04, 0.05);
  out.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  fb.gain.setTargetAtTime(0.55, now + 0.12, 0.1);
  delay.connect(loopFilter);
  loopFilter.connect(fb);
  fb.connect(delay);
  delay.connect(body);
  body.connect(wood);
  wood.connect(air);
  air.connect(out);
  out.connect(getCompressor(ctx));
  exciteDelay(ctx, delay, freq, 0.95);
  const pickLen = Math.floor(ctx.sampleRate * 0.004);
  const pickBuf = ctx.createBuffer(1, pickLen, ctx.sampleRate);
  const pd = pickBuf.getChannelData(0);
  for (let i = 0; i < pickLen; i++)
    pd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / pickLen, 5);
  const pick = ctx.createBufferSource();
  pick.buffer = pickBuf;
  const pickG = ctx.createGain();
  pickG.gain.value = vol * 0.35;
  const pickBp = ctx.createBiquadFilter();
  pickBp.type = "bandpass";
  pickBp.frequency.value = Math.min(freq * 4, 2400);
  pickBp.Q.value = 0.7;
  pick.connect(pickBp);
  pickBp.connect(pickG);
  pickG.connect(getCompressor(ctx));
  pick.start(now);
}

function playElectricGuitar(
  ctx: AudioContext,
  freq: number,
  s: number,
  l: number,
  lnt: ThrottleRef,
) {
  const now = ctx.currentTime;
  if (lnt.current && now - lnt.current < 0.065) return;
  lnt.current = now;
  const f = Math.max(freq, 70);
  const delay = ctx.createDelay(0.06);
  delay.delayTime.value = 1 / f;
  const loopFilter = ctx.createBiquadFilter();
  loopFilter.type = "lowpass";
  loopFilter.frequency.value = Math.min(2800 + (l / 100) * 2200, 5200);
  loopFilter.Q.value = 0.3;
  const fb = ctx.createGain();
  fb.gain.value = 0.84;
  const drive = ctx.createWaveShaper();
  drive.curve = makeDriveCurve(0.45);
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 90;
  const scoop = ctx.createBiquadFilter();
  scoop.type = "peaking";
  scoop.frequency.value = 800;
  scoop.gain.value = -4.5;
  scoop.Q.value = 0.85;
  const presence = ctx.createBiquadFilter();
  presence.type = "peaking";
  presence.frequency.value = 3400;
  presence.gain.value = 3.2;
  presence.Q.value = 0.7;
  const cab = ctx.createBiquadFilter();
  cab.type = "lowpass";
  cab.frequency.value = 5600;
  cab.Q.value = 0.45;
  const out = ctx.createGain();
  const vol = 0.2 + (s / 100) * 0.12;
  const dur = 0.38 + (l / 100) * 0.2;
  out.gain.setValueAtTime(vol, now);
  out.gain.setTargetAtTime(vol * 0.4, now + 0.03, 0.05);
  out.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  fb.gain.setTargetAtTime(0.58, now + 0.14, 0.1);
  delay.connect(loopFilter);
  loopFilter.connect(fb);
  fb.connect(delay);
  delay.connect(drive);
  drive.connect(hp);
  hp.connect(scoop);
  scoop.connect(presence);
  presence.connect(cab);
  cab.connect(out);
  out.connect(getCompressor(ctx));
  exciteDelay(ctx, delay, f, 0.82);
  const pickLen = Math.floor(ctx.sampleRate * 0.0035);
  const pickBuf = ctx.createBuffer(1, pickLen, ctx.sampleRate);
  const pd = pickBuf.getChannelData(0);
  for (let i = 0; i < pickLen; i++)
    pd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / pickLen, 4);
  const pick = ctx.createBufferSource();
  pick.buffer = pickBuf;
  const pickG = ctx.createGain();
  pickG.gain.value = vol * 0.22;
  const pickHp = ctx.createBiquadFilter();
  pickHp.type = "highpass";
  pickHp.frequency.value = 1200;
  pick.connect(pickHp);
  pickHp.connect(pickG);
  pickG.connect(getCompressor(ctx));
  pick.start(now);
  registerVoice({
    gain: out,
    fb,
    released: false,
    nodes: [delay, loopFilter, fb, drive, hp, scoop, presence, cab, out, pickHp, pickG],
  });
}

function releaseAllSound(ctx: AudioContext, synthGain?: GainNode | null) {
  if (synthGain) fadeGain(synthGain.gain, ctx.currentTime);
  stopOrgan(ctx);
  releaseGatedVoices(ctx);
}

function drawColorGrid(canvas: HTMLCanvasElement, W: number, H: number) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const cols = 11,
    rows = 8,
    cw = W / cols,
    ch = H / rows;
  const hues = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
  const lights = [90, 78, 66, 54, 50, 42, 30, 18];
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) {
      ctx.fillStyle = `hsl(${hues[col % hues.length]},100%,${lights[row]}%)`;
      ctx.fillRect(
        Math.round(col * cw),
        Math.round(row * ch),
        Math.ceil(cw) + 1,
        Math.ceil(ch) + 1,
      );
    }
}

const INSTRUMENTS = [
  "Synth",
  "Piano",
  "Bass",
  "Acoustic Guitar",
  "Electric Guitar",
  "Organ",
] as const;
type Instrument = (typeof INSTRUMENTS)[number];

function getAudioContextClass() {
  return (
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  );
}

function InstrumentBar({
  instrument,
  onSelect,
  onUploadClick,
  fileInputRef,
  onUpload,
}: {
  instrument: Instrument;
  onSelect: (inst: Instrument) => void;
  onUploadClick: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="instrument-row">
      {INSTRUMENTS.map((inst) => {
        const active = instrument === inst;
        return (
          <button
            key={inst}
            type="button"
            onClick={() => onSelect(inst)}
            className={`instrument-btn ${active ? "instrument-btn--active" : "instrument-btn--idle"}`}
          >
            {inst}
          </button>
        );
      })}
      <button
        type="button"
        onClick={onUploadClick}
        className="upload-btn"
        aria-label="Add image"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3.25" y="5.25" width="17.5" height="13.5" />
          <circle cx="8.4" cy="9.7" r="1.35" />
          <path d="M3.25 16.4 L8.8 11.6 L12.7 15 L16.2 12.6 L20.75 16.6" />
        </svg>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={onUpload}
        style={{ display: "none" }}
      />
    </div>
  );
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const oscRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const filterRef = useRef<BiquadFilterNode | null>(null);
  const lastNoteTime = useRef<ThrottleRef>({});
  const instrumentRef = useRef<Instrument>("Synth");
  const audioReadyRef = useRef(false);
  const userImageRef = useRef<HTMLImageElement | null>(null);

  const [instrument, setInstrument] = useState<Instrument>("Synth");
  const [info, setInfo] = useState<Omit<NoteInfo, "noteIdx"> | null>(null);
  const [isLandscape, setIsLandscape] = useState(false);

  useEffect(() => {
    instrumentRef.current = instrument;
    const ctx = audioCtxRef.current;
    if (ctx) releaseAllSound(ctx, gainRef.current);
    lastNoteTime.current = {};
  }, [instrument]);

  const redrawCanvas = useCallback((W: number, H: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (userImageRef.current) {
      canvas.width = W;
      canvas.height = H;
      canvas.getContext("2d")?.drawImage(userImageRef.current, 0, 0, W, H);
    } else {
      drawColorGrid(canvas, W, H);
    }
  }, []);

  const syncCanvasToContainer = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const wrap = canvasWrapRef.current;
    if (wrap && wrap.clientWidth > 0 && wrap.clientHeight > 0) {
      redrawCanvas(
        Math.max(1, Math.round(wrap.clientWidth)),
        Math.max(1, Math.round(wrap.clientHeight)),
      );
      return;
    }
    const W = Math.min(window.innerWidth, 640);
    redrawCanvas(W, Math.round(W * 0.625));
  }, [redrawCanvas]);

  useEffect(() => {
    const applyViewport = () => {
      const vv = window.visualViewport;
      const height = vv?.height ?? window.innerHeight;
      const top = vv?.offsetTop ?? 0;
      const root = document.documentElement;
      root.style.setProperty("--vvh", `${height}px`);
      root.style.setProperty("--vv-top", `${top}px`);
      setIsLandscape(window.innerWidth > window.innerHeight);
    };
    applyViewport();
    window.addEventListener("resize", applyViewport);
    const onOrientation = () => {
      applyViewport();
      window.setTimeout(applyViewport, 160);
    };
    window.addEventListener("orientationchange", onOrientation);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", applyViewport);
    vv?.addEventListener("scroll", applyViewport);
    return () => {
      window.removeEventListener("resize", applyViewport);
      window.removeEventListener("orientationchange", onOrientation);
      vv?.removeEventListener("resize", applyViewport);
      vv?.removeEventListener("scroll", applyViewport);
    };
  }, []);

  useEffect(() => {
    if (!isLandscape) {
      const W = Math.min(window.innerWidth, 640);
      redrawCanvas(W, Math.round(W * 0.625));
      return;
    }
    const wrap = canvasWrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => syncCanvasToContainer());
    ro.observe(wrap);
    syncCanvasToContainer();
    return () => ro.disconnect();
  }, [isLandscape, redrawCanvas, syncCanvasToContainer]);

  const initAudio = useCallback(() => {
    if (audioReadyRef.current) return;
    if (audioCtxRef.current) {
      if (audioCtxRef.current.state === "suspended")
        void audioCtxRef.current.resume();
      audioReadyRef.current = true;
      return;
    }
    const AudioCtx = getAudioContextClass();
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const comp = getCompressor(ctx);
    const osc = ctx.createOscillator(),
      gain = ctx.createGain(),
      filter = ctx.createBiquadFilter();
    osc.type = "sine";
    filter.type = "lowpass";
    filter.frequency.value = 2000;
    gain.gain.value = 0;
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(comp);
    osc.start();
    audioCtxRef.current = ctx;
    oscRef.current = osc;
    gainRef.current = gain;
    filterRef.current = filter;
    audioReadyRef.current = true;
  }, []);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        userImageRef.current = img;
        syncCanvasToContainer();
      };
      img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const triggerFromPixel = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !audioReadyRef.current) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((clientX - rect.left) * (canvas.width / rect.width));
    const y = Math.floor((clientY - rect.top) * (canvas.height / rect.height));
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;
    const [r, g, b] = ctx2d.getImageData(x, y, 1, 1).data;
    const [h, s, l] = rgbToHsl(r, g, b);
    const { note, octave, octaveF, freq } = hslToNote(h, l);
    setInfo({
      r,
      g,
      b,
      h: Math.round(h),
      s: Math.round(s),
      l: Math.round(l),
      note,
      octave,
      octaveF,
      freq: Math.round(freq),
    });
    const ctx = audioCtxRef.current;
    if (!ctx || !oscRef.current || !gainRef.current || !filterRef.current)
      return;
    const nodes: SynthNodes = {
      osc: oscRef.current,
      gain: gainRef.current,
      filter: filterRef.current,
    };
    const inst = instrumentRef.current;
    if (inst === "Synth") playSynth(ctx, freq, s, l, nodes);
    else if (inst === "Piano") playPiano(ctx, freq, s, l, lastNoteTime.current);
    else if (inst === "Bass") playBass(ctx, freq, s, l, lastNoteTime.current);
    else if (inst === "Acoustic Guitar")
      playAcousticGuitar(ctx, freq, s, l, lastNoteTime.current);
    else if (inst === "Electric Guitar")
      playElectricGuitar(ctx, freq, s, l, lastNoteTime.current);
    else if (inst === "Organ") playOrgan(ctx, freq, s, l, lastNoteTime.current);
  }, []);

  const silenceAll = useCallback(() => {
    if (!audioCtxRef.current) return;
    releaseAllSound(audioCtxRef.current, gainRef.current);
  }, []);

  const activePointerRef = useRef<number | null>(null);

  const endPointer = useCallback(
    (pointerId?: number) => {
      if (
        pointerId !== undefined &&
        activePointerRef.current !== pointerId
      )
        return;
      activePointerRef.current = null;
      silenceAll();
    },
    [silenceAll],
  );

  useEffect(() => {
    const onBlur = () => endPointer();
    const onVisibility = () => {
      if (document.hidden) endPointer();
    };
    const onWindowPointerUp = (e: PointerEvent) => endPointer(e.pointerId);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pointerup", onWindowPointerUp);
    window.addEventListener("pointercancel", onWindowPointerUp);
    return () => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointerup", onWindowPointerUp);
      window.removeEventListener("pointercancel", onWindowPointerUp);
    };
  }, [endPointer]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!e.isPrimary) return;
      e.preventDefault();
      activePointerRef.current = e.pointerId;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* capture unsupported */
      }
      initAudio();
      triggerFromPixel(e.clientX, e.clientY);
    },
    [initAudio, triggerFromPixel],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!e.isPrimary) return;
      if (activePointerRef.current !== e.pointerId) return;
      if (e.buttons === 0) {
        endPointer(e.pointerId);
        return;
      }
      triggerFromPixel(e.clientX, e.clientY);
    },
    [endPointer, triggerFromPixel],
  );

  const handlePointerEnd = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!e.isPrimary) return;
      if (
        e.type !== "lostpointercapture" &&
        activePointerRef.current !== null &&
        activePointerRef.current !== e.pointerId
      )
        return;
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      endPointer(e.pointerId);
    },
    [endPointer],
  );

  const canvasProps = {
    ref: canvasRef,
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerEnd,
    onPointerCancel: handlePointerEnd,
    onPointerLeave: handlePointerEnd,
    onLostPointerCapture: handlePointerEnd,
    style: {
      touchAction: "none" as const,
      userSelect: "none" as const,
      WebkitUserSelect: "none" as const,
      display: "block" as const,
      cursor: "crosshair" as const,
    },
  };

  if (isLandscape) {
    return (
      <div className="app-landscape">
        <div className="app-landscape__toolbar">
          <InstrumentBar
            instrument={instrument}
            onSelect={setInstrument}
            onUploadClick={() => fileInputRef.current?.click()}
            fileInputRef={fileInputRef}
            onUpload={handleUpload}
          />
        </div>

        <div className="app-landscape__canvas" ref={canvasWrapRef}>
          <canvas
            {...canvasProps}
            style={{
              ...canvasProps.style,
              width: "100%",
              height: "100%",
            }}
          />
        </div>

        <div className="app-landscape__info">
          {info ? (
            <>
              <span style={{ color: "#fff", fontWeight: 700, fontSize: 13 }}>
                {`${info.note}${info.octave}`}
              </span>
              <span>OCT {info.octaveF.toFixed(1)}</span>
              <span>{`${info.freq} Hz`}</span>
              <span
                style={{ display: "flex", alignItems: "center", gap: 5 }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: `rgb(${info.r}, ${info.g}, ${info.b})`,
                    display: "inline-block",
                  }}
                />
                {info.h}° {info.s}% {info.l}%
              </span>
            </>
          ) : (
            <span style={{ color: "#444" }}>Touch to play</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="app-portrait"
      style={{
        minHeight: "100vh",
        background: "#0e0e0e",
        color: "#f0f0f0",
        fontFamily: "'Inter',sans-serif",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "40px 20px",
        gap: 24,
      }}
    >
      <div style={{ textAlign: "center" }}>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "0.08em",
            margin: 0,
            color: "#fff",
          }}
        >
          CHROMASOUND
        </h1>
        <p
          style={{
            fontSize: 13,
            color: "#666",
            margin: "6px 0 0",
            letterSpacing: "0.04em",
          }}
        >
          Click or drag the image to play
        </p>
      </div>

      <InstrumentBar
        instrument={instrument}
        onSelect={setInstrument}
        onUploadClick={() => fileInputRef.current?.click()}
        fileInputRef={fileInputRef}
        onUpload={handleUpload}
      />

      <div
        style={{
          borderRadius: 10,
          overflow: "hidden",
          border: "1px solid #222",
          background: "#111",
          width: "100%",
          maxWidth: 640,
        }}
      >
        <canvas
          {...canvasProps}
          style={{ ...canvasProps.style, width: "100%", height: "auto" }}
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: 10,
          width: "100%",
          maxWidth: 640,
        }}
      >
        {[
          {
            label: "RGB",
            value: info ? `${info.r}, ${info.g}, ${info.b}` : "—",
            dot: info ? `rgb(${info.r},${info.g},${info.b})` : null,
          },
          {
            label: "HSL",
            value: info ? `${info.h}°  ${info.s}%  ${info.l}%` : "—",
          },
          {
            label: "NOTE",
            value: info ? `${info.note}${info.octave}` : "—",
            big: true,
          },
          {
            label: "OCTAVE",
            value: info ? info.octaveF.toFixed(1) : "—",
            big: true,
            accent: "#80d4b0",
          },
          {
            label: "FREQ",
            value: info ? `${info.freq} Hz` : "—",
          },
        ].map(({ label, value, dot, big, accent }) => (
          <div
            key={label}
            style={{
              background: "#141414",
              border: "1px solid #222",
              borderRadius: 8,
              padding: "12px 10px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: "#555",
                letterSpacing: "0.1em",
                marginBottom: 6,
              }}
            >
              {label}
            </div>
            <div
              style={{
                fontSize: big ? 20 : 12,
                fontWeight: big ? 700 : 400,
                color: accent || (big ? "#c4a8ff" : "#e0e0e0"),
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
              }}
            >
              {dot && (
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: "50%",
                    background: dot,
                    display: "inline-block",
                    flexShrink: 0,
                  }}
                />
              )}
              {value}
            </div>
          </div>
        ))}
      </div>

      <p
        style={{
          fontSize: 11,
          color: "#333",
          letterSpacing: "0.04em",
          textAlign: "center",
          margin: 0,
        }}
      >
        Hue → Note · Lightness → Octave (1–6) · Saturation → Timbre & Volume
      </p>
      <p
        style={{
          fontSize: 10,
          color: "#252525",
          letterSpacing: "0.04em",
          margin: 0,
        }}
      >
        Rotate to landscape for fullscreen mode
      </p>
    </div>
  );
}
