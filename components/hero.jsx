"use client";
import { useEffect, useRef, useState } from "react";

// ── 3D rotation math (sphere still rotates in 3D) ────────────────────────────
function raDecToXYZ(raDeg, decDeg) {
  const ra  = (raDeg  * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  return {
    x: Math.cos(dec) * Math.cos(ra),
    y: Math.sin(dec),
    z: Math.cos(dec) * Math.sin(ra),
  };
}
function rotX(v, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: v.x, y: c * v.y - s * v.z, z: s * v.y + c * v.z };
}
function rotY(v, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: c * v.x + s * v.z, y: v.y, z: -s * v.x + c * v.z };
}

// ── Flat equirectangular projection ──────────────────────────────────────────
// After 3D rotation we convert XYZ back to spherical (az/alt),
// then map those angles linearly to screen pixels.
// This gives a flat map feel while the underlying data still rotates on a sphere.
function projectFlat(v, W, H) {
  // Extract spherical coords from rotated XYZ
  const dec = Math.asin(Math.clamp ? Math.clamp(v.y, -1, 1) : Math.max(-1, Math.min(1, v.y)));
  const ra  = Math.atan2(v.z, v.x); // -π..π

  // Only show the front hemisphere (ra near 0)
  // We use a soft visibility fade based on atan2 "depth"
  const depth = v.x; // positive = facing us (front of sphere)

  // Map: ra → X (horizontal), dec → Y (vertical)
  // Scale controls how much of the sphere is visible on screen
  const scaleX = W / (1.4 * Math.PI); // show ~252° of RA
  const scaleY = H / (1.1 * Math.PI); // show ~198° of Dec

  return {
    x: W / 2 + ra  * scaleX,
    y: H / 2 - dec * scaleY,
    z: depth,
    visible: depth > -0.08,
    alpha: Math.max(0, depth),  // fade stars near the edge
  };
}

// d3-celestial coordinate conversion
function lonLatToRaDec([lon, lat]) {
  let ra = -lon;
  if (ra < 0) ra += 360;
  return [ra, lat];
}

// ── Data fetching ─────────────────────────────────────────────────────────────
const LINES_URL = "https://cdn.jsdelivr.net/gh/ofrohn/d3-celestial@master/data/constellations.lines.json";
const NAMES_URL = "https://cdn.jsdelivr.net/gh/ofrohn/d3-celestial@master/data/constellations.json";

async function loadConstellations() {
  const [linesRes, namesRes] = await Promise.all([
    fetch(LINES_URL),
    fetch(NAMES_URL),
  ]);
  const linesGeo = await linesRes.json();
  const namesGeo = await namesRes.json();

  const nameMap  = {};
  const labelPos = {};
  for (const f of namesGeo.features) {
    nameMap[f.id] = f.properties?.en || f.properties?.name || f.id;
    if (f.geometry?.coordinates) {
      const [ra, dec] = lonLatToRaDec(f.geometry.coordinates);
      labelPos[f.id] = { ra, dec };
    }
  }

  const constellations = [];
  for (const f of linesGeo.features) {
    const id   = f.id;
    const name = nameMap[id] || id;
    const segments = [];

    for (const line of f.geometry.coordinates) {
      const pts = line.map(([lon, lat]) => {
        const [ra, dec] = lonLatToRaDec([lon, lat]);
        return { xyz: raDecToXYZ(ra, dec) };
      });
      segments.push(pts);
    }

    const lp = labelPos[id];
    const labelXyz = lp ? raDecToXYZ(lp.ra, lp.dec) : null;
    constellations.push({ id, name, segments, labelXyz });
  }

  return constellations;
}

