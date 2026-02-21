"use client";
import { useEffect, useRef, useState } from "react";

// ── 3D math ───────────────────────────────────────────────────────────────────
function raDecToXYZ(raDeg, decDeg) {
  const ra  = (raDeg  * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  return { x: Math.cos(dec)*Math.cos(ra), y: Math.sin(dec), z: Math.cos(dec)*Math.sin(ra) };
}
function rotX(v, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: v.x, y: c*v.y - s*v.z, z: s*v.y + c*v.z };
}
function rotY(v, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: c*v.x + s*v.z, y: v.y, z: -s*v.x + c*v.z };
}
function projectSphere(v, W, H, scale) {
  const sc = Math.min(W, H) * (scale ?? 0.95);
  return {
    x: W/2 + v.x * sc,
    y: H/2 - v.y * sc,
    z: v.z,
    visible: v.z > -0.05,
    alpha: Math.max(0, v.z),
  };
}
function easeInOutCubic(t) {
  return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2;
}

// ── d3-celestial coordinate conversion ───────────────────────────────────────
function lonLatToRaDec([lon, lat]) {
  let ra = -lon;
  if (ra < 0) ra += 360;
  return [ra, lat];
}

// ── B-V colour index → RGB ────────────────────────────────────────────────────
// Based on Ballesteros (2012) formula, clamped to visible star range.
// bv: typically -0.4 (blue-white O/B) → +2.0 (deep red M-type)
function bvToRgb(bv) {
  const t = Math.max(-0.4, Math.min(2.0, bv));
  let r, g, b;

  // Red channel
  if      (t < 0.40) r = 0.61 + 0.11*t + 0.1*t*t;
  else if (t < 1.50) r = 0.83 + (0.17*(t-0.40))/(1.50-0.40);
  else               r = 1.00;
  r = Math.min(1, Math.max(0, r));

  // Green channel
  if      (t < 0.00) g = 0.70 + 0.07*t + 1.1*t*t;
  else if (t < 0.40) g = 0.87 + 0.54*t - 0.93*t*t;
  else if (t < 1.60) g = 0.97 - 0.26*(t-0.40)/(1.60-0.40);
  else               g = Math.max(0, 0.74 - (t-1.60));
  g = Math.min(1, Math.max(0, g));

  // Blue channel
  if      (t < 0.40) b = 1.00;
  else if (t < 1.50) b = Math.max(0, 1.00 - (t-0.40)/(1.50-0.40));
  else               b = 0.00;
  b = Math.min(1, Math.max(0, b));

  return [Math.round(r*255), Math.round(g*255), Math.round(b*255)];
}

// ── Data fetching ─────────────────────────────────────────────────────────────
const LINES_URL = "https://cdn.jsdelivr.net/gh/ofrohn/d3-celestial@master/data/constellations.lines.json";
const NAMES_URL = "https://cdn.jsdelivr.net/gh/ofrohn/d3-celestial@master/data/constellations.json";
const STARS_URL = "https://cdn.jsdelivr.net/gh/ofrohn/d3-celestial@master/data/stars.6.json";

async function loadStars() {
  const res  = await fetch(STARS_URL);
  const data = await res.json();
  return data.features.map(f => {
    const [lon, lat] = f.geometry.coordinates;
    let ra = -lon; if (ra < 0) ra += 360;
    const dec = lat;
    const mag = f.properties.mag;
    const bv  = f.properties.bv ?? 0.6; // fallback to sun-like if missing
    const [cr, cg, cb] = bvToRgb(bv);
    return {
      xyz: raDecToXYZ(ra, dec),
      mag,
      cr, cg, cb,
      twinklePhase: Math.random() * Math.PI * 2,
      twinkleSpeed: 0.008 + Math.random() * 0.014,
    };
  });
}

async function loadConstellations() {
  const [linesRes, namesRes] = await Promise.all([fetch(LINES_URL), fetch(NAMES_URL)]);
  const linesGeo = await linesRes.json();
  const namesGeo = await namesRes.json();

  const labelPos = {};
  for (const f of namesGeo.features) {
    if (f.geometry?.coordinates) {
      const [ra, dec] = lonLatToRaDec(f.geometry.coordinates);
      labelPos[f.id] = { ra, dec };
    }
  }

  return linesGeo.features.map(f => {
    const id = f.id;
    const segments = f.geometry.coordinates.map(line =>
      line.map(([lon, lat]) => {
        const [ra, dec] = lonLatToRaDec([lon, lat]);
        return { xyz: raDecToXYZ(ra, dec) };
      })
    );
    const lp = labelPos[id];
    return { id, segments, labelXyz: lp ? raDecToXYZ(lp.ra, lp.dec) : null };
  });
}

