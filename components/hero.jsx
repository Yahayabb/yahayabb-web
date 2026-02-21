"use client";

import { useEffect, useRef, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// ── Constants
// ─────────────────────────────────────────────────────────────────────────────
const TEXT = "yahayabb";
const FONT = "'Proxima Nova', 'Montserrat', 'Helvetica Neue', Helvetica, Arial, sans-serif";

// ─────────────────────────────────────────────────────────────────────────────
// ── Math helpers
// ─────────────────────────────────────────────────────────────────────────────
function easeOut3(t)   { return 1 - Math.pow(1 - t, 3); }
function easeInOut3(t) { return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2; }
function clamp(v,a,b)  { return Math.max(a, Math.min(b, v)); }
function norm(t, s, d) { return clamp((t - s) / d, 0, 1); }
function lerp(a, b, t) { return a + (b - a) * t; }

// ─────────────────────────────────────────────────────────────────────────────
// ── 3-D math
// ─────────────────────────────────────────────────────────────────────────────
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

// ── Vivid B-V colour mapping with boosted saturation
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

// ─────────────────────────────────────────────────────────────────────────────
// ── Data fetching
// ─────────────────────────────────────────────────────────────────────────────
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
      hoverT: 0,
      pulsePhase: 0,
      // Dominant colour of this constellation's brightest nearby star (set at runtime)
      glowR: 180, glowG: 210, glowB: 255,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ── SplashCanvas — draws the text on a <canvas> so outline + fill are
//    pixel-perfectly stacked with no layout-induced drift.
// ─────────────────────────────────────────────────────────────────────────────
function SplashCanvas({ canvasRef, textState }) {
  // textState is a ref, mutated imperatively by the animation loop
  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        top: 0, left: 0,
        width: "100%", height: "100%",
        zIndex: 10000,
        pointerEvents: "none",
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ── StarGlobe
// ─────────────────────────────────────────────────────────────────────────────
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
      if(md>0.05){ vel.x+=((cy/md)*0.0018-vel.x)*0.07; vel.y+=((cx/md)*0.0018-vel.y)*0.07; }
      else        { vel.x+=(AUTO.x-vel.x)*0.025;        vel.y+=(AUTO.y-vel.y)*0.025; }
      rot.x+=vel.x; rot.y+=vel.y;

      const mxPx=mouse.current.x*W, myPx=mouse.current.y*H, sc=scaleRef.current;
      const rp = xyz => { let v=rotX(xyz,rot.x); v=rotY(v,rot.y); return projectSphere(v,W,H,sc); };

      // ── Stars
      for(const s of (starsRef.current??[])){
        s.twinklePhase += s.twinkleSpeed;
        const p = rp(s.xyz); if(!p.visible) continue;
        const tw  = 0.88 + 0.12*Math.sin(s.twinklePhase);
        const r   = Math.max(0.35, (4.2 - s.mag*0.55)*tw*p.alpha);
        const al  = Math.min(1.0, Math.max(0.08, (7.5-s.mag)/7.5)*p.alpha);

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

      // ── Constellations
      const cons = consRef.current;
      if(!cons?.length){ animRef.current=requestAnimationFrame(draw); return; }

      const HOVER_RADIUS = 90;
      let nearestCon = null, nearestDist = Infinity;

      const allProjected = cons.map(con => {
        const segs = con.segments.map(seg => seg.map(pt => rp(pt.xyz)));
        for(const seg of segs){
          for(const p of seg){
            if(!p.visible) continue;
            const dx=p.x-mxPx, dy=p.y-myPx, d=Math.sqrt(dx*dx+dy*dy);
            if(d < nearestDist){ nearestDist=d; if(d<HOVER_RADIUS) nearestCon=con; }
          }
        }
        return segs;
      });

      // ── Assign constellation glow colour from its nearest bright star
      //    We do this lazily: once hoverT starts rising, sample the closest
      //    visible star within 120px of any node.
      const starList = starsRef.current ?? [];
      for(let i=0;i<cons.length;i++){
        const con = cons[i];
        const isHovered = con === nearestCon;
        const speed = isHovered ? 0.06 : 0.035;
        con.hoverT = clamp(con.hoverT + (isHovered ? speed : -speed), 0, 1);
        if(isHovered || con.hoverT > 0) con.pulsePhase += 0.07;

        // Sample dominant star colour when first entering hover
        if(isHovered && con.hoverT < 0.15){
          const segs = allProjected[i];
          let bestMag = 99, br=180,bg=210,bb=255;
          for(const seg of segs){
            for(const p of seg){
              if(!p.visible) continue;
              // Find closest star to this node
              for(const s of starList){
                if(!s.mag) continue;
                const sp = rp(s.xyz);
                if(!sp.visible) continue;
                const dx=sp.x-p.x, dy=sp.y-p.y;
                if(dx*dx+dy*dy < 120*120 && s.mag < bestMag){
                  bestMag=s.mag; br=s.cr; bg=s.cg; bb=s.cb;
                }
              }
            }
          }
          // Blend toward white a little so it reads as a tint, not too saturated
          con.glowR = Math.round(lerp(br, 220, 0.35));
          con.glowG = Math.round(lerp(bg, 235, 0.35));
          con.glowB = Math.round(lerp(bb, 255, 0.35));
        }
      }

      // Draw constellations
      for(let i=0;i<cons.length;i++){
        const con  = cons[i];
        const segs = allProjected[i];
        const h    = easeOut3(con.hoverT);
        const {glowR:gr, glowG:gg, glowB:gb} = con;

        // ── Lines
        for(const seg of segs){
          if(seg.length<2) continue;
          ctx.beginPath(); let started=false;
          for(const p of seg){
            if(!p.visible){ started=false; continue; }
            if(!started){ ctx.moveTo(p.x,p.y); started=true; } else ctx.lineTo(p.x,p.y);
          }
          const vis=seg.filter(p=>p.visible);
          const avgA=vis.length ? vis.reduce((s,p)=>s+p.alpha,0)/vis.length : 0;

          // Idle
          ctx.strokeStyle=`rgba(160,190,255,${avgA*0.38})`;
          ctx.lineWidth=0.9;
          ctx.stroke();

          // Hover glow — in star colour
          if(h > 0){
            ctx.save();
            ctx.shadowColor=`rgba(${gr},${gg},${gb},${h*0.85})`;
            ctx.shadowBlur=14*h;
            ctx.strokeStyle=`rgba(${gr},${gg},${gb},${avgA*(0.38+0.62*h)})`;
            ctx.lineWidth=0.9+2.0*h;
            ctx.stroke();
            ctx.restore();
          }
        }

        // ── Nodes
        for(const seg of segs){
          for(const p of seg){
            if(!p.visible) continue;

            const ddx=p.x-mxPx, ddy=p.y-myPx, d=Math.sqrt(ddx*ddx+ddy*ddy);
            const pop=Math.max(0,1-d/140);
            const baseR=Math.max(0.5, 1.3*p.alpha+pop*3.5);
            const baseAl=Math.min(1, 0.65*p.alpha+pop*0.5);
            const cr2=Math.round(215+pop*(100-215)), cg2=Math.round(230+pop*(60-230));

            if(pop>0.15){
              const gradR=baseR*5+pop*10, grd=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,gradR);
              grd.addColorStop(0,`rgba(${cr2},${cg2},255,${baseAl*0.4})`);
              grd.addColorStop(1,"rgba(100,130,255,0)");
              ctx.beginPath(); ctx.arc(p.x,p.y,gradR,0,Math.PI*2); ctx.fillStyle=grd; ctx.fill();
            }
            ctx.beginPath(); ctx.arc(p.x,p.y,baseR,0,Math.PI*2);
            ctx.fillStyle=`rgba(${cr2},${cg2},255,${baseAl})`; ctx.fill();

            // Hover pulse — in star colour
            if(h > 0.02){
              const pulse = 0.5 + 0.5*Math.sin(con.pulsePhase);
              const pulseR = (2.5 + 5*h + 4.5*h*pulse) * p.alpha;
              const pulseAl = h * 0.8 * p.alpha;

              const pgrd = ctx.createRadialGradient(p.x,p.y,pulseR*0.2, p.x,p.y,pulseR);
              pgrd.addColorStop(0, `rgba(${gr},${gg},${gb},${pulseAl})`);
              pgrd.addColorStop(0.5, `rgba(${gr},${gg},${gb},${pulseAl*0.4})`);
              pgrd.addColorStop(1, `rgba(${gr},${gg},${gb},0)`);
              ctx.beginPath(); ctx.arc(p.x,p.y,pulseR,0,Math.PI*2);
              ctx.fillStyle=pgrd; ctx.fill();

              // Crisp bright centre
              ctx.beginPath(); ctx.arc(p.x,p.y, 2.0*h*p.alpha, 0, Math.PI*2);
              ctx.fillStyle=`rgba(${gr},${gg},${gb},${h*p.alpha})`;
              ctx.fill();

              // Expanding ring
              const r2scale = 0.5 + 0.5*Math.sin(con.pulsePhase * 0.5);
              const r2 = pulseR * 1.7 * r2scale;
              if(r2 > 1){
                ctx.beginPath(); ctx.arc(p.x,p.y,r2,0,Math.PI*2);
                ctx.strokeStyle=`rgba(${gr},${gg},${gb},${h*0.22*p.alpha*(1-r2scale)})`;
                ctx.lineWidth=1;
                ctx.stroke();
              }
            }
          }
        }

        // Label — hover bright
        if(sc > 0.5 && h > 0.02){
          const lo = Math.min(1,(sc-0.5)/0.35);
          let lp = con.labelXyz ? rp(con.labelXyz) : null;
          if(!lp?.visible){
            let sx=0,sy=0,sa=0,n=0;
            for(const seg of segs) for(const p of seg){ if(p.visible){sx+=p.x;sy+=p.y;sa+=p.alpha;n++;} }
            if(n>0) lp={x:sx/n,y:sy/n,alpha:sa/n,visible:true};
          }
          if(lp?.visible && lp.alpha > 0.08){
            const fa = Math.min(1,lp.alpha*1.6)*lo*h;
            ctx.save();
            ctx.textAlign="center"; ctx.textBaseline="bottom";
            ctx.font="300 16px 'Inter','Helvetica Neue',sans-serif";
            ctx.shadowColor=`rgba(${gr},${gg},${gb},${fa*0.95})`; ctx.shadowBlur=16;
            ctx.fillStyle=`rgba(${gr},${gg},${gb},${fa})`; ctx.fillText(con.id,lp.x,lp.y-7);
            ctx.restore();
          }
        }
      }

      // Idle labels
      if(sc > 0.5){
        ctx.save(); ctx.textAlign="center"; ctx.textBaseline="bottom";
        ctx.font="300 16px 'Inter','Helvetica Neue',sans-serif";
        const lo=Math.min(1,(sc-0.5)/0.35);
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

// ─────────────────────────────────────────────────────────────────────────────
// ── GridDistortion
// ─────────────────────────────────────────────────────────────────────────────
function GridDistortion() {
  const canvasRef=useRef(null), mouse=useRef({x:0.5,y:0.5}), lagged=useRef({x:0.5,y:0.5}), animRef=useRef(null);
  useEffect(()=>{
    const canvas=canvasRef.current, ctx=canvas.getContext("2d"); let W,H; const G=18;
    const onMove=e=>{const pt=e.touches?e.touches[0]:e; mouse.current={x:pt.clientX/W,y:pt.clientY/H};};
    const resize=()=>{W=canvas.width=window.innerWidth; H=canvas.height=window.innerHeight;};
    const draw=()=>{
      ctx.clearRect(0,0,W,H);
      lagged.current.x+=(mouse.current.x-lagged.current.x)*0.04;
      lagged.current.y+=(mouse.current.y-lagged.current.y)*0.04;
      const mx=lagged.current.x*W, my=lagged.current.y*H;
      ctx.strokeStyle="rgba(90,130,255,0.04)"; ctx.lineWidth=1;
      const cols=Math.ceil(W/G)+1, rows=Math.ceil(H/G)+1;
      const wp=(gx,gy)=>{const wx=gx*G,wy=gy*G,dx=wx-mx,dy=wy-my,d=Math.sqrt(dx*dx+dy*dy); if(d<190&&d>0){const s=(1-d/190)*48;return[wx+(dx/d)*s,wy+(dy/d)*s];} return[wx,wy];};
      for(let r=0;r<rows;r++){ctx.beginPath();for(let c=0;c<cols;c++){const[x,y]=wp(c,r);c===0?ctx.moveTo(x,y):ctx.lineTo(x,y);}ctx.stroke();}
      for(let c=0;c<cols;c++){ctx.beginPath();for(let r=0;r<rows;r++){const[x,y]=wp(c,r);r===0?ctx.moveTo(x,y):ctx.lineTo(x,y);}ctx.stroke();}
      animRef.current=requestAnimationFrame(draw);
    };
    resize(); draw();
    window.addEventListener("resize",resize); window.addEventListener("mousemove",onMove); window.addEventListener("touchmove",onMove,{passive:true});
    return()=>{cancelAnimationFrame(animRef.current); window.removeEventListener("resize",resize); window.removeEventListener("mousemove",onMove); window.removeEventListener("touchmove",onMove);};
  },[]);
  return <canvas ref={canvasRef} style={{position:"absolute",inset:0,width:"100%",height:"100%",zIndex:1}}/>;
}

// ─────────────────────────────────────────────────────────────────────────────
// ── Splash constants
// ─────────────────────────────────────────────────────────────────────────────
const LS_START = 100;
const LS_END   =   2;
const SC_START = 1.5;
const SC_END   = 1.00;
const TL = { lineIn:{start:0.0,dur:0.35}, split:{start:0.35,dur:2.2}, end:3.0 };

// ─────────────────────────────────────────────────────────────────────────────
// ── Root: Hero
// ─────────────────────────────────────────────────────────────────────────────
export default function Hero() {
  const [constellations, setConstellations] = useState([]);
  const [stars,          setStars         ] = useState([]);
  const [projScale,      setProjScale     ] = useState(0.28);
  const [heroSettled,    setHeroSettled   ] = useState(false);
  const [textPhase,      setTextPhase     ] = useState("splash");
  const [navVisible,     setNavVisible    ] = useState(false);

  // Canvas-based splash text refs
  const splashCanvasRef = useRef(null);
  // Mutable state for the splash canvas draw loop
  const splashState = useRef({
    // Common
    opacity:    0,
    scale:      SC_START,
    // Text rendering
    fontSize:   80,        // px, computed at first frame
    letterSpacing: LS_START,
    // Clip reveal
    clipFraction: 0,       // 0 = no fill showing, 1 = fully open
    // Lines
    lineOpacity: 0,
    lineOffset:  0,        // px offset from centre
    // Travel phase
    mode: "splash",        // "splash" | "travel" | "done"
    posX: 0, posY: 0,      // top-left when mode==="travel"
    fillColor: "255,255,255",
    strokeWidth: 1.5,
  });

  const placeholderRef= useRef(null);
  const rafRef        = useRef(null);
  const startRef      = useRef(null);
  const animFrameRef  = useRef(null);
  const overlayRef    = useRef(null);

  useEffect(() => {
    loadConstellations().then(setConstellations).catch(console.error);
    loadStars().then(setStars).catch(console.error);
  }, []);

  // ── Splash canvas draw loop (separate from animation sequencer)
  useEffect(() => {
    const canvas = splashCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let W, H, rafId;

    const resize = () => {
      W = canvas.width  = window.innerWidth;
      H = canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    // Compute a good font size: fill ~60% of screen width, capped
    const measureFontSize = () => {
      let fs = Math.min(Math.max(window.innerWidth * 0.13, 48), 110);
      ctx.font = `700 ${fs}px ${FONT}`;
      const w = ctx.measureText(TEXT).width;
      // Scale down if text + max letter-spacing would overflow
      // (letter-spacing adds ~(n-1)*LS_START to total width at start)
      const totalW = w + (TEXT.length - 1) * LS_START;
      if (totalW > W * 0.92) {
        fs *= (W * 0.92) / totalW;
      }
      return fs;
    };

    const drawSplash = () => {
      ctx.clearRect(0, 0, W, H);
      const ss = splashState.current;
      if (ss.mode === "done") { rafId = requestAnimationFrame(drawSplash); return; }

      ctx.save();

      if (ss.mode === "splash") {
        // Centre + scale
        ctx.globalAlpha = ss.opacity;
        ctx.translate(W / 2, H / 2);
        ctx.scale(ss.scale, ss.scale);
        ctx.translate(-W / 2, -H / 2);

        const fs = ss.fontSize;
        ctx.font = `700 ${fs}px ${FONT}`;
        ctx.textAlign    = "center";
        ctx.textBaseline = "middle";

        // Letter-spacing shim: draw char by char
        const chars   = TEXT.split("");
        const ls      = ss.letterSpacing;
        // Measure total width with this letter-spacing
        const charWidths = chars.map(c => ctx.measureText(c).width);
        const totalW  = charWidths.reduce((a,b)=>a+b,0) + ls * (chars.length - 1);
        let   curX    = W / 2 - totalW / 2;
        const midY    = H / 2;

        // 1. Outline layer (full opacity, always drawn)
        ctx.strokeStyle = `rgba(255,255,255,${ss.opacity})`;
        ctx.lineWidth   = 1.5;
        ctx.lineJoin    = "round";
        chars.forEach((c, i) => {
          const cx = curX + charWidths[i] / 2;
          ctx.strokeText(c, cx, midY);
          curX += charWidths[i] + ls;
        });

        // 2. Fill layer — clipped to the reveal band
        const halfBand = ss.clipFraction * (fs * 0.75); // grow from centre
        if (halfBand > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, midY - halfBand, W, halfBand * 2);
          ctx.clip();
          ctx.fillStyle = `rgba(255,255,255,1)`;
          curX = W / 2 - totalW / 2;
          chars.forEach((c, i) => {
            const cx = curX + charWidths[i] / 2;
            ctx.fillText(c, cx, midY);
            curX += charWidths[i] + ls;
          });
          ctx.restore();
        }

        // 3. Lines — horizontal, grow outward from midY
        if (ss.lineOpacity > 0) {
          const lineY1 = midY - ss.lineOffset;
          const lineY2 = midY + ss.lineOffset;
          const grad   = ctx.createLinearGradient(0, 0, W, 0);
          grad.addColorStop(0,    "rgba(255,255,255,0)");
          grad.addColorStop(0.08, `rgba(255,255,255,${ss.lineOpacity})`);
          grad.addColorStop(0.92, `rgba(255,255,255,${ss.lineOpacity})`);
          grad.addColorStop(1,    "rgba(255,255,255,0)");
          ctx.strokeStyle = grad;
          ctx.lineWidth   = 1;
          ctx.globalAlpha = 1;
          [lineY1, lineY2].forEach(y => {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
          });
        }

      } else if (ss.mode === "travel") {
        // Absolute position, fixed size
        const fs  = ss.fontSize;
        const ls  = ss.letterSpacing;
        ctx.font  = `700 ${fs}px ${FONT}`;
        ctx.textAlign    = "left";
        ctx.textBaseline = "top";

        const chars      = TEXT.split("");
        const charWidths = chars.map(c => ctx.measureText(c).width);

        // Stroke
        ctx.strokeStyle = `rgba(255,255,255,${ss.strokeWidth > 0 ? ss.opacity : 0})`;
        ctx.lineWidth   = ss.strokeWidth;
        ctx.lineJoin    = "round";

        // Fill
        ctx.fillStyle   = `rgba(${ss.fillColor},${ss.opacity})`;

        let curX = ss.posX;
        const y  = ss.posY;
        chars.forEach((c, i) => {
          if (ss.strokeWidth > 0.05) ctx.strokeText(c, curX, y);
          ctx.fillText(c, curX, y);
          curX += charWidths[i] + ls;
        });
      }

      ctx.restore();
      rafId = requestAnimationFrame(drawSplash);
    };

    rafId = requestAnimationFrame(drawSplash);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  // ── Main animation sequence
  useEffect(() => {
    const OVERLAY_FADE_DURATION = 600;
    const TRAVEL_DURATION       = 750;
    const ZOOM_DURATION         = 2200;

    // Compute initial font size
    const tempCanvas = document.createElement("canvas");
    const tempCtx    = tempCanvas.getContext("2d");
    let fontSize = Math.min(Math.max(window.innerWidth * 0.13, 48), 110);
    tempCtx.font = `700 ${fontSize}px ${FONT}`;
    splashState.current.fontSize = fontSize;

    function splashTick(now) {
      if (!startRef.current) startRef.current = now;
      const t = (now - startRef.current) / 1000;

      const splitP  = easeInOut3(norm(t, TL.split.start, TL.split.dur));
      const ls      = lerp(LS_START, LS_END, splitP);
      const lineY   = splitP * (splashState.current.fontSize * 0.75);
      const lineOp  = Math.max(0, easeOut3(norm(t, TL.lineIn.start, TL.lineIn.dur)) * (1 - splitP));

      splashState.current.opacity      = Math.min(1, splitP * 1.2);
      splashState.current.scale        = lerp(SC_START, SC_END, splitP);
      splashState.current.letterSpacing= ls;
      splashState.current.clipFraction = splitP;
      splashState.current.lineOpacity  = lineOp;
      splashState.current.lineOffset   = lineY;

      if (t < TL.end) { rafRef.current = requestAnimationFrame(splashTick); return; }

      startGlobeZoom();

      const fadeStart = performance.now();
      function overlayFade(now2) {
        const p = Math.min(1, (now2 - fadeStart) / OVERLAY_FADE_DURATION);
        const e = easeOut3(p);
        if (overlayRef.current) overlayRef.current.style.opacity = 1 - e;
        if (p < 1) { rafRef.current = requestAnimationFrame(overlayFade); return; }
        if (overlayRef.current) overlayRef.current.style.display = "none";
        travelText();
      }
      rafRef.current = requestAnimationFrame(overlayFade);
    }

    function startGlobeZoom() {
      setHeroSettled(true);
      const PROJ_START = 0.28, PROJ_END = 0.95, t0 = performance.now();
      function zoomAnimate(now) {
        const t = Math.min(1, (now - t0) / ZOOM_DURATION);
        setProjScale(PROJ_START + (PROJ_END - PROJ_START) * easeInOut3(t));
        if (t < 1) animFrameRef.current = requestAnimationFrame(zoomAnimate);
      }
      animFrameRef.current = requestAnimationFrame(zoomAnimate);
    }

    function travelText() {
      const targetEl = placeholderRef.current;
      if (!targetEl) { setTextPhase("hero"); return; }

      function waitForSettle() {
        const r = targetEl.getBoundingClientRect();
        if (Math.abs(r.left + r.width / 2 - window.innerWidth / 2) < 5) {
          rafRef.current = requestAnimationFrame(waitForSettle); return;
        }
        doTravel();
      }

      function doTravel() {
        const toRect      = placeholderRef.current.getBoundingClientRect();
        const toFontSize  = parseFloat(getComputedStyle(placeholderRef.current).fontSize) || 40;

        // Current splash text: centred on screen
        const fromFontSize = splashState.current.fontSize;
        // The text was drawn centred. Approximate top-left of the text block:
        const tempCtx2 = document.createElement("canvas").getContext("2d");
        tempCtx2.font  = `700 ${fromFontSize}px ${FONT}`;
        const chars    = TEXT.split("");
        const charWidths = chars.map(c => tempCtx2.measureText(c).width);
        const totalW   = charWidths.reduce((a,b)=>a+b,0) + LS_END * (chars.length - 1);
        const fromX    = window.innerWidth  / 2 - totalW / 2;
        const fromY    = window.innerHeight / 2 - fromFontSize * 0.75; // approx top of text

        // Switch splash canvas to travel mode
        splashState.current.mode    = "travel";
        splashState.current.posX    = fromX;
        splashState.current.posY    = fromY;
        splashState.current.opacity = 1;
        splashState.current.strokeWidth = 1.5;

        const travelStart = performance.now();
        function travelTick(now) {
          const p = Math.min(1, (now - travelStart) / TRAVEL_DURATION);
          const e = easeInOut3(p);

          splashState.current.posX        = lerp(fromX, toRect.left, e);
          splashState.current.posY        = lerp(fromY, toRect.top,  e);
          splashState.current.fontSize    = lerp(fromFontSize, toFontSize, e);
          splashState.current.strokeWidth = lerp(1.5, 0, e);
          splashState.current.letterSpacing = LS_END;

          // Colour lerp: white → hero blue-white
          const r = Math.round(lerp(255, 210, e));
          const g = Math.round(lerp(255, 225, e));
          const b = Math.round(lerp(255, 252, e));
          splashState.current.fillColor = `${r},${g},${b}`;
          splashState.current.opacity   = lerp(1, 0.88, e);

          if (p < 1) { rafRef.current = requestAnimationFrame(travelTick); return; }

          // Hand off — hide splash canvas, show placeholder
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
      if (rafRef.current)    cancelAnimationFrame(rafRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  const isHero = textPhase === "hero";

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400&family=Montserrat:wght@700&family=Nunito:wght@400;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; }
        .hero-nav-link { color:rgba(175,200,252,0.4); text-decoration:none; font-family:'Gotham Rounded','Nunito','Inter',sans-serif; font-size:12px; font-weight:400; letter-spacing:0.1em; text-transform:lowercase; transition:color 0.25s ease; }
        .hero-nav-link:hover { color:rgba(175,200,252,0.85); }
        @keyframes fadeInUp { from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);} }
      `}</style>

      {/* Black overlay */}
      <div ref={overlayRef} style={{position:"fixed",inset:0,zIndex:9999,backgroundColor:"#000",pointerEvents:"none"}}/>

      {/* Splash canvas — full-screen, drawn imperatively */}
      <canvas
        ref={splashCanvasRef}
        style={{
          position:"fixed", top:0, left:0, width:"100%", height:"100%",
          zIndex:10000, pointerEvents:"none",
          display: isHero ? "none" : "block",
        }}
      />

      {/* Hero section */}
      <section style={{position:"relative",width:"100%",height:"100vh",background:"radial-gradient(ellipse at 44% 46%, #060918 0%, #020407 100%)",overflow:"hidden"}}>
        <StarGlobe constellations={constellations} stars={stars} projScale={projScale} />
        <GridDistortion />

        <div style={{
          position:"absolute", top:"50%",
          left:      heroSettled ? "clamp(28px, 5vw, 64px)" : "50%",
          transform: heroSettled ? "translateY(-50%)" : "translate(-50%, -50%)",
          zIndex:20, display:"flex", flexDirection:"column", gap:"14px",
          transition: heroSettled ? "none" : "left 0.8s cubic-bezier(0.7,0,0.3,1), transform 0.8s cubic-bezier(0.7,0,0.3,1)",
          pointerEvents: heroSettled ? "auto" : "none",
        }}>
          <nav style={{display:"flex",gap:"clamp(16px, 2.5vw, 28px)",alignItems:"center",opacity:navVisible?1:0,transition:"opacity 0.6s ease 0.1s"}}>
            {["about","portfolio","blog","contact"].map((label,i)=>(
              <a key={label} href={`#${label}`} className="hero-nav-link"
                style={{animation:navVisible?`fadeInUp 0.6s ease ${i*60+80}ms both`:"none"}}>{label}</a>
            ))}
          </nav>

          {/* Invisible placeholder — becomes visible at handoff */}
          <h1 ref={placeholderRef} style={{
            fontFamily: FONT, fontWeight:700,
            fontSize:"clamp(32px, 5vw, 64px)",
            letterSpacing:"0.04em", textTransform:"lowercase",
            margin:0, lineHeight:1, whiteSpace:"nowrap",
            userSelect:"none", pointerEvents:"none",
            color: isHero ? "rgba(210,225,252,0.88)" : "transparent",
          }}>
            {TEXT}
          </h1>
        </div>
      </section>
    </>
  );
}