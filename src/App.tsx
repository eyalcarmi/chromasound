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

function drumLabel(h: number) {
  if (h < 45 || h >= 315) return "Kick";
  if (h < 150) return "Snare";
  if (h < 255) return "Hi-hat";
  return "Tom";
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

function playSynth(
  ctx: AudioContext,
  freq: number,
  s: number,
  l: number,
  nodes: SynthNodes,
) {
  const now = ctx.currentTime;
  nodes.osc.frequency.setTargetAtTime(freq, now, 0.03);
  nodes.gain.gain.setTargetAtTime(0.08 + (s / 100) * 0.28, now, 0.03);
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

function playBass(
  ctx: AudioContext,
  freq: number,
  s: number,
  l: number,
  lnt: ThrottleRef,
) {
  const now = ctx.currentTime;
  if (lnt.current && now - lnt.current < 0.11) return;
  const bassFreq = freq / 2;
  const prev = lnt._freq ?? bassFreq;
  lnt.current = now;
  lnt._freq = bassFreq;
  const comp = getCompressor(ctx);
  const vol = 0.18 + (s / 100) * 0.16;
  const dur = 0.7;
  const cutoff = Math.min(lightnessToCutoff(l) * 0.55, 1200);
  const layers = [
    { type: "sine" as OscillatorType, ratio: 1, amp: 1.0, glide: 0.08 },
    { type: "triangle" as OscillatorType, ratio: 2, amp: 0.35, glide: 0.07 },
    { type: "sine" as OscillatorType, ratio: 3, amp: 0.1, glide: 0.06 },
  ];
  const body = ctx.createBiquadFilter();
  body.type = "peaking";
  body.frequency.value = 180;
  body.gain.value = 5;
  body.Q.value = 2;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = cutoff;
  lp.Q.value = 0.6;
  const shelf = ctx.createBiquadFilter();
  shelf.type = "highshelf";
  shelf.frequency.value = 1200;
  shelf.gain.value = -9;
  layers.forEach(({ type, ratio, amp, glide }) => {
    const o = ctx.createOscillator(),
      g = ctx.createGain();
    o.type = type;
    o.frequency.value = prev * ratio;
    o.frequency.setTargetAtTime(bassFreq * ratio, now, glide);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(vol * amp, now + 0.014);
    g.gain.setTargetAtTime(vol * amp * 0.5, now + 0.014, 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(g);
    g.connect(body);
    o.start(now);
    o.stop(now + dur + 0.05);
  });
  const sub = ctx.createOscillator(),
    subG = ctx.createGain();
  sub.type = "sine";
  sub.frequency.value = bassFreq / 2;
  subG.gain.setValueAtTime(0, now);
  subG.gain.linearRampToValueAtTime(vol * 0.18, now + 0.025);
  subG.gain.exponentialRampToValueAtTime(0.0001, now + dur * 0.5);
  sub.connect(subG);
  subG.connect(body);
  sub.start(now);
  sub.stop(now + dur * 0.5 + 0.05);
  body.connect(lp);
  lp.connect(shelf);
  shelf.connect(comp);
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
  if (organNodes && organNodes.ctx === ctx)
    organNodes.master.gain.setTargetAtTime(0, ctx.currentTime, 0.12);
}

function playDrums(
  ctx: AudioContext,
  h: number,
  s: number,
  lnt: ThrottleRef,
) {
  const now = ctx.currentTime;
  if (lnt.current && now - lnt.current < 0.12) return;
  lnt.current = now;
  const comp = getCompressor(ctx);
  const vol = 0.15 + (s / 100) * 0.3;
  if (h < 45 || h >= 315) {
    const o = ctx.createOscillator(),
      g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(150, now);
    o.frequency.exponentialRampToValueAtTime(40, now + 0.3);
    g.gain.setValueAtTime(vol * 2, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    o.connect(g);
    g.connect(comp);
    o.start(now);
    o.stop(now + 0.4);
  } else if (h < 150) {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.15, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 1800;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol * 1.1, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
    src.connect(f);
    f.connect(g);
    g.connect(comp);
    src.start(now);
    const o = ctx.createOscillator(),
      g2 = ctx.createGain();
    o.frequency.value = 190;
    g2.gain.setValueAtTime(vol * 0.4, now);
    g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
    o.connect(g2);
    g2.connect(comp);
    o.start(now);
    o.stop(now + 0.1);
  } else if (h < 255) {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.07, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol * 0.7, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
    src.connect(f);
    f.connect(g);
    g.connect(comp);
    src.start(now);
  } else {
    const o = ctx.createOscillator(),
      g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(210, now);
    o.frequency.exponentialRampToValueAtTime(75, now + 0.25);
    g.gain.setValueAtTime(vol * 1.6, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    o.connect(g);
    g.connect(comp);
    o.start(now);
    o.stop(now + 0.3);
  }
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

const INSTRUMENTS = ["Synth", "Piano", "Bass", "Drums", "Organ"] as const;
type Instrument = (typeof INSTRUMENTS)[number];

function getAudioContextClass() {
  return (
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  );
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
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

  useEffect(() => {
    const onResize = () => {
      const land = window.innerWidth > window.innerHeight;
      setIsLandscape(land);
      const W = land ? window.innerWidth : Math.min(window.innerWidth, 640);
      const H = land
        ? window.innerHeight
        : Math.round(Math.min(window.innerWidth, 640) * 0.625);
      redrawCanvas(W, H);
    };
    onResize();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", () =>
      setTimeout(onResize, 120),
    );
    return () => window.removeEventListener("resize", onResize);
  }, [redrawCanvas]);

  useEffect(() => {
    document.body.style.overflow = isLandscape ? "hidden" : "";
    document.documentElement.style.overflow = isLandscape ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
    };
  }, [isLandscape]);

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
        const land = window.innerWidth > window.innerHeight;
        const W = land ? window.innerWidth : Math.min(window.innerWidth, 640);
        const H = land ? window.innerHeight : Math.round(W * 0.625);
        redrawCanvas(W, H);
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
    else if (inst === "Drums") playDrums(ctx, Math.round(h), s, lastNoteTime.current);
    else if (inst === "Organ") playOrgan(ctx, freq, s, l, lastNoteTime.current);
  }, []);

  const silenceAll = useCallback(() => {
    if (!audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    gainRef.current?.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
    stopOrgan(ctx);
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      initAudio();
      triggerFromPixel(e.clientX, e.clientY);
    },
    [initAudio, triggerFromPixel],
  );
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (e.buttons > 0) triggerFromPixel(e.clientX, e.clientY);
    },
    [triggerFromPixel],
  );
  const handleMouseLeave = useCallback(() => silenceAll(), [silenceAll]);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      initAudio();
      const t = e.touches[0];
      triggerFromPixel(t.clientX, t.clientY);
    },
    [initAudio, triggerFromPixel],
  );
  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      const t = e.touches[0];
      triggerFromPixel(t.clientX, t.clientY);
    },
    [triggerFromPixel],
  );
  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      silenceAll();
    },
    [silenceAll],
  );

  const isDrums = instrument === "Drums";

  const canvasProps = {
    ref: canvasRef,
    onMouseDown: handleMouseDown,
    onMouseMove: handleMouseMove,
    onMouseLeave: handleMouseLeave,
    onTouchStart: handleTouchStart,
    onTouchMove: handleTouchMove,
    onTouchEnd: handleTouchEnd,
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
      <div
        style={{
          position: "fixed",
          inset: 0,
          width: "100vw",
          height: "100dvh",
          background: "#000",
          overflow: "hidden",
          touchAction: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 20,
            display: "flex",
            gap: 4,
            padding: "5px 8px",
            background: "rgba(0,0,0,0.6)",
            justifyContent: "center",
            alignItems: "center",
            backdropFilter: "blur(4px)",
          }}
        >
          {INSTRUMENTS.map((inst) => {
            const active = instrument === inst;
            return (
              <button
                key={inst}
                onClick={() => setInstrument(inst)}
                style={{
                  padding: "4px 11px",
                  borderRadius: 4,
                  fontSize: 10,
                  letterSpacing: "0.05em",
                  border: `1px solid ${active ? "#7c5cbf" : "#333"}`,
                  background: active ? "#2a1f3d" : "transparent",
                  color: active ? "#c4a8ff" : "#666",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {inst.toUpperCase()}
              </button>
            );
          })}
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              padding: "4px 11px",
              borderRadius: 4,
              fontSize: 10,
              letterSpacing: "0.05em",
              border: "1px solid #333",
              background: "transparent",
              color: "#555",
              cursor: "pointer",
              fontFamily: "inherit",
              marginLeft: 8,
            }}
          >
            IMG
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleUpload}
            style={{ display: "none" }}
          />
        </div>

        <canvas
          {...canvasProps}
          style={{
            ...canvasProps.style,
            position: "absolute",
            inset: 0,
            width: "100vw",
            height: "100dvh",
            objectFit: "cover",
          }}
        />

        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 20,
            display: "flex",
            gap: 14,
            padding: "5px 14px",
            background: "rgba(0,0,0,0.55)",
            backdropFilter: "blur(4px)",
            justifyContent: "center",
            alignItems: "center",
            fontFamily: "'Inter',sans-serif",
            fontSize: 11,
            color: "#888",
            letterSpacing: "0.06em",
          }}
        >
          {info ? (
            <>
              <span style={{ color: "#fff", fontWeight: 700, fontSize: 13 }}>
                {isDrums ? drumLabel(info.h) : `${info.note}${info.octave}`}
              </span>
              <span>OCT {info.octaveF.toFixed(1)}</span>
              <span>{isDrums ? `${info.h}°` : `${info.freq} Hz`}</span>
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

      <div
        style={{
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        {INSTRUMENTS.map((inst) => {
          const active = instrument === inst;
          return (
            <button
              key={inst}
              onClick={() => setInstrument(inst)}
              style={{
                padding: "7px 16px",
                borderRadius: 6,
                fontSize: 12,
                letterSpacing: "0.05em",
                border: `1px solid ${active ? "#7c5cbf" : "#2a2a2a"}`,
                background: active ? "#2a1f3d" : "#141414",
                color: active ? "#c4a8ff" : "#777",
                cursor: "pointer",
                transition: "all 0.15s",
                fontFamily: "inherit",
              }}
            >
              {inst.toUpperCase()}
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button
          onClick={() => fileInputRef.current?.click()}
          style={{
            cursor: "pointer",
            padding: "8px 18px",
            borderRadius: 6,
            border: "1px solid #333",
            fontSize: 13,
            color: "#bbb",
            background: "#1a1a1a",
            letterSpacing: "0.04em",
            fontFamily: "inherit",
          }}
        >
          Upload Image
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleUpload}
          style={{ display: "none" }}
        />
      </div>

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
            label: isDrums ? "DRUM" : "NOTE",
            value: info
              ? isDrums
                ? drumLabel(info.h)
                : `${info.note}${info.octave}`
              : "—",
            big: true,
          },
          {
            label: "OCTAVE",
            value: info ? info.octaveF.toFixed(1) : "—",
            big: true,
            accent: "#80d4b0",
          },
          {
            label: isDrums ? "HUE" : "FREQ",
            value: info ? (isDrums ? `${info.h}°` : `${info.freq} Hz`) : "—",
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
        {isDrums
          ? "Red/Orange → Kick · Yellow/Green → Snare · Cyan/Blue → Hi-hat · Purple → Tom"
          : "Hue → Note · Lightness → Octave (1–6) · Saturation → Timbre & Volume"}
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
