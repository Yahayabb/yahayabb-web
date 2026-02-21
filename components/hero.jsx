"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";           // ← added

const TEXT = "yahayabb";
const FONT = "'Proxima Nova', 'Montserrat', 'Helvetica Neue', Helvetica, Arial, sans-serif";

function easeOut3(t)   { return 1 - Math.pow(1 - t, 3); }
function easeInOut3(t) { return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2; }
function clamp(v,a,b)  { return Math.max(a, Math.min(b, v)); }
function norm(t, s, d) { return clamp((t - s) / d, 0, 1); }
function lerp(a, b, t) { return a + (b - a) * t; }

function raDecToXYZ(raDeg, decDeg) {
  const ra  = (raDeg  * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  return { x: Math.cos(dec)*Math.cos(ra), y: Math.sin(dec), z: Math.cos(dec)*Math.sin(ra) };
}
function rotX(v, a) { const c=Math.cos(a),s=Math.sin(a); return {x:v.x,y:c*v.y-s*v.z,z:s*v.y+c*v.z}; }
function rotY(v, a) { const c=Math.cos(a),s=Math.sin(a); return {x:c*v.x+s*v.z,y:v.y,z:-s*v.x+c*v.z}; }
function projectSphere(v, W, H, scale) {
  const sc = Math.min(W,H)*(scale??0.95);
  return { x:W/2+v.x*sc, y:H/2-v.y*sc, z:v.z, visible:v.z>-0.05, alpha:Math.max(0,v.z) };
}
function lonLatToRaDec([lon,lat]) { let ra=-lon; if(ra<0) ra+=360; return [ra,lat]; }

function bvToRgb(bv) {
  const t = Math.max(-0.4, Math.min(2.0, bv));
  let r, g, b;
  if (t < 0.40)      r = 0.55 + 0.08*t + 0.08*t*t;
  else if (t < 1.50) r = 0.78 + (0.22*(t-0.40))/(1.10);
  else               r = 1.00;
  r = clamp(r, 0, 1);
  if (t < 0.00)      g = 0.60 + 0.05*t + 0.9*t*t;
  else if (t < 0.40) g = 0.82 + 0.60*t - 1.0*t*t;
  else if (t < 1.60) g = 0.96 - 0.32*(t-0.40)/(1.20);
  else               g = Math.max(0, 0.64 - (t-1.60));
  g = clamp(g, 0, 1);
  if (t < 0.40)      b = 1.00;
  else if (t < 1.50) b = Math.max(0, 1.00 - (t-0.40)/(1.10));
  else               b = 0;
  b = clamp(b, 0, 1);
  const mid = (r + g + b) / 3;
  const SAT = 1.55;
  r = clamp(mid + (r - mid) * SAT, 0, 1);
  g = clamp(mid + (g - mid) * SAT, 0, 1);
  b = clamp(mid + (b - mid) * SAT, 0, 1);
  return [Math.round(r*255), Math.round(g*255), Math.round(b*255)];
}

const LINES_URL = "https://cdn.jsdelivr.net/gh/ofrohn/d3-celestial@master/data/constellations.lines.json";
const NAMES_URL = "https://cdn.jsdelivr.net/gh/ofrohn/d3-celestial@master/data/constellations.json";
const STARS_URL = "https://cdn.jsdelivr.net/gh/ofrohn/d3-celestial@master/data/stars.6.json";

async function loadStars() {
  const res=await fetch(STARS_URL), data=await res.json();
  return data.features.map(f => {
    const [lon,lat]=f.geometry.coordinates; let ra=-lon; if(ra<0) ra+=360;
    const mag=f.properties.mag, bv=f.properties.bv??0.6, [cr,cg,cb]=bvToRgb(bv);
    return { xyz:raDecToXYZ(ra,lat), mag, cr, cg, cb, bv, twinklePhase:Math.random()*Math.PI*2, twinkleSpeed:0.008+Math.random()*0.014 };
  });
}

// starR/G/B  = exact same colour drawn for the star dot (s.cr/cg/cb)
// lineR/G/B  = pastel tint of that hue, for hover line strokes
// labelR/G/B = slightly brightened, for labels
function assignConstellationColours(constellations, stars) {
  for (const con of constellations) {
    const nodes = con.segments.flat();
    if (!nodes.length) continue;

    let bestMag = 99;
    let sr = 180, sg = 210, sb = 255; // fallback cool blue-white

    for (const node of nodes) {
      const nx = node.xyz.x, ny = node.xyz.y, nz = node.xyz.z;
      for (const s of stars) {
        if (s.mag > 5) continue;
        const dx = s.xyz.x - nx, dy = s.xyz.y - ny, dz = s.xyz.z - nz;
        const d2 = dx*dx + dy*dy + dz*dz;
        if (d2 < 0.08 && s.mag < bestMag) {
          bestMag = s.mag;
          sr = s.cr; sg = s.cg; sb = s.cb; // exact star colour, unchanged
        }
      }
    }

    // Node pulses: exact star colour
    con.starR = sr; con.starG = sg; con.starB = sb;

    // Lines: pastel — 60% toward a cool off-white
    con.lineR = Math.round(lerp(sr, 210, 0.60));
    con.lineG = Math.round(lerp(sg, 228, 0.60));
    con.lineB = Math.round(lerp(sb, 255, 0.60));

    // Labels: 20% toward white for legibility
    con.labelR = Math.round(lerp(sr, 230, 0.20));
    con.labelG = Math.round(lerp(sg, 240, 0.20));
    con.labelB = Math.round(lerp(sb, 255, 0.20));
  }
}

async function loadConstellations() {
  const [lR,nR]=await Promise.all([fetch(LINES_URL),fetch(NAMES_URL)]);
  const linesGeo=await lR.json(), namesGeo=await nR.json();
  const labelPos={};
  for(const f of namesGeo.features) if(f.geometry?.coordinates) {
    const [ra,dec]=lonLatToRaDec(f.geometry.coordinates); labelPos[f.id]={ra,dec};
  }
  return linesGeo.features.map(f => {
    const segments=f.geometry.coordinates.map(line=>line.map(([lon,lat])=>{ const [ra,dec]=lonLatToRaDec([lon,lat]); return {xyz:raDecToXYZ(ra,dec)}; }));
    const lp=labelPos[f.id];
    return {
      id:f.id, segments, labelXyz:lp?raDecToXYZ(lp.ra,lp.dec):null,
      hoverT: 0, pulsePhase: 0,
      starR: 180, starG: 210, starB: 255,
      lineR: 210, lineG: 228, lineB: 255,
      labelR: 210, labelG: 228, labelB: 255,
    };
  });
}

function StarGlobe({ constellations, stars, projScale }) {
  const canvasRef = useRef(null);
  const mouse     = useRef({x:0.5, y:0.5});
  const animRef   = useRef(null);
  const consRef   = useRef(constellations);
  const starsRef  = useRef(stars);
  const scaleRef  = useRef(projScale);

  useEffect(()=>{ consRef.current=constellations; },[constellations]);
  useEffect(()=>{ starsRef.current=stars; },[stars]);
  useEffect(()=>{ scaleRef.current=projScale; },[projScale]);

  useEffect(()=>{
    const canvas=canvasRef.current, ctx=canvas.getContext("2d"); let W,H;
    const rot={x:0.15,y:0.0}, vel={x:0.0,y:0.0}, AUTO={x:-0.00045,y:0.001};

    const onMove=e=>{
      const pt=e.touches?e.touches[0]:e;
      mouse.current={x:pt.clientX/window.innerWidth, y:pt.clientY/window.innerHeight};
    };
    const resize=()=>{ W=canvas.width=window.innerWidth; H=canvas.height=window.innerHeight; };

    const draw=()=>{
      ctx.clearRect(0,0,W,H);

      const cx=mouse.current.x-0.5, cy=mouse.current.y-0.5, md=Math.sqrt(cx*cx+cy*cy);
      const isMob = W < 640;
      const velMult = isMob ? 0.0032 : 0.0018;
      const velSmooth = isMob ? 0.10 : 0.07;
      if(md>0.05){ vel.x+=((cy/md)*velMult-vel.x)*velSmooth; vel.y+=((cx/md)*velMult-vel.y)*velSmooth; }
      else        { vel.x+=(AUTO.x-vel.x)*0.025;              vel.y+=(AUTO.y-vel.y)*0.025; }
      rot.x+=vel.x; rot.y+=vel.y;

      const mxPx=mouse.current.x*W, myPx=mouse.current.y*H, sc=scaleRef.current;
      const rp = xyz => { let v=rotX(xyz,rot.x); v=rotY(v,rot.y); return projectSphere(v,W,H,sc); };

      // ── 1. Constellation lines & node glow (drawn UNDERNEATH stars)
      const cons = consRef.current ?? [];
      const HOVER_RADIUS = 90;
      let nearestCon = null, nearestDist = Infinity;

      const allProjected = cons.map(con => {
        const segs = con.segments.map(seg => seg.map(pt => rp(pt.xyz)));
        for(const seg of segs) for(const p of seg) {
          if(!p.visible) continue;
          const dx=p.x-mxPx, dy=p.y-myPx, d=Math.sqrt(dx*dx+dy*dy);
          if(d < nearestDist){ nearestDist=d; if(d<HOVER_RADIUS) nearestCon=con; }
        }
        return segs;
      });

      for(let i=0;i<cons.length;i++){
        const con = cons[i];
        const isHovered = con === nearestCon;
        const speed = isHovered ? 0.06 : 0.035;
        con.hoverT = clamp(con.hoverT + (isHovered ? speed : -speed), 0, 1);
        if(isHovered || con.hoverT > 0) con.pulsePhase += 0.07;
      }

      for(let i=0;i<cons.length;i++){
        const con  = cons[i];
        const segs = allProjected[i];
        const h    = easeOut3(con.hoverT);
        // Three distinct colour roles:
        const sr=con.starR, sg=con.starG, sb=con.starB;   // exact star colour → node pulses
        const lr=con.lineR, lg=con.lineG, lb=con.lineB;   // pastel → line stroke
        const lbr=con.labelR, lbg=con.labelG, lbb=con.labelB; // brightened → labels

        // Lines only in this first pass
        for(const seg of segs){
          if(seg.length<2) continue;
          ctx.beginPath(); let started=false;
          for(const p of seg){
            if(!p.visible){ started=false; continue; }
            if(!started){ ctx.moveTo(p.x,p.y); started=true; } else ctx.lineTo(p.x,p.y);
          }
          const vis=seg.filter(p=>p.visible);
          const avgA=vis.length ? vis.reduce((s,p)=>s+p.alpha,0)/vis.length : 0;

          ctx.strokeStyle=`rgba(160,190,255,${avgA*0.38})`;
          ctx.lineWidth=0.9;
          ctx.stroke();

          if(h > 0){
            ctx.save();
            ctx.shadowColor=`rgba(${lr},${lg},${lb},${h*0.75})`;
            ctx.shadowBlur=12*h;
            ctx.strokeStyle=`rgba(${lr},${lg},${lb},${avgA*(0.45+0.55*h)})`;
            ctx.lineWidth=0.9+1.8*h;
            ctx.stroke();
            ctx.restore();
          }
        }
      }

      // Build a lookup of active constellation node screen positions for star glow boosting
      const activeNodes = [];
      for(let i=0;i<cons.length;i++){
        const con = cons[i];
        if(con.hoverT <= 0) continue;
        const h = easeOut3(con.hoverT);
        for(const seg of allProjected[i])
          for(const p of seg)
            if(p.visible) activeNodes.push({ x:p.x, y:p.y, h, pulse: 0.5+0.5*Math.sin(con.pulsePhase) });
      }

      // ── 2. Stars — drawn on top of all line glow
      for(const s of (starsRef.current??[])){
        s.twinklePhase += s.twinkleSpeed;
        const p = rp(s.xyz); if(!p.visible) continue;
        const tw  = 0.88 + 0.12*Math.sin(s.twinklePhase);
        const r   = Math.max(0.35, (4.2 - s.mag*0.55)*tw*p.alpha);
        const al  = Math.min(1.0, Math.max(0.08, (7.5-s.mag)/7.5)*p.alpha);

        // Check if this star is near any active constellation node
        let nodeH = 0, nodePulse = 0;
        for(const n of activeNodes){
          const dx=p.x-n.x, dy=p.y-n.y;
          if(dx*dx+dy*dy < 10*10){ // within 10px of a node
            if(n.h > nodeH){ nodeH=n.h; nodePulse=n.pulse; }
          }
        }

        // If near an active node, draw boosted bv-coloured glow first (underneath the dot)
        if(nodeH > 0){
          const isMobile = W < 640;
          const boostR = Math.max(r * (isMobile ? 7 : 12), (isMobile ? 4.5 : 7 - s.mag*0.5) * (1+nodePulse*0.6) * nodeH * p.alpha);
          const boostAl = nodeH * (0.85 + 0.4*nodePulse) * p.alpha;
          const bgrd = ctx.createRadialGradient(p.x,p.y,0, p.x,p.y,boostR);
          bgrd.addColorStop(0, `rgba(${s.cr},${s.cg},${s.cb},${boostAl})`);
          bgrd.addColorStop(0.4, `rgba(${s.cr},${s.cg},${s.cb},${boostAl*0.5})`);
          bgrd.addColorStop(1, `rgba(${s.cr},${s.cg},${s.cb},0)`);
          ctx.beginPath(); ctx.arc(p.x,p.y,boostR,0,Math.PI*2);
          ctx.fillStyle=bgrd; ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(p.x,p.y,r,0,Math.PI*2);
        ctx.fillStyle=`rgba(${s.cr},${s.cg},${s.cb},${al})`;
        ctx.fill();

        if(s.mag < 4 && p.alpha > 0.15){
          const isBright = s.mag < 2;
          const gr  = isBright ? r*7 : r*4.5;
          const ga  = isBright ? al*0.55 : al*0.28;
          const grd = ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,gr);
          grd.addColorStop(0, `rgba(${s.cr},${s.cg},${s.cb},${ga})`);
          grd.addColorStop(1, `rgba(${s.cr},${s.cg},${s.cb},0)`);
          ctx.beginPath(); ctx.arc(p.x,p.y,gr,0,Math.PI*2);
          ctx.fillStyle=grd; ctx.fill();

          if(isBright && p.alpha > 0.4){
            const spikeLen = r * 9;
            ctx.save();
            ctx.strokeStyle=`rgba(${s.cr},${s.cg},${s.cb},${al*0.18})`;
            ctx.lineWidth=0.8;
            ctx.beginPath(); ctx.moveTo(p.x-spikeLen,p.y); ctx.lineTo(p.x+spikeLen,p.y); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(p.x,p.y-spikeLen); ctx.lineTo(p.x,p.y+spikeLen); ctx.stroke();
            ctx.restore();
          }
        }
      }

      // ── 3. Constellation node glow blobs — drawn on top of stars
      for(let i=0;i<cons.length;i++){
        const con  = cons[i];
        const segs = allProjected[i];
        const h    = easeOut3(con.hoverT);
        if(h <= 0) continue;
        const sr=con.starR, sg=con.starG, sb=con.starB;

        for(const seg of segs){
          for(const p of seg){
            if(!p.visible) continue;

            // Glow blob in constellation's star colour — kept subtle
            const pulse = 0.5 + 0.5*Math.sin(con.pulsePhase);
            const pulseR = (1.5 + 2.5*h + 2*h*pulse) * p.alpha;
            const pulseAl = h * 0.35 * p.alpha;
            const pgrd = ctx.createRadialGradient(p.x,p.y,pulseR*0.2, p.x,p.y,pulseR);
            pgrd.addColorStop(0, `rgba(${sr},${sg},${sb},${pulseAl})`);
            pgrd.addColorStop(0.5, `rgba(${sr},${sg},${sb},${pulseAl*0.4})`);
            pgrd.addColorStop(1, `rgba(${sr},${sg},${sb},0)`);
            ctx.beginPath(); ctx.arc(p.x,p.y,pulseR,0,Math.PI*2);
            ctx.fillStyle=pgrd; ctx.fill();

            // Crisp bright centre dot
            ctx.beginPath(); ctx.arc(p.x, p.y, 2.0*h*p.alpha, 0, Math.PI*2);
            ctx.fillStyle=`rgba(${sr},${sg},${sb},${h*p.alpha})`;
            ctx.fill();

            // Expanding ring
            const r2scale = 0.5 + 0.5*Math.sin(con.pulsePhase * 0.5);
            const r2 = pulseR * 1.7 * r2scale;
            if(r2 > 1){
              ctx.beginPath(); ctx.arc(p.x,p.y,r2,0,Math.PI*2);
              ctx.strokeStyle=`rgba(${sr},${sg},${sb},${h*0.22*p.alpha*(1-r2scale)})`;
              ctx.lineWidth=1;
              ctx.stroke();
            }
          }
        }
      }

      // ── 4. Labels (drawn last, on top of everything)
      if(sc > 0.5){
        const lo = Math.min(1,(sc-0.5)/0.35);

        // Hover labels
        for(let i=0;i<cons.length;i++){
          const con=cons[i];
          const h=easeOut3(con.hoverT);
          if(h <= 0.02) continue;
          const segs=allProjected[i];
          let lp=con.labelXyz?rp(con.labelXyz):null;
          if(!lp?.visible){
            let sx=0,sy=0,sa=0,n=0;
            for(const seg of segs) for(const p of seg){ if(p.visible){sx+=p.x;sy+=p.y;sa+=p.alpha;n++;} }
            if(n>0) lp={x:sx/n,y:sy/n,alpha:sa/n,visible:true};
          }
          if(!lp?.visible||lp.alpha<0.08) continue;
          const fa=Math.min(1,lp.alpha*1.6)*lo*h;
          const {labelR:lbr,labelG:lbg,labelB:lbb}=con;
          ctx.save();
          ctx.textAlign="center"; ctx.textBaseline="bottom";
          ctx.font="300 16px 'Inter','Helvetica Neue',sans-serif";
          ctx.shadowColor=`rgba(${lbr},${lbg},${lbb},${fa*0.95})`; ctx.shadowBlur=16;
          ctx.fillStyle=`rgba(${lbr},${lbg},${lbb},${fa})`; ctx.fillText(con.id,lp.x,lp.y-7);
          ctx.restore();
        }

        // Idle labels
        ctx.save(); ctx.textAlign="center"; ctx.textBaseline="bottom";
        ctx.font="300 16px 'Inter','Helvetica Neue',sans-serif";
        for(let i=0;i<cons.length;i++){
          const con=cons[i]; if(con.hoverT > 0.02) continue;
          const segs=allProjected[i];
          let lp=con.labelXyz?rp(con.labelXyz):null;
          if(!lp?.visible){
            let sx=0,sy=0,sa=0,n=0;
            for(const seg of segs) for(const p of seg){ if(p.visible){sx+=p.x;sy+=p.y;sa+=p.alpha;n++;} }
            if(n>0) lp={x:sx/n,y:sy/n,alpha:sa/n,visible:true};
          }
          if(!lp?.visible||lp.alpha<0.08) continue;
          const fa=Math.min(1,lp.alpha*1.6)*lo;
          ctx.shadowColor=`rgba(100,150,255,${fa*0.5})`; ctx.shadowBlur=8;
          ctx.fillStyle=`rgba(180,205,255,${fa*0.48})`; ctx.fillText(con.id,lp.x,lp.y-7);
          ctx.shadowBlur=0;
        }
        ctx.restore();
      }

      animRef.current=requestAnimationFrame(draw);
    };

    resize(); draw();
    window.addEventListener("resize",resize);
    window.addEventListener("mousemove",onMove);
    window.addEventListener("touchmove",onMove,{passive:true});
    return()=>{
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize",resize);
      window.removeEventListener("mousemove",onMove);
      window.removeEventListener("touchmove",onMove);
    };
  },[]);

  return <canvas ref={canvasRef} style={{position:"absolute",inset:0,width:"100%",height:"100%",zIndex:0}}/>;
}

const LS_START = 100;
const LS_END   =   2;
const SC_START = 1.5;
const SC_END   = 1.00;
const TL = { lineIn:{start:0.0,dur:0.35}, split:{start:0.35,dur:2.2}, end:3.0 };

export default function Hero() {
  const [constellations, setConstellations] = useState([]);
  const [stars,          setStars         ] = useState([]);
  const [projScale,      setProjScale     ] = useState(0.28);
  const [heroSettled,    setHeroSettled   ] = useState(false);
  const [textPhase,      setTextPhase     ] = useState("splash");
  const [navVisible,     setNavVisible    ] = useState(false);

  const splashCanvasRef = useRef(null);
  const splashState = useRef({
    opacity: 0, scale: SC_START, fontSize: 80,
    letterSpacing: LS_START, clipFraction: 0,
    lineOpacity: 0, lineOffset: 0,
    mode: "splash", posX: 0, posY: 0,
    fillColor: "255,255,255", strokeWidth: 1.5,
  });

  const placeholderRef = useRef(null);
  const rafRef         = useRef(null);
  const animFrameRef   = useRef(null);
  const overlayRef     = useRef(null);

  useEffect(() => {
    Promise.all([loadStars(), loadConstellations()]).then(([loadedStars, loadedCons]) => {
      assignConstellationColours(loadedCons, loadedStars);
      setStars(loadedStars);
      setConstellations(loadedCons);
    }).catch(console.error);
  }, []);

  // Splash canvas draw loop
  useEffect(() => {
    const canvas = splashCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let W, H, rafId;

    const resize = () => { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; };
    resize();
    window.addEventListener("resize", resize);

    const drawSplash = () => {
      ctx.clearRect(0, 0, W, H);
      const ss = splashState.current;
      if (ss.mode === "done") { rafId = requestAnimationFrame(drawSplash); return; }

      ctx.save();

      if (ss.mode === "splash") {
        ctx.globalAlpha = ss.opacity;
        ctx.translate(W / 2, H / 2);
        ctx.scale(ss.scale, ss.scale);
        ctx.translate(-W / 2, -H / 2);

        const fs = ss.fontSize;
        ctx.font = `700 ${fs}px ${FONT}`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";

        const chars = TEXT.split("");
        const ls = ss.letterSpacing;
        const charWidths = chars.map(c => ctx.measureText(c).width);
        const totalW = charWidths.reduce((a,b)=>a+b,0) + ls * (chars.length - 1);
        const midY = H / 2;

        const charPositions = [];
        let curX = W / 2 - totalW / 2;
        chars.forEach((c, i) => {
          charPositions.push({ c, cx: curX + charWidths[i] / 2, w: charWidths[i] });
          curX += charWidths[i] + ls;
        });

        // Fill clipped to reveal band
        const halfBand = ss.clipFraction * (fs * 0.75);
        if (halfBand > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, midY - halfBand, W, halfBand * 2);
          ctx.clip();
          ctx.fillStyle = `rgba(255,255,255,1)`;
          charPositions.forEach(({ c, cx }) => ctx.fillText(c, cx, midY));
          ctx.restore();
        }

        // Stroke on top
        ctx.strokeStyle = `rgba(255,255,255,${ss.opacity})`;
        ctx.lineWidth = 1.5; ctx.lineJoin = "round";
        charPositions.forEach(({ c, cx }) => ctx.strokeText(c, cx, midY));

        // Lines
        if (ss.lineOpacity > 0) {
          const lineY1 = midY - ss.lineOffset, lineY2 = midY + ss.lineOffset;
          const grad = ctx.createLinearGradient(0, 0, W, 0);
          grad.addColorStop(0, "rgba(255,255,255,0)");
          grad.addColorStop(0.08, `rgba(255,255,255,${ss.lineOpacity})`);
          grad.addColorStop(0.92, `rgba(255,255,255,${ss.lineOpacity})`);
          grad.addColorStop(1, "rgba(255,255,255,0)");
          ctx.strokeStyle = grad; ctx.lineWidth = 1; ctx.globalAlpha = 1;
          [lineY1, lineY2].forEach(y => { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); });
        }

      } else if (ss.mode === "travel") {
        const fs = ss.fontSize, ls = ss.letterSpacing;
        ctx.font = `700 ${fs}px ${FONT}`;
        ctx.textAlign = "left"; ctx.textBaseline = "top";
        const chars = TEXT.split("");
        const charWidths = chars.map(c => ctx.measureText(c).width);
        ctx.fillStyle = `rgba(${ss.fillColor},${ss.opacity})`;
        ctx.strokeStyle = `rgba(255,255,255,${ss.strokeWidth > 0 ? ss.opacity : 0})`;
        ctx.lineWidth = ss.strokeWidth; ctx.lineJoin = "round";
        let curX = ss.posX;
        chars.forEach((c, i) => {
          ctx.fillText(c, curX, ss.posY);
          if (ss.strokeWidth > 0.05) ctx.strokeText(c, curX, ss.posY);
          curX += charWidths[i] + ls;
        });
      }

      ctx.restore();
      rafId = requestAnimationFrame(drawSplash);
    };

    rafId = requestAnimationFrame(drawSplash);
    return () => { cancelAnimationFrame(rafId); window.removeEventListener("resize", resize); };
  }, []);

  // Main animation sequence
  useEffect(() => {
    const OVERLAY_FADE_DURATION = 600;
    const TRAVEL_DURATION = 750;
    const ZOOM_DURATION = 2200;

    splashState.current.fontSize = Math.min(Math.max(window.innerWidth * 0.13, 48), 110);

    const startRef = { current: null };

    function splashTick(now) {
      if (!startRef.current) startRef.current = now;
      const t = (now - startRef.current) / 1000;
      const splitP = easeInOut3(norm(t, TL.split.start, TL.split.dur));
      splashState.current.opacity       = Math.min(1, splitP * 1.2);
      splashState.current.scale         = lerp(SC_START, SC_END, splitP);
      splashState.current.letterSpacing = lerp(LS_START, LS_END, splitP);
      splashState.current.clipFraction  = splitP;
      splashState.current.lineOpacity   = Math.max(0, easeOut3(norm(t, TL.lineIn.start, TL.lineIn.dur)) * (1 - splitP));
      splashState.current.lineOffset    = splitP * (splashState.current.fontSize * 0.75);

      if (t < TL.end) { rafRef.current = requestAnimationFrame(splashTick); return; }

      setHeroSettled(true);
      const t0 = performance.now();
      (function zoomAnimate(now) {
        const t = Math.min(1, (now - t0) / ZOOM_DURATION);
        setProjScale(0.28 + (0.95 - 0.28) * easeInOut3(t));
        if (t < 1) animFrameRef.current = requestAnimationFrame(zoomAnimate);
      })(performance.now());

      const fadeStart = performance.now();
      function overlayFade(now2) {
        const p = Math.min(1, (now2 - fadeStart) / OVERLAY_FADE_DURATION);
        if (overlayRef.current) overlayRef.current.style.opacity = 1 - easeOut3(p);
        if (p < 1) { rafRef.current = requestAnimationFrame(overlayFade); return; }
        if (overlayRef.current) overlayRef.current.style.display = "none";
        travelText();
      }
      rafRef.current = requestAnimationFrame(overlayFade);
    }

    function travelText() {
      const targetEl = placeholderRef.current;
      if (!targetEl) { setTextPhase("hero"); return; }

      function waitForSettle() {
        const isMobile = window.innerWidth < 640;
        if (isMobile) { doTravel(); return; } // mobile is always centered, skip check
        const r = targetEl.getBoundingClientRect();
        if (Math.abs(r.left + r.width / 2 - window.innerWidth / 2) < 5) {
          rafRef.current = requestAnimationFrame(waitForSettle); return;
        }
        doTravel();
      }

      function doTravel() {
        const toRect = placeholderRef.current.getBoundingClientRect();
        const toFontSize = parseFloat(getComputedStyle(placeholderRef.current).fontSize) || 40;
        const fromFontSize = splashState.current.fontSize;
        const tc = document.createElement("canvas").getContext("2d");
        tc.font = `700 ${fromFontSize}px ${FONT}`;
        const chars = TEXT.split("");
        const charWidths = chars.map(c => tc.measureText(c).width);
        const totalW = charWidths.reduce((a,b)=>a+b,0) + LS_END * (chars.length - 1);
        const fromX = window.innerWidth / 2 - totalW / 2;
        const fromY = window.innerHeight / 2 - fromFontSize * 0.75;

        splashState.current.mode = "travel";
        splashState.current.posX = fromX;
        splashState.current.posY = fromY;
        splashState.current.opacity = 1;
        splashState.current.strokeWidth = 1.5;

        const travelStart = performance.now();
        function travelTick(now) {
          const p = Math.min(1, (now - travelStart) / TRAVEL_DURATION);
          const e = easeInOut3(p);
          splashState.current.posX         = lerp(fromX, toRect.left, e);
          splashState.current.posY         = lerp(fromY, toRect.top,  e);
          splashState.current.fontSize     = lerp(fromFontSize, toFontSize, e);
          splashState.current.strokeWidth  = lerp(1.5, 0, e);
          splashState.current.letterSpacing = LS_END;
          splashState.current.fillColor    = `${Math.round(lerp(255,210,e))},${Math.round(lerp(255,225,e))},${Math.round(lerp(255,252,e))}`;
          splashState.current.opacity      = lerp(1, 0.88, e);
          if (p < 1) { rafRef.current = requestAnimationFrame(travelTick); return; }
          splashState.current.mode = "done";
          setTextPhase("hero");
          setNavVisible(true);
        }
        rafRef.current = requestAnimationFrame(travelTick);
      }

      rafRef.current = requestAnimationFrame(waitForSettle);
    }

    rafRef.current = requestAnimationFrame(splashTick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  const isHero = textPhase === "hero";

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400&family=Montserrat:wght@700&family=Nunito:wght@400;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; }
        .hero-nav-link { color:rgba(175,200,252,0.4); text-decoration:none; font-family:'Gotham Rounded','Nunito','Inter',sans-serif; font-size:15px; font-weight:400; letter-spacing:0.1em; text-transform:lowercase; transition:color 0.25s ease; }
        .hero-nav-link:hover { color:rgba(175,200,252,0.85); }
        @keyframes fadeInUp { from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);} }
        @media (min-width: 641px) {
          .hero-text-block nav { order: -1; }
          .blur-layer-mobile { display: none !important; }
        }
        @media (max-width: 640px) {
          .hero-text-block h1  { font-size: clamp(44px, 12vw, 80px) !important; text-align: center; min-width: 100%; }
          .hero-text-block nav { justify-content: center; }
          .blur-layer-desktop  { display: none !important; }
        }
      `}</style>

      <div ref={overlayRef} style={{position:"fixed",inset:0,zIndex:9999,backgroundColor:"#000",pointerEvents:"none"}}/>

      <canvas
        ref={splashCanvasRef}
        style={{
          position:"fixed", top:0, left:0, width:"100%", height:"100%",
          zIndex:10000, pointerEvents:"none",
          display: isHero ? "none" : "block",
        }}
      />

      <section style={{position:"relative",width:"100%",height:"100vh",background:"radial-gradient(ellipse at 44% 46%, #060918 0%, #020407 100%)",overflow:"hidden"}}>
        <StarGlobe constellations={constellations} stars={stars} projScale={projScale} />

        {/* Gradual blur — left side, bulges widest at vertical centre where text lives.
            Each layer is a pure backdrop-filter with NO background colour.
            A 2D mask (radial on vertical axis × linear on horizontal) shapes the blur zone.
            Stacking 6 layers from faint→strong creates a smooth gradient of "frostiness". */}
        {[
          // [blur, horizontal reach, vertical mask]
          // horizontal reach: how far right the blur extends (as % of viewport width)
          // vertical mask: where blur is opaque — wider strip for stronger layers
          { blur:"2px",  w:"20%", vmask:"ellipse 100% 92% at 0% 50%" },
          { blur:"6px",  w:"26%", vmask:"ellipse 100% 80% at 0% 50%" },
          { blur:"14px", w:"32%", vmask:"ellipse 100% 68% at 0% 50%" },
          { blur:"28px", w:"38%", vmask:"ellipse 100% 56% at 0% 50%" },
          { blur:"48px", w:"43%", vmask:"ellipse 100% 44% at 0% 50%" },
          { blur:"72px", w:"48%", vmask:"ellipse 100% 34% at 0% 50%" },
        ].map(({ blur, w, vmask }, i) => (
          <div key={i} className="blur-layer-desktop" style={{
            position:"absolute", top:0, left:0,
            width: w, height:"100%",
            zIndex: 10,
            pointerEvents:"none",
            backdropFilter:`blur(${blur}) brightness(1.15)`,
            WebkitBackdropFilter:`blur(${blur}) brightness(1.15)`,
            // Horizontal fade: opaque on left, fades to transparent on right
            // Vertical fade: shaped by ellipse so it's widest at centre
            maskImage:`radial-gradient(${vmask}, black 0%, black 40%, transparent 100%), linear-gradient(to right, black 30%, transparent 100%)`,
            WebkitMaskImage:`radial-gradient(${vmask}, black 0%, black 40%, transparent 100%), linear-gradient(to right, black 30%, transparent 100%)`,
            maskComposite:"intersect",
            WebkitMaskComposite:"destination-in",
          }}/>
        ))}

        {/* Mobile blur — top band, widest horizontally in centre */}
        {[
          { blur:"2px",  h:"18%", hmask:"ellipse 90% 100% at 50% 0%" },
          { blur:"6px",  h:"24%", hmask:"ellipse 78% 100% at 50% 0%" },
          { blur:"14px", h:"30%", hmask:"ellipse 66% 100% at 50% 0%" },
          { blur:"28px", h:"36%", hmask:"ellipse 54% 100% at 50% 0%" },
          { blur:"48px", h:"40%", hmask:"ellipse 44% 100% at 50% 0%" },
          { blur:"72px", h:"44%", hmask:"ellipse 36% 100% at 50% 0%" },
        ].map(({ blur, h, hmask }, i) => (
          <div key={"m"+i} className="blur-layer-mobile" style={{
            position:"absolute", top:0, left:0,
            width:"100%", height: h,
            zIndex: 10,
            pointerEvents:"none",
            backdropFilter:`blur(${blur}) brightness(1.15)`,
            WebkitBackdropFilter:`blur(${blur}) brightness(1.15)`,
            maskImage:`radial-gradient(${hmask}, black 0%, black 40%, transparent 100%), linear-gradient(to bottom, black 30%, transparent 100%)`,
            WebkitMaskImage:`radial-gradient(${hmask}, black 0%, black 40%, transparent 100%), linear-gradient(to bottom, black 30%, transparent 100%)`,
            maskComposite:"intersect",
            WebkitMaskComposite:"destination-in",
          }}/>
        ))}

        <div className="hero-text-block" style={{
          position:"absolute",
          top:      heroSettled ? (window.innerWidth < 640 ? "clamp(32px, 8vw, 56px)" : "50%") : "50%",
          left:     heroSettled ? (window.innerWidth < 640 ? "50%"                     : "clamp(28px, 5vw, 64px)") : "50%",
          transform:heroSettled ? (window.innerWidth < 640 ? "translateX(-50%)"        : "translateY(-50%)") : "translate(-50%, -50%)",
          zIndex:20, display:"flex", flexDirection:"column", gap:"14px",
          alignItems: heroSettled && window.innerWidth < 640 ? "center" : "stretch",
          transition: heroSettled ? "none" : "left 0.8s cubic-bezier(0.7,0,0.3,1), transform 0.8s cubic-bezier(0.7,0,0.3,1)",
          pointerEvents: heroSettled ? "auto" : "none",
        }}>
          <h1 ref={placeholderRef} style={{
            fontFamily: FONT, fontWeight:700,
            fontSize:"clamp(32px, 5vw, 64px)",
            letterSpacing:"0.04em", textTransform:"lowercase",
            margin:0, lineHeight:1, whiteSpace:"nowrap",
            minWidth:"100%",
            userSelect:"none", pointerEvents:"none",
            color: isHero ? "rgba(210,225,252,0.88)" : "transparent",
          }}>
            {TEXT}
          </h1>

          <nav style={{display:"flex",gap:"clamp(20px, 3vw, 36px)",alignItems:"center",opacity:navVisible?1:0,transition:"opacity 0.6s ease 0.1s"}}>
            {["about","portfolio","blog","contact"].map((label,i)=>(
                <Link key={label} href={`/${label}`} className="hero-nav-link"
                style={{animation:navVisible?`fadeInUp 0.6s ease ${i*60+80}ms both`:"none"}}>{label}</Link>
            ))}
          </nav>
        </div>
      </section>
    </>
  );
}