"use client";

import { useEffect, useRef, useState } from "react";

const TEXT     = "yahayabb";
const FONT     = "'Proxima Nova', 'Montserrat', 'Helvetica Neue', Helvetica, Arial, sans-serif";
const LS_START = 100;
const LS_END   =   2;
const SC_START = 1.5;
const SC_END   = 1.00;

const TL = {
  lineIn: { start: 0.0,  dur: 0.35 },
  split:  { start: 0.35, dur: 2.2  },
  end: 3.0,
};

function easeOut3(t)   { return 1 - Math.pow(1 - t, 3); }
function easeInOut3(t) { return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2; }
function clamp(v,a,b)  { return Math.max(a, Math.min(b, v)); }
function norm(t, s, d) { return clamp((t - s) / d, 0, 1); }
function lerp(a, b, t) { return a + (b - a) * t; }

export default function SplashScreen() {
  const [v, setV] = useState({
    textOpacity:   0,
    textScale:     SC_START,
    lineOpacity:   0,
    lineY:         0,
    letterSpacing: LS_START,
    done:          false,
  });

  const textRef     = useRef(null);
  const rafRef      = useRef(null);
  const startRef    = useRef(null);
  const maxSplitRef = useRef(80);

  useEffect(() => {
    if (!document.getElementById("splash-font")) {
      const l = document.createElement("link");
      l.id = "splash-font"; l.rel = "stylesheet";
      l.href = "https://fonts.googleapis.com/css2?family=Montserrat:wght@700&display=swap";
      document.head.appendChild(l);
    }

    function tick(now) {
      if (!startRef.current) startRef.current = now;
      const t = (now - startRef.current) / 1000;

      if (t < 0.1 && textRef.current) {
        maxSplitRef.current = textRef.current.getBoundingClientRect().height / 2;
      }
      const maxSplit = maxSplitRef.current;

      const lineInP = easeOut3(norm(t, TL.lineIn.start, TL.lineIn.dur));
      const splitP  = easeInOut3(norm(t, TL.split.start, TL.split.dur));

      const lineY         = splitP * maxSplit;
      const letterSpacing = lerp(LS_START, LS_END, splitP);
      const textOpacity   = splitP;
      const textScale     = lerp(SC_START, SC_END, splitP);
      const lineOpacity   = Math.max(0, lineInP * (1 - splitP));

      if (t >= TL.end) {
        setV(s => ({ ...s, lineOpacity: 0, done: true }));
        return;
      }

      setV({ textOpacity, textScale, lineOpacity, lineY, letterSpacing, done: false });
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  if (v.done) return null;

  const textBase = {
    fontFamily:    FONT,
    fontWeight:    700,
    fontSize:      "clamp(50px, 16vw, 100px)",
    letterSpacing: `${v.letterSpacing}px`,
    whiteSpace:    "nowrap",
    lineHeight:    1.1,
    userSelect:    "none",
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      backgroundColor: "#000",
      display: "flex", alignItems: "center", justifyContent: "center",
      overflow: "hidden",
    }}>
      <div
        ref={textRef}
        style={{
          position:        "relative",
          opacity:         v.textOpacity,
          transform:       `scale(${v.textScale})`,
          transformOrigin: "center center",
          willChange:      "opacity, transform",
        }}
      >
        {/* LAYER 1 — outline only */}
        <div style={{ ...textBase, color: "transparent", WebkitTextStroke: "1.5px #ffffff" }}>
          {TEXT}
        </div>
        {/* LAYER 2 — filled white, clipped between lines */}
        <div style={{
          position: "absolute", inset: 0, overflow: "hidden",
          clipPath: `inset(calc(50% - ${v.lineY}px) 0px calc(50% - ${v.lineY}px) 0px)`,
        }}>
          <div style={{ ...textBase, color: "#ffffff" }}>{TEXT}</div>
        </div>
      </div>

      <Line y={-v.lineY} opacity={v.lineOpacity} />
      <Line y={ v.lineY} opacity={v.lineOpacity} />
    </div>
  );
}

function Line({ y, opacity }) {
  return (
    <div style={{
      position:     "absolute",
      left:         0,
      right:        0,
      top:          "50%",
      height:       "1px",
      transform:    `translateY(calc(-50% + ${y}px))`,
      opacity,
      // Crisp solid line that only fades at the far edges
      background:   "linear-gradient(to right, transparent 0%, #fff 8%, #fff 92%, transparent 100%)",
      pointerEvents: "none",
      willChange:   "transform, opacity",
    }} />
  );
}