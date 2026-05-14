// ====================================================================
// AudioMeter visualizer modules — simplified, animated, layout-friendly
// Each module fills its container (width: 100%, height: 100%)
// ====================================================================

const useRaf = (cb) => {
  const cbRef = React.useRef(cb);
  React.useEffect(() => { cbRef.current = cb; });
  React.useEffect(() => {
    let raf;
    const loop = (now) => {
      cbRef.current(now / 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
};

// Robust element measurement: ResizeObserver where available, plus window resize
// fallback and a few rAF re-checks after mount to catch async layout settling.
const measureEl = (el) => {
  if (!el) return { w: 0, h: 0 };
  const r = el.getBoundingClientRect();
  return { w: r.width, h: r.height };
};

const useSize = () => {
  const ref = React.useRef(null);
  const [size, setSize] = React.useState({ w: 0, h: 0 });
  React.useLayoutEffect(() => {
    if (!ref.current) return;
    let raf;
    const update = () => {
      if (!ref.current) return;
      const r = ref.current.getBoundingClientRect();
      const s = { w: Math.round(r.width), h: Math.round(r.height) };
      setSize((prev) => (prev.w === s.w && prev.h === s.h) ? prev : s);
    };
    update();
    // Re-check on next few frames (layouts can settle async)
    let n = 0;
    const tick = () => {
      update();
      if (++n < 6) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    let ro;
    try {
      ro = new ResizeObserver(() => update());
      ro.observe(ref.current);
    } catch (e) { /* noop */ }
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);
  return [ref, size];
};

// Hook variant for an external ref (when caller manages the ref)
const useSizeOf = (ref) => {
  const [size, setSize] = React.useState({ w: 0, h: 0 });
  React.useLayoutEffect(() => {
    if (!ref.current) return;
    let raf;
    const update = () => {
      if (!ref.current) return;
      const r = ref.current.getBoundingClientRect();
      const s = { w: Math.round(r.width), h: Math.round(r.height) };
      setSize((prev) => (prev.w === s.w && prev.h === s.h) ? prev : s);
    };
    update();
    let n = 0;
    const tick = () => {
      update();
      if (++n < 6) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    let ro;
    try {
      ro = new ResizeObserver(() => update());
      ro.observe(ref.current);
    } catch (e) { /* noop */ }
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);
  return size;
};

// -------------------- PEAK METER --------------------
function PeakMeter() {
  const lRef = React.useRef(null);
  const rRef = React.useRef(null);
  const lValRef = React.useRef(null);
  const rValRef = React.useRef(null);

  useRaf((t) => {
    const lv = -14.4 + Math.sin(t * 2.1) * 5 + Math.sin(t * 7.3) * 2.5;
    const rv = -15.9 + Math.sin(t * 2.4 + 0.5) * 5 + Math.sin(t * 6.7) * 2.5;
    // map -60..+3 dB to 0..100% height
    const map = (v) => Math.max(0, Math.min(100, ((v + 60) / 63) * 100));
    if (lRef.current) lRef.current.style.height = map(lv) + "%";
    if (rRef.current) rRef.current.style.height = map(rv) + "%";
    if (lValRef.current) lValRef.current.textContent = lv.toFixed(1);
    if (rValRef.current) rValRef.current.textContent = rv.toFixed(1);
  });

  return (
    <div className="peak">
      <div className="peak-scale">
        {[3, 0, -6, -12, -24, -48, -60].map((v) => (
          <div key={v} className="peak-scale-tick">{v > 0 ? "+" + v : v}</div>
        ))}
      </div>
      <div className="peak-bars">
        <div className="peak-col">
          <div className="peak-label">L <span ref={lValRef}>-14.4</span></div>
          <div className="peak-bar-wrap">
            <div className="peak-bar" ref={lRef}></div>
          </div>
        </div>
        <div className="peak-col">
          <div className="peak-label">R <span ref={rValRef}>-15.9</span></div>
          <div className="peak-bar-wrap">
            <div className="peak-bar" ref={rRef}></div>
          </div>
        </div>
      </div>
      <div className="peak-footer">
        TP MAX <span style={{ color: "var(--green)", fontWeight: 600 }}>-4.6 dBTP</span>
      </div>
    </div>
  );
}

// -------------------- LOUDNESS CHART --------------------
function LoudnessChart() {
  const [ref, size] = useSize();
  const pathRef = React.useRef(null);
  const pointsRef = React.useRef([]);

  // Seed initial points
  React.useEffect(() => {
    const N = 200;
    const arr = [];
    let v = -22;
    for (let i = 0; i < N; i++) {
      v += (Math.random() - 0.5) * 1.2;
      v = Math.max(-30, Math.min(-15, v));
      if (i === 60) v = -50; // The dramatic dip
      arr.push(v);
    }
    pointsRef.current = arr;
  }, []);

  useRaf((t) => {
    if (!pathRef.current || !size.w || !size.h) return;
    const pts = pointsRef.current;
    // Drift the curve slowly by shifting last point
    const phase = Math.floor(t * 8) % pts.length;
    pts[phase] = -22 + Math.sin(t * 3 + phase) * 3 + Math.sin(t * 7 + phase * 0.3) * 1.5;
    // map -63..0 dB to bottom..top
    const map = (v) => ((-v) / 63) * size.h;
    let d = "";
    for (let i = 0; i < pts.length; i++) {
      const x = (i / (pts.length - 1)) * size.w;
      const y = map(pts[i]);
      d += (i === 0 ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1);
    }
    pathRef.current.setAttribute("d", d);
  });

  // ref line for -23 LUFS
  const refY = size.h ? ((-(-23)) / 63) * size.h : 0;

  return (
    <div className="loudness" ref={ref}>
      <div className="loudness-yaxis">
        {[0, -6, -12, -18, -27, -36, -45, -54, -63].map((v) => (
          <div key={v} className="loudness-tick">{v}</div>
        ))}
      </div>
      <div className="loudness-canvas">
        <svg width="100%" height="100%" preserveAspectRatio="none">
          <defs>
            <linearGradient id="loud-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(78,195,255,0.25)" />
              <stop offset="100%" stopColor="rgba(78,195,255,0)" />
            </linearGradient>
          </defs>
          {/* -23 reference line */}
          <line x1="0" x2="100%" y1={refY} y2={refY}
            stroke="var(--orange)" strokeWidth="1.5" strokeDasharray="4 4" opacity="0.85" />
          <path ref={pathRef} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
        </svg>
        <div className="loudness-refbadge">-23</div>
        <div className="loudness-xaxis">
          <span>2m</span><span>1m30s</span><span>1m</span><span>30s</span><span>0s</span>
        </div>
        <div className="loudness-reftag">Ref EBU R128 (-23 LUFS)</div>
      </div>
    </div>
  );
}

// -------------------- LOUDNESS STATS --------------------
function LoudnessStats({ compact }) {
  const items = [
    { label: "Momentary", short: "MOMEN", value: -21.7, unit: "LUFS" },
    { label: "Short-term", short: "SHORT", value: -20.4, unit: "LUFS", active: true },
    { label: "Integrated", short: "INTGR", value: -19.9, unit: "LUFS" },
    { label: "Momentary Max", short: "M-MAX", value: -12.8, unit: "LUFS" },
    { label: "Short-term Max", short: "S-MAX", value: -13.8, unit: "LUFS" },
    { label: "Range (LRA)", short: "LRA", value: 6.1, unit: "LU" },
    { label: "Dynamics", short: "DYN", value: 15.8, unit: "DB" },
  ];
  return (
    <div className={"lufs " + (compact ? "lufs-compact" : "")}>
      {items.map((it) => (
        <div key={it.label} className={"lufs-row " + (it.active ? "lufs-row-active" : "")}>
          <div className="lufs-label">{compact ? it.short : it.label}</div>
          <div className="lufs-value">{it.value > 0 ? "+" : ""}{it.value.toFixed(1)}</div>
          <div className="lufs-unit">{it.unit}</div>
        </div>
      ))}
    </div>
  );
}

// -------------------- VECTORSCOPE --------------------
function Vectorscope() {
  const blobRef = React.useRef(null);
  const corrRef = React.useRef(null);
  useRaf((t) => {
    if (blobRef.current) {
      const rot = Math.sin(t * 0.5) * 8 - 45;
      const sx = 1.2 + Math.sin(t * 1.8) * 0.4;
      const sy = 0.3 + Math.sin(t * 2.3) * 0.1;
      blobRef.current.setAttribute("transform",
        `translate(50 50) rotate(${rot}) scale(${sx} ${sy})`);
    }
    if (corrRef.current) {
      const c = 0.92 + Math.sin(t * 0.7) * 0.06;
      corrRef.current.textContent = c.toFixed(2);
    }
  });
  return (
    <div className="vectorscope">
      <svg viewBox="0 0 100 100" className="vs-svg" preserveAspectRatio="xMidYMid meet">
        <line x1="10" y1="10" x2="90" y2="90" stroke="var(--text-mute)" strokeWidth="0.4" strokeDasharray="1 1.5" />
        <line x1="90" y1="10" x2="10" y2="90" stroke="var(--text-mute)" strokeWidth="0.4" strokeDasharray="1 1.5" />
        <circle cx="50" cy="50" r="40" fill="none" stroke="var(--border)" strokeWidth="0.4" />
        <ellipse ref={blobRef} rx="14" ry="3" fill="var(--accent)" opacity="0.7"
          transform="translate(50 50) rotate(-45) scale(1.2 0.3)" />
      </svg>
      <div className="vs-labels">
        <span className="vs-l">L</span>
        <span className="vs-r">R</span>
      </div>
      <div className="vs-footer">
        CORRELATION <span ref={corrRef} style={{ color: "var(--green)", fontWeight: 600 }}>0.97</span>
      </div>
    </div>
  );
}

// -------------------- SPECTRUM --------------------
function Spectrum() {
  const [ref, size] = useSize();
  const pathRef = React.useRef(null);
  const fillRef = React.useRef(null);
  const dataRef = React.useRef([]);

  React.useEffect(() => {
    const N = 120;
    const arr = [];
    for (let i = 0; i < N; i++) {
      // log-ish curve: high in mids, drops at edges
      const x = i / (N - 1);
      const base = -90 + Math.sin(x * Math.PI) * 50 + Math.sin(x * Math.PI * 4) * 12;
      arr.push(base);
    }
    dataRef.current = arr;
  }, []);

  useRaf((t) => {
    if (!pathRef.current || !size.w || !size.h) return;
    const data = dataRef.current;
    let d = "";
    for (let i = 0; i < data.length; i++) {
      const x = (i / (data.length - 1)) * size.w;
      const v = data[i] + Math.sin(t * 4 + i * 0.4) * 4 + Math.sin(t * 9 + i * 0.7) * 2;
      const y = ((-v) / 100) * size.h;
      d += (i === 0 ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1);
    }
    pathRef.current.setAttribute("d", d);
    if (fillRef.current) fillRef.current.setAttribute("d", d + ` L${size.w},${size.h} L0,${size.h} Z`);
  });

  return (
    <div className="spectrum" ref={ref}>
      <div className="spectrum-yaxis">
        {[0, -20, -40, -60, -80].map((v) => <div key={v}>{v}</div>)}
      </div>
      <div className="spectrum-canvas">
        <svg width="100%" height="100%" preserveAspectRatio="none">
          <defs>
            <linearGradient id="spec-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(78,195,255,0.35)" />
              <stop offset="100%" stopColor="rgba(78,195,255,0)" />
            </linearGradient>
          </defs>
          <path ref={fillRef} fill="url(#spec-fill)" />
          <path ref={pathRef} fill="none" stroke="var(--accent)" strokeWidth="1.3" />
        </svg>
        <div className="spectrum-xaxis">
          <span>20</span><span>50</span><span>100</span><span>200</span>
          <span>500</span><span>1k</span><span>2k</span><span>5k</span>
          <span>10k</span><span>20k</span>
        </div>
      </div>
    </div>
  );
}

// -------------------- SPECTROGRAM --------------------
function Spectrogram() {
  const canvasRef = React.useRef(null);
  React.useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const w = c.width = 600;
    const h = c.height = 200;
    const ctx = c.getContext("2d");
    // generate convincing spectrogram-looking pattern
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const freq = 1 - y / h; // 0..1 (low at bottom)
        const intensity =
          0.5 +
          Math.sin(x * 0.05 + y * 0.02) * 0.25 +
          Math.sin(x * 0.13 - y * 0.07) * 0.2 +
          Math.sin(x * 0.31 + y * 0.05) * 0.15 +
          (1 - freq) * 0.25 -
          freq * 0.15;
        const v = Math.max(0, Math.min(1, intensity));
        // viridis-magma-ish color
        const r = Math.floor(40 + v * 215);
        const g = Math.floor(v * v * 180);
        const b = Math.floor(80 + (1 - v) * 100 + v * 30);
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, []);

  return (
    <div className="spectrogram">
      <div className="spectrogram-yaxis">
        <span>20k</span><span>10k</span><span>5k</span><span>2k</span><span>1k</span>
        <span>500</span><span>200</span><span>100</span><span>50</span><span>20</span>
      </div>
      <div className="spectrogram-canvas">
        <canvas ref={canvasRef}></canvas>
      </div>
    </div>
  );
}

// -------------------- MODULE REGISTRY --------------------
const MODULE_REGISTRY = {
  peak: { id: "peak", title: "Peak", render: () => <PeakMeter />, minW: 140, minH: 200, defaultW: 200, defaultH: 320 },
  loudness: { id: "loudness", title: "Loudness", render: () => <LoudnessChart />, minW: 320, minH: 200, defaultW: 700, defaultH: 320 },
  loudnessStats: { id: "loudnessStats", title: "Loudness Stats", render: (compact) => <LoudnessStats compact={compact} />, minW: 160, minH: 200, defaultW: 240, defaultH: 320 },
  vectorscope: { id: "vectorscope", title: "Vectorscope", render: () => <Vectorscope />, minW: 180, minH: 200, defaultW: 280, defaultH: 280 },
  spectrum: { id: "spectrum", title: "Spectrum", render: () => <Spectrum />, minW: 280, minH: 180, defaultW: 520, defaultH: 240 },
  spectrogram: { id: "spectrogram", title: "Spectrogram", render: () => <Spectrogram />, minW: 320, minH: 160, defaultW: 1000, defaultH: 240 },
};

Object.assign(window, {
  PeakMeter, LoudnessChart, LoudnessStats, Vectorscope, Spectrum, Spectrogram,
  MODULE_REGISTRY, useRaf, useSize, useSizeOf,
});