// ── Star Globe ────────────────────────────────────────────────────────────────
function StarGlobe({ constellations }) {
  const canvasRef = useRef(null);
  const mouse     = useRef({ x: 0.5, y: 0.5 });
  const animRef   = useRef(null);
  const consRef   = useRef(constellations);

  useEffect(() => { consRef.current = constellations; }, [constellations]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx    = canvas.getContext("2d");
    let W, H;

    const rot  = { x: 0.15, y: 0.0 };
    const vel  = { x: 0.0,  y: 0.0 };
    const AUTO = { x: -0.00045, y: 0.001 };

    // Background filler stars
    const bgStars = Array.from({ length: 700 }, () => {
      const ra  = Math.random() * 360;
      const dec = (Math.asin(Math.random() * 2 - 1) * 180) / Math.PI;
      return {
        xyz: raDecToXYZ(ra, dec),
        mag: 2.5 + Math.random() * 2.8,
        twinklePhase: Math.random() * Math.PI * 2,
        twinkleSpeed: 0.01 + Math.random() * 0.018,
      };
    });

    const onMove = (e) => {
      const pt = e.touches ? e.touches[0] : e;
      mouse.current = {
        x: pt.clientX / window.innerWidth,
        y: pt.clientY / window.innerHeight,
      };
    };
    const resize = () => {
      W = canvas.width  = window.innerWidth;
      H = canvas.height = window.innerHeight;
    };

    const draw = () => {
      ctx.clearRect(0, 0, W, H);

      // Rotation driven by mouse or auto-drift
      const cx = mouse.current.x - 0.5;
      const cy = mouse.current.y - 0.5;
      const md = Math.sqrt(cx * cx + cy * cy);
      if (md > 0.05) {
        vel.x += ((-cy / md) * 0.0018 - vel.x) * 0.07;
        vel.y += (( cx / md) * 0.0018 - vel.y) * 0.07;
      } else {
        vel.x += (AUTO.x - vel.x) * 0.025;
        vel.y += (AUTO.y - vel.y) * 0.025;
      }
      rot.x += vel.x;
      rot.y += vel.y;

      const mxPx = mouse.current.x * W;
      const myPx = mouse.current.y * H;

      // Rotate XYZ then flat-project
      const rp = (xyz) => {
        let v = rotX(xyz, rot.x);
        v = rotY(v, rot.y);
        return projectFlat(v, W, H);
      };

      // ── Background stars ───────────────────────────────────────────────────
      for (const s of bgStars) {
        s.twinklePhase += s.twinkleSpeed;
        const p = rp(s.xyz);
        if (!p.visible) continue;
        const brightness = Math.max(0, 5.2 - s.mag);
        const twinkle    = 0.8 + 0.2 * Math.sin(s.twinklePhase);
        const r  = Math.max(0.25, (0.3 + brightness * 0.4) * twinkle * p.alpha);
        const al = Math.min(1, (0.1 + brightness * 0.1) * p.alpha);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(210,225,255,${al})`;
        ctx.fill();
      }

      const cons = consRef.current;
      if (!cons || cons.length === 0) {
        animRef.current = requestAnimationFrame(draw);
        return;
      }

      // ── Constellation lines ────────────────────────────────────────────────
      for (const con of cons) {
        for (const seg of con.segments) {
          if (seg.length < 2) continue;
          const projected = seg.map((pt) => rp(pt.xyz));

          // Draw line segment, breaking at visibility seams
          ctx.beginPath();
          let started = false;
          let prevP   = null;
          for (let i = 0; i < projected.length; i++) {
            const p = projected[i];
            if (!p.visible) { started = false; prevP = null; continue; }

            // Break line if there's a large screen-space jump (wrap-around seam)
            if (prevP && Math.abs(p.x - prevP.x) > W * 0.4) {
              started = false;
            }

            if (!started) { ctx.moveTo(p.x, p.y); started = true; }
            else ctx.lineTo(p.x, p.y);
            prevP = p;
          }
          const avgAlpha = projected.filter(p => p.visible).reduce((s, p) => s + p.alpha, 0) /
                           Math.max(1, projected.filter(p => p.visible).length);
          ctx.strokeStyle = `rgba(160,190,255,${avgAlpha * 0.38})`;
          ctx.lineWidth   = 0.9;
          ctx.stroke();

          // Star dots at vertices
          for (const p of projected) {
            if (!p.visible) continue;
            const ddx = p.x - mxPx, ddy = p.y - myPx;
            const d   = Math.sqrt(ddx * ddx + ddy * ddy);
            const pop = Math.max(0, 1 - d / 140);
            const r   = Math.max(0.5, 1.3 * p.alpha + pop * 3.5);
            const al  = Math.min(1, 0.65 * p.alpha + pop * 0.5);
            const cr  = Math.round(215 + pop * (100 - 215));
            const cg  = Math.round(230 + pop * ( 60 - 230));

            if (pop > 0.15) {
              const gr  = r * 5 + pop * 10;
              const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, gr);
              grd.addColorStop(0, `rgba(${cr},${cg},255,${al * 0.4})`);
              grd.addColorStop(1, "rgba(100,130,255,0)");
              ctx.beginPath();
              ctx.arc(p.x, p.y, gr, 0, Math.PI * 2);
              ctx.fillStyle = grd;
              ctx.fill();
            }
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${cr},${cg},255,${al})`;
            ctx.fill();
          }
        }
      }

      // ── Labels ────────────────────────────────────────────────────────────
      ctx.save();
      ctx.textAlign    = "center";
      ctx.textBaseline = "bottom";
      ctx.font = "300 9px 'Inter', system-ui, sans-serif";

      for (const con of cons) {
        let labelP = con.labelXyz ? rp(con.labelXyz) : null;

        if (!labelP?.visible) {
          // fallback: centroid of visible segment points
          let sumX = 0, sumY = 0, sumA = 0, n = 0;
          for (const seg of con.segments) {
            for (const pt of seg) {
              const p = rp(pt.xyz);
              if (p.visible) { sumX += p.x; sumY += p.y; sumA += p.alpha; n++; }
            }
          }
          if (n > 0) labelP = { x: sumX / n, y: sumY / n, alpha: sumA / n, visible: true };
        }

        if (!labelP?.visible || labelP.alpha < 0.1) continue;

        const yPos  = labelP.y - 6;
        const fadeA = Math.min(1, labelP.alpha * 1.5);
        ctx.shadowColor = `rgba(80,120,220,${fadeA * 0.6})`;
        ctx.shadowBlur  = 6;
        ctx.fillStyle   = `rgba(175,200,252,${fadeA * 0.52})`;
        ctx.fillText(con.name.toUpperCase(), labelP.x, yPos);
        ctx.shadowBlur  = 0;

        const tw = ctx.measureText(con.name.toUpperCase()).width;
        ctx.strokeStyle = `rgba(140,170,235,${fadeA * 0.15})`;
        ctx.lineWidth   = 0.4;
        ctx.beginPath();
        ctx.moveTo(labelP.x - tw / 2 - 4, yPos + 2);
        ctx.lineTo(labelP.x + tw / 2 + 4, yPos + 2);
        ctx.stroke();
      }

      ctx.restore();
      animRef.current = requestAnimationFrame(draw);
    };

    resize();
    draw();
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

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 0 }}
    />
  );
}