// ── Canvas renderer ───────────────────────────────────────────────────────────
function StarGlobe({ constellations, stars, projScale }) {
  const canvasRef = useRef(null);
  const mouse     = useRef({ x: 0.5, y: 0.5 });
  const animRef   = useRef(null);
  const consRef   = useRef(constellations);
  const starsRef  = useRef(stars);
  const scaleRef  = useRef(projScale);

  useEffect(() => { consRef.current  = constellations; }, [constellations]);
  useEffect(() => { starsRef.current = stars;          }, [stars]);
  useEffect(() => { scaleRef.current = projScale;      }, [projScale]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx    = canvas.getContext("2d");
    let W, H;

    const rot  = { x: 0.15, y: 0.0 };
    const vel  = { x: 0.0,  y: 0.0 };
    const AUTO = { x: -0.00045, y: 0.001 };

    const onMove = e => {
      const pt = e.touches ? e.touches[0] : e;
      mouse.current = { x: pt.clientX/window.innerWidth, y: pt.clientY/window.innerHeight };
    };
    const resize = () => { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; };

    const draw = () => {
      ctx.clearRect(0, 0, W, H);

      const cx = mouse.current.x - 0.5;
      const cy = mouse.current.y - 0.5;
      const md = Math.sqrt(cx*cx + cy*cy);
      if (md > 0.05) {
        vel.x += (( cy/md)*0.0018 - vel.x)*0.07;
        vel.y += (( cx/md)*0.0018 - vel.y)*0.07;
      } else {
        vel.x += (AUTO.x - vel.x)*0.025;
        vel.y += (AUTO.y - vel.y)*0.025;
      }
      rot.x += vel.x; rot.y += vel.y;

      const mxPx = mouse.current.x * W;
      const myPx = mouse.current.y * H;
      const sc   = scaleRef.current;

      const rp = xyz => {
        let v = rotX(xyz, rot.x);
        v = rotY(v, rot.y);
        return projectSphere(v, W, H, sc);
      };

      // ── Real Hipparcos stars with accurate colour + size ──────────────────
      // mag: apparent magnitude (lower = brighter, Sirius = -1.46, limit = 6)
      // size: brighter stars get larger radii, scaled by horizon alpha
      // colour: from B-V index via bvToRgb — blue giants → white → yellow → red
      for (const s of (starsRef.current ?? [])) {
        s.twinklePhase += s.twinkleSpeed;
        const p = rp(s.xyz);
        if (!p.visible) continue;
        const twinkle   = 0.88 + 0.12 * Math.sin(s.twinklePhase);
        // Radius: magnitude 6 → ~0.4px, magnitude -1.5 → ~3.5px
        const r  = Math.max(0.3, (3.8 - s.mag * 0.52) * twinkle * p.alpha);
        // Opacity: bright stars more opaque; faint ones wispy
        const al = Math.min(0.95, Math.max(0.05, (7 - s.mag) / 9) * p.alpha);
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${s.cr},${s.cg},${s.cb},${al})`;
        ctx.fill();

        // Glow halo for bright stars (mag < 2)
        if (s.mag < 2 && p.alpha > 0.3) {
          const gr  = r * 4;
          const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, gr);
          grd.addColorStop(0, `rgba(${s.cr},${s.cg},${s.cb},${al * 0.35})`);
          grd.addColorStop(1, `rgba(${s.cr},${s.cg},${s.cb},0)`);
          ctx.beginPath(); ctx.arc(p.x, p.y, gr, 0, Math.PI * 2);
          ctx.fillStyle = grd; ctx.fill();
        }
      }

      const cons = consRef.current;
      if (!cons?.length) { animRef.current = requestAnimationFrame(draw); return; }

      // Constellation lines + vertex dots
      for (const con of cons) {
        for (const seg of con.segments) {
          if (seg.length < 2) continue;
          const projected = seg.map(pt => rp(pt.xyz));

          ctx.beginPath();
          let started = false;
          for (let i = 0; i < projected.length; i++) {
            const p = projected[i];
            if (!p.visible) { started = false; continue; }
            if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y);
          }
          const vis  = projected.filter(p => p.visible);
          const avgA = vis.length ? vis.reduce((s, p) => s + p.alpha, 0) / vis.length : 0;
          ctx.strokeStyle = `rgba(160,190,255,${avgA*0.38})`;
          ctx.lineWidth = 0.9; ctx.stroke();

          for (const p of projected) {
            if (!p.visible) continue;
            const ddx = p.x - mxPx, ddy = p.y - myPx;
            const d   = Math.sqrt(ddx*ddx + ddy*ddy);
            const pop = Math.max(0, 1 - d/140);
            const r   = Math.max(0.5, 1.3*p.alpha + pop*3.5);
            const al  = Math.min(1, 0.65*p.alpha + pop*0.5);
            const cr  = Math.round(215 + pop*(100-215));
            const cg  = Math.round(230 + pop*(60-230));
            if (pop > 0.15) {
              const gr  = r*5 + pop*10;
              const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, gr);
              grd.addColorStop(0, `rgba(${cr},${cg},255,${al*0.4})`);
              grd.addColorStop(1, "rgba(100,130,255,0)");
              ctx.beginPath(); ctx.arc(p.x, p.y, gr, 0, Math.PI*2);
              ctx.fillStyle = grd; ctx.fill();
            }
            ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI*2);
            ctx.fillStyle = `rgba(${cr},${cg},255,${al})`; ctx.fill();
          }
        }
      }

      // Labels
      if (sc > 0.5) {
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.font = "300 16px 'Inter', 'Helvetica Neue', sans-serif";
        const labelOpacity = Math.min(1, (sc - 0.5) / 0.35);

        for (const con of cons) {
          let labelP = con.labelXyz ? rp(con.labelXyz) : null;
          if (!labelP?.visible) {
            let sumX=0, sumY=0, sumA=0, n=0;
            for (const seg of con.segments) for (const pt of seg) {
              const p = rp(pt.xyz);
              if (p.visible) { sumX+=p.x; sumY+=p.y; sumA+=p.alpha; n++; }
            }
            if (n > 0) labelP = { x:sumX/n, y:sumY/n, alpha:sumA/n, visible:true };
          }
          if (!labelP?.visible || labelP.alpha < 0.08) continue;

          const fadeA = Math.min(1, labelP.alpha * 1.6) * labelOpacity;
          const yPos  = labelP.y - 7;
          ctx.shadowColor = `rgba(100,150,255,${fadeA * 0.5})`;
          ctx.shadowBlur  = 8;
          ctx.fillStyle   = `rgba(180,205,255,${fadeA * 0.48})`;
          ctx.fillText(con.id, labelP.x, yPos);
          ctx.shadowBlur  = 0;
        }
        ctx.restore();
      }

      animRef.current = requestAnimationFrame(draw);
    };

    resize(); draw();
    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchmove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchmove", onMove);
    };
  }, []);

  return <canvas ref={canvasRef} style={{ position:"absolute", inset:0, width:"100%", height:"100%", zIndex:0 }} />;
}

// ── Grid Distortion ───────────────────────────────────────────────────────────
function GridDistortion() {
  const canvasRef = useRef(null);
  const mouse     = useRef({ x:0.5, y:0.5 });
  const lagged    = useRef({ x:0.5, y:0.5 });
  const animRef   = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx    = canvas.getContext("2d");
    let W, H;
    const G = 18;
    const onMove = e => {
      const pt = e.touches ? e.touches[0] : e;
      mouse.current = { x: pt.clientX/W, y: pt.clientY/H };
    };
    const resize = () => { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; };
    const draw = () => {
      ctx.clearRect(0,0,W,H);
      lagged.current.x += (mouse.current.x - lagged.current.x)*0.04;
      lagged.current.y += (mouse.current.y - lagged.current.y)*0.04;
      const mx = lagged.current.x*W, my = lagged.current.y*H;
      ctx.strokeStyle = "rgba(90,130,255,0.04)"; ctx.lineWidth = 1;
      const cols = Math.ceil(W/G)+1, rows = Math.ceil(H/G)+1;
      const wp = (gx, gy) => {
        const wx=gx*G, wy=gy*G, dx=wx-mx, dy=wy-my, d=Math.sqrt(dx*dx+dy*dy);
        if (d < 190 && d > 0) { const s=(1-d/190)*48; return [wx+(dx/d)*s, wy+(dy/d)*s]; }
        return [wx, wy];
      };
      for (let r=0; r<rows; r++) { ctx.beginPath(); for (let c=0; c<cols; c++) { const [x,y]=wp(c,r); c===0?ctx.moveTo(x,y):ctx.lineTo(x,y); } ctx.stroke(); }
      for (let c=0; c<cols; c++) { ctx.beginPath(); for (let r=0; r<rows; r++) { const [x,y]=wp(c,r); r===0?ctx.moveTo(x,y):ctx.lineTo(x,y); } ctx.stroke(); }
      animRef.current = requestAnimationFrame(draw);
    };
    resize(); draw();
    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchmove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchmove", onMove);
    };
  }, []);

  return <canvas ref={canvasRef} style={{ position:"absolute", inset:0, width:"100%", height:"100%", zIndex:1 }} />;
}

// ── Hero ──────────────────────────────────────────────────────────────────────
export default function Hero() {
  const [constellations, setConstellations] = useState([]);
  const [stars,          setStars         ] = useState([]);
  const [projScale, setProjScale] = useState(0.28);
  const [phase, setPhase] = useState("intro");
  const animFrameRef = useRef(null);

  useEffect(() => {
    loadConstellations().then(setConstellations).catch(console.error);
    loadStars().then(setStars).catch(console.error);
  }, []);

  useEffect(() => {
    const t1 = setTimeout(() => {
      setPhase("settling");

      const ZOOM_DURATION = 2400;
      const START = 0.28, END = 0.95;
      const t0 = performance.now();

      const animate = now => {
        const elapsed = now - t0;
        const t       = Math.min(1, elapsed / ZOOM_DURATION);
        setProjScale(START + (END - START) * easeInOutCubic(t));
        if (t < 1) {
          animFrameRef.current = requestAnimationFrame(animate);
        } else {
          setPhase("done");
        }
      };
      animFrameRef.current = requestAnimationFrame(animate);
    }, 1800);

    return () => {
      clearTimeout(t1);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  const isIntro    = phase === "intro";
  const isSettling = phase === "settling" || phase === "done";

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400&family=Montserrat:wght@700&family=Nunito:wght@400;600&display=swap');

        *, *::before, *::after { box-sizing: border-box; }

        .hero-nav-link {
          color: rgba(175,200,252,0.4);
          text-decoration: none;
          font-family: 'Gotham Rounded', 'Nunito', 'Inter', sans-serif;
          font-size: 12px;
          font-weight: 400;
          letter-spacing: 0.1em;
          text-transform: lowercase;
          transition: color 0.25s ease;
        }
        .hero-nav-link:hover {
          color: rgba(175,200,252,0.85);
        }

        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeInOnly {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>

      <section style={{
        position:"relative", width:"100%", height:"100vh",
        background:"radial-gradient(ellipse at 44% 46%, #060918 0%, #020407 100%)",
        overflow:"hidden",
      }}>
        <StarGlobe constellations={constellations} stars={stars} projScale={projScale} />
        <GridDistortion />

        {/* ── Nav (above) + Title (below) as one left-middle unit ── */}
        <div style={{
          position:"absolute",
          top:"50%",
          left: isSettling ? "clamp(28px, 5vw, 64px)" : "50%",
          transform: isSettling ? "translateY(-50%)" : "translate(-50%, -50%)",
          zIndex:20,
          display:"flex",
          flexDirection:"column",
          gap:"14px",
          transition:"left 0.8s cubic-bezier(0.7,0,0.3,1), transform 0.8s cubic-bezier(0.7,0,0.3,1)",
          pointerEvents: isSettling ? "auto" : "none",
        }}>
          {/* Nav above — fades in after intro */}
          <nav style={{
            display:"flex", gap:"clamp(16px, 2.5vw, 28px)", alignItems:"center",
            opacity: isSettling ? 1 : 0,
            transition: "opacity 0.6s ease 0.2s",
          }}>
            {["about","portfolio","blog","contact"].map((label, i) => (
              <a
                key={label}
                href={`#${label}`}
                className="hero-nav-link"
                style={{
                  animation: isSettling ? `fadeInUp 0.6s ease ${i * 60 + 80}ms both` : "none",
                }}
              >
                {label}
              </a>
            ))}
          </nav>

          {/* Title — always visible */}
          <h1 style={{
            fontFamily:"'Proxima Nova', 'Montserrat', 'Inter', sans-serif",
            fontWeight:700,
            fontSize:"clamp(32px, 5vw, 64px)",
            color:"rgba(210,225,252,0.88)",
            letterSpacing:"0.04em",
            textTransform:"lowercase",
            margin:0,
            lineHeight:1,
            whiteSpace:"nowrap",
            animation:"fadeInOnly 1.1s ease both",
            pointerEvents:"none",
          }}>
            yahayabb
          </h1>
        </div>
      </section>
    </>
  );
}