// ── Grid Distortion ───────────────────────────────────────────────────────────
function GridDistortion() {
  const canvasRef = useRef(null);
  const mouse     = useRef({ x: 0.5, y: 0.5 });
  const lagged    = useRef({ x: 0.5, y: 0.5 });
  const animRef   = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx    = canvas.getContext("2d");
    let W, H;
    const G = 18;

    const onMove = (e) => {
      const pt = e.touches ? e.touches[0] : e;
      mouse.current = { x: pt.clientX / W, y: pt.clientY / H };
    };
    const resize = () => {
      W = canvas.width  = window.innerWidth;
      H = canvas.height = window.innerHeight;
    };
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      lagged.current.x += (mouse.current.x - lagged.current.x) * 0.04;
      lagged.current.y += (mouse.current.y - lagged.current.y) * 0.04;
      const mx = lagged.current.x * W;
      const my = lagged.current.y * H;
      ctx.strokeStyle = "rgba(90,130,255,0.04)";
      ctx.lineWidth   = 1;
      const cols = Math.ceil(W / G) + 1;
      const rows = Math.ceil(H / G) + 1;
      const wp = (gx, gy) => {
        const wx = gx * G, wy = gy * G;
        const dx = wx - mx, dy = wy - my;
        const d  = Math.sqrt(dx * dx + dy * dy);
        if (d < 190 && d > 0) {
          const s = (1 - d / 190) * 48;
          return [wx + (dx / d) * s, wy + (dy / d) * s];
        }
        return [wx, wy];
      };
      for (let r = 0; r < rows; r++) {
        ctx.beginPath();
        for (let c = 0; c < cols; c++) {
          const [x, y] = wp(c, r);
          c === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      for (let c = 0; c < cols; c++) {
        ctx.beginPath();
        for (let r = 0; r < rows; r++) {
          const [x, y] = wp(c, r);
          r === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      animRef.current = requestAnimationFrame(draw);
    };

    resize();
    draw();
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

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 1 }}
    />
  );
}

// ── Hero ──────────────────────────────────────────────────────────────────────
export default function Hero() {
  const [constellations, setConstellations] = useState([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    loadConstellations()
      .then(setConstellations)
      .catch((e) => {
        console.error("Failed to load constellation data:", e);
        setError(true);
      });
  }, []);

  return (
    <section
      style={{
        position: "relative",
        width: "100%",
        height: "100vh",
        background: "radial-gradient(ellipse at 44% 46%, #060918 0%, #020407 100%)",
        overflow: "hidden",
      }}
    >
      <StarGlobe constellations={constellations} />
      <GridDistortion />
      {error && (
        <p style={{
          position: "absolute", bottom: 16, left: "50%",
          transform: "translateX(-50%)",
          color: "rgba(255,100,100,0.5)", fontSize: 11, zIndex: 10,
        }}>
          Could not load constellation data.
        </p>
      )}
    </section>
  );
}