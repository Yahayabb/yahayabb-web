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
function bvToRgb(bv) {
  const t=Math.max(-0.4,Math.min(2.0,bv)); let r,g,b;
  if(t<0.40) r=0.61+0.11*t+0.1*t*t; else if(t<1.50) r=0.83+(0.17*(t-0.40))/(1.50-0.40); else r=1.00;
  r=Math.min(1,Math.max(0,r));
  if(t<0.00) g=0.70+0.07*t+1.1*t*t; else if(t<0.40) g=0.87+0.54*t-0.93*t*t; else if(t<1.60) g=0.97-0.26*(t-0.40)/(1.60-0.40); else g=Math.max(0,0.74-(t-1.60));
  g=Math.min(1,Math.max(0,g));
  if(t<0.40) b=1.00; else if(t<1.50) b=Math.max(0,1.00-(t-0.40)/(1.50-0.40)); else b=0.00;
  b=Math.min(1,Math.max(0,b));
  return [Math.round(r*255),Math.round(g*255),Math.round(b*255)];
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
    return { xyz:raDecToXYZ(ra,lat), mag, cr, cg, cb, twinklePhase:Math.random()*Math.PI*2, twinkleSpeed:0.008+Math.random()*0.014 };
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
    return { id:f.id, segments, labelXyz:lp?raDecToXYZ(lp.ra,lp.dec):null };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ── StarGlobe
// ─────────────────────────────────────────────────────────────────────────────
function StarGlobe({ constellations, stars, projScale }) {
  const canvasRef=useRef(null), mouse=useRef({x:0.5,y:0.5}), animRef=useRef(null);
  const consRef=useRef(constellations), starsRef=useRef(stars), scaleRef=useRef(projScale);
  useEffect(()=>{consRef.current=constellations;},[constellations]);
  useEffect(()=>{starsRef.current=stars;},[stars]);
  useEffect(()=>{scaleRef.current=projScale;},[projScale]);
  useEffect(()=>{
    const canvas=canvasRef.current, ctx=canvas.getContext("2d"); let W,H;
    const rot={x:0.15,y:0.0}, vel={x:0.0,y:0.0}, AUTO={x:-0.00045,y:0.001};
    const onMove=e=>{const pt=e.touches?e.touches[0]:e; mouse.current={x:pt.clientX/window.innerWidth,y:pt.clientY/window.innerHeight};};
    const resize=()=>{W=canvas.width=window.innerWidth; H=canvas.height=window.innerHeight;};
    const draw=()=>{
      ctx.clearRect(0,0,W,H);
      const cx=mouse.current.x-0.5, cy=mouse.current.y-0.5, md=Math.sqrt(cx*cx+cy*cy);
      if(md>0.05){vel.x+=((cy/md)*0.0018-vel.x)*0.07; vel.y+=((cx/md)*0.0018-vel.y)*0.07;}
      else{vel.x+=(AUTO.x-vel.x)*0.025; vel.y+=(AUTO.y-vel.y)*0.025;}
      rot.x+=vel.x; rot.y+=vel.y;
      const mxPx=mouse.current.x*W, myPx=mouse.current.y*H, sc=scaleRef.current;
      const rp=xyz=>{let v=rotX(xyz,rot.x); v=rotY(v,rot.y); return projectSphere(v,W,H,sc);};
      for(const s of (starsRef.current??[])){
        s.twinklePhase+=s.twinkleSpeed; const p=rp(s.xyz); if(!p.visible) continue;
        const tw=0.88+0.12*Math.sin(s.twinklePhase);
        const r=Math.max(0.3,(3.8-s.mag*0.52)*tw*p.alpha);
        const al=Math.min(0.95,Math.max(0.05,(7-s.mag)/9)*p.alpha);
        ctx.beginPath(); ctx.arc(p.x,p.y,r,0,Math.PI*2); ctx.fillStyle=`rgba(${s.cr},${s.cg},${s.cb},${al})`; ctx.fill();
        if(s.mag<2&&p.alpha>0.3){
          const gr=r*4, grd=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,gr);
          grd.addColorStop(0,`rgba(${s.cr},${s.cg},${s.cb},${al*0.35})`);
          grd.addColorStop(1,`rgba(${s.cr},${s.cg},${s.cb},0)`);
          ctx.beginPath(); ctx.arc(p.x,p.y,gr,0,Math.PI*2); ctx.fillStyle=grd; ctx.fill();
        }
      }
      const cons=consRef.current; if(!cons?.length){animRef.current=requestAnimationFrame(draw);return;}
      for(const con of cons){
        for(const seg of con.segments){
          if(seg.length<2) continue;
          const projected=seg.map(pt=>rp(pt.xyz));
          ctx.beginPath(); let started=false;
          for(let i=0;i<projected.length;i++){
            const p=projected[i]; if(!p.visible){started=false;continue;}
            if(!started){ctx.moveTo(p.x,p.y);started=true;} else ctx.lineTo(p.x,p.y);
          }
          const vis=projected.filter(p=>p.visible);
          const avgA=vis.length?vis.reduce((s,p)=>s+p.alpha,0)/vis.length:0;
          ctx.strokeStyle=`rgba(160,190,255,${avgA*0.38})`; ctx.lineWidth=0.9; ctx.stroke();
          for(const p of projected){
            if(!p.visible) continue;
            const ddx=p.x-mxPx, ddy=p.y-myPx, d=Math.sqrt(ddx*ddx+ddy*ddy), pop=Math.max(0,1-d/140);
            const r=Math.max(0.5,1.3*p.alpha+pop*3.5), al=Math.min(1,0.65*p.alpha+pop*0.5);
            const cr=Math.round(215+pop*(100-215)), cg=Math.round(230+pop*(60-230));
            if(pop>0.15){
              const gr=r*5+pop*10, grd=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,gr);
              grd.addColorStop(0,`rgba(${cr},${cg},255,${al*0.4})`);
              grd.addColorStop(1,"rgba(100,130,255,0)");
              ctx.beginPath(); ctx.arc(p.x,p.y,gr,0,Math.PI*2); ctx.fillStyle=grd; ctx.fill();
            }
            ctx.beginPath(); ctx.arc(p.x,p.y,r,0,Math.PI*2); ctx.fillStyle=`rgba(${cr},${cg},255,${al})`; ctx.fill();
          }
        }
      }
      if(sc>0.5){
        ctx.save(); ctx.textAlign="center"; ctx.textBaseline="bottom";
        ctx.font="300 16px 'Inter','Helvetica Neue',sans-serif";
        const lo=Math.min(1,(sc-0.5)/0.35);
        for(const con of cons){
          let lp=con.labelXyz?rp(con.labelXyz):null;
          if(!lp?.visible){
            let sx=0,sy=0,sa=0,n=0;
            for(const seg of con.segments) for(const pt of seg){const p=rp(pt.xyz);if(p.visible){sx+=p.x;sy+=p.y;sa+=p.alpha;n++;}}
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
    window.addEventListener("resize",resize); window.addEventListener("mousemove",onMove); window.addEventListener("touchmove",onMove,{passive:true});
    return()=>{cancelAnimationFrame(animRef.current); window.removeEventListener("resize",resize); window.removeEventListener("mousemove",onMove); window.removeEventListener("touchmove",onMove);};
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
  const [containerReady, setContainerReady] = useState(false); // NEW: container has finished transitioning
  const [textPhase,      setTextPhase     ] = useState("splash");
  const [navVisible,     setNavVisible    ] = useState(false);

  const overlayRef    = useRef(null);
  const floatWrapRef  = useRef(null);
  const outlineRef    = useRef(null);
  const fillRef       = useRef(null);
  const fillTextRef   = useRef(null);
  const line1Ref      = useRef(null);
  const line2Ref      = useRef(null);
  const placeholderRef= useRef(null);
  const rafRef        = useRef(null);
  const startRef      = useRef(null);
  const maxSplitRef   = useRef(80);
  const animFrameRef  = useRef(null);

  useEffect(() => {
    loadConstellations().then(setConstellations).catch(console.error);
    loadStars().then(setStars).catch(console.error);
  }, []);

  useEffect(() => {
    if (!document.getElementById("splash-font")) {
      const l=document.createElement("link"); l.id="splash-font"; l.rel="stylesheet";
      l.href="https://fonts.googleapis.com/css2?family=Montserrat:wght@700&display=swap";
      document.head.appendChild(l);
    }

    const OVERLAY_FADE_DURATION = 600;
    const TRAVEL_DURATION       = 750;
    const ZOOM_DURATION         = 2200;
    // How long to wait for the nav container's `left` CSS transition to settle
    // before we measure and travel. Must be >= the transition duration (0.8s).
    const CONTAINER_SETTLE_MS   = 820;

    function splashTick(now) {
      if (!startRef.current) startRef.current = now;
      const t = (now - startRef.current) / 1000;

      if (t < 0.1 && floatWrapRef.current) {
        maxSplitRef.current = floatWrapRef.current.getBoundingClientRect().height / 2;
      }
      const maxSplit = maxSplitRef.current;

      const lineInP = easeOut3(norm(t, TL.lineIn.start, TL.lineIn.dur));
      const splitP  = easeInOut3(norm(t, TL.split.start, TL.split.dur));
      const lineY   = splitP * maxSplit;
      const ls      = lerp(LS_START, LS_END, splitP);

      if (floatWrapRef.current) {
        floatWrapRef.current.style.opacity   = splitP;
        floatWrapRef.current.style.transform = `translate(-50%, -50%) scale(${lerp(SC_START, SC_END, splitP)})`;
      }
      if (outlineRef.current)  outlineRef.current.style.letterSpacing  = `${ls}px`;
      if (fillTextRef.current) fillTextRef.current.style.letterSpacing = `${ls}px`;
      if (fillRef.current)     fillRef.current.style.clipPath = `inset(calc(50% - ${lineY}px) 0px calc(50% - ${lineY}px) 0px)`;

      const lineOpacity = Math.max(0, easeOut3(norm(t, TL.lineIn.start, TL.lineIn.dur)) * (1 - splitP));
      if (line1Ref.current) { line1Ref.current.style.transform=`translateY(calc(-50% + ${-lineY}px))`; line1Ref.current.style.opacity=lineOpacity; }
      if (line2Ref.current) { line2Ref.current.style.transform=`translateY(calc(-50% + ${lineY}px))`;  line2Ref.current.style.opacity=lineOpacity; }

      if (t < TL.end) {
        rafRef.current = requestAnimationFrame(splashTick);
        return;
      }

      // Phase 2: fade overlay, start globe zoom, wait for container to settle
      startGlobeZoom();

      const fadeStart = performance.now();
      function overlayFade(now2) {
        const p = Math.min(1, (now2 - fadeStart) / OVERLAY_FADE_DURATION);
        const e = easeOut3(p);
        if (overlayRef.current) overlayRef.current.style.opacity = 1 - e;
        if (p < 1) {
          rafRef.current = requestAnimationFrame(overlayFade);
          return;
        }
        if (overlayRef.current) overlayRef.current.style.display = "none";
        // Phase 3: travel — but only AFTER the container has fully settled
        travelText();
      }
      rafRef.current = requestAnimationFrame(overlayFade);
    }

    function startGlobeZoom() {
      // Trigger hero layout — this starts the container's 0.8s `left` transition.
      setHeroSettled(true);

      const PROJ_START = 0.28, PROJ_END = 0.95;
      const t0 = performance.now();
      function zoomAnimate(now) {
        const t = Math.min(1, (now - t0) / ZOOM_DURATION);
        setProjScale(PROJ_START + (PROJ_END - PROJ_START) * easeInOut3(t));
        if (t < 1) animFrameRef.current = requestAnimationFrame(zoomAnimate);
      }
      animFrameRef.current = requestAnimationFrame(zoomAnimate);

      // ── FIX: signal when the container has finished its left-transition
      // so travelText() measures a stable toRect.
      setTimeout(() => setContainerReady(true), CONTAINER_SETTLE_MS);
    }

    function travelText() {
      const floatEl  = floatWrapRef.current;
      const targetEl = placeholderRef.current;
      if (!floatEl || !targetEl) { setTextPhase("hero"); return; }

      // ── FIX: wait until containerReady fires (via the setTimeout above).
      // We poll via rAF until the ref is set — avoids measuring a moving target.
      function waitForSettle() {
        // containerReady is set by setState so we can't read it here directly.
        // Instead, compare the placeholder's left position to its expected
        // settled value by checking that it has moved away from center.
        const r = targetEl.getBoundingClientRect();
        const centreX = window.innerWidth / 2;
        // If still within 5px of center, keep waiting
        if (Math.abs(r.left + r.width / 2 - centreX) < 5) {
          rafRef.current = requestAnimationFrame(waitForSettle);
          return;
        }
        doTravel();
      }

      function doTravel() {
        const fromRect = floatEl.getBoundingClientRect();
        const toRect   = placeholderRef.current.getBoundingClientRect();

        const fromFontSize = parseFloat(getComputedStyle(floatEl.querySelector("[data-text]") || floatEl).fontSize) || 80;
        const toFontSize   = parseFloat(getComputedStyle(placeholderRef.current).fontSize) || 40;

        const fromTop  = fromRect.top;
        const fromLeft = fromRect.left;
        const toTop    = toRect.top;
        const toLeft   = toRect.left;

        // Switch float to absolute top/left so we can drive it directly
        floatEl.style.transition = "none";
        floatEl.style.top        = `${fromTop}px`;
        floatEl.style.left       = `${fromLeft}px`;
        floatEl.style.transform  = "none";

        if (outlineRef.current)  outlineRef.current.style.letterSpacing  = `${LS_END}px`;
        if (fillTextRef.current) fillTextRef.current.style.letterSpacing = `${LS_END}px`;
        if (line1Ref.current) line1Ref.current.style.display = "none";
        if (line2Ref.current) line2Ref.current.style.display = "none";

        const travelStart = performance.now();
        function travelTick(now) {
          const p  = Math.min(1, (now - travelStart) / TRAVEL_DURATION);
          const e  = easeInOut3(p);

          const curTop      = lerp(fromTop,      toTop,      e);
          const curLeft     = lerp(fromLeft,     toLeft,     e);
          const curFontSize = lerp(fromFontSize, toFontSize, e);

          const r = Math.round(lerp(255, 210, e));
          const g = Math.round(lerp(255, 225, e));
          const b = Math.round(lerp(255, 252, e));
          const a = lerp(1, 0.88, e);

          if (floatEl) {
            floatEl.style.top  = `${curTop}px`;
            floatEl.style.left = `${curLeft}px`;
          }
          const textDivs = floatEl.querySelectorAll("[data-text]");
          textDivs.forEach(d => { d.style.fontSize = `${curFontSize}px`; });

          if (outlineRef.current) outlineRef.current.style.WebkitTextStroke = `${lerp(1.5, 0, e)}px rgba(${r},${g},${b},${a})`;
          if (fillTextRef.current) fillTextRef.current.style.color = `rgba(${r},${g},${b},${a})`;
          if (fillRef.current) fillRef.current.style.clipPath = `inset(0px 0px 0px 0px)`;

          if (p < 1) {
            rafRef.current = requestAnimationFrame(travelTick);
            return;
          }

          // Phase 4: hand off — placeholder becomes visible, float hides.
          // Do it in a single synchronous flush to avoid any double-image frame.
          setTextPhase("hero");
          setNavVisible(true);
        }
        rafRef.current = requestAnimationFrame(travelTick);
      }

      // Start waiting for the container to stop sliding
      rafRef.current = requestAnimationFrame(waitForSettle);
    }

    rafRef.current = requestAnimationFrame(splashTick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  const isHero = textPhase === "hero";

  const floatStyle = {
    position:        "fixed",
    top:             "50%",
    left:            "50%",
    transform:       `translate(-50%, -50%) scale(${SC_START})`,
    zIndex:          10000,
    opacity:         0,
    pointerEvents:   "none",
    willChange:      "top, left, transform, opacity",
    display:         isHero ? "none" : "block",
  };

  const textDivBase = {
    fontFamily:    FONT,
    fontWeight:    700,
    fontSize:      "clamp(50px, 16vw, 100px)",
    letterSpacing: `${LS_START}px`,
    whiteSpace:    "nowrap",
    lineHeight:    1.1,
    userSelect:    "none",
  };

  const lineStyle = {
    position:   "absolute",
    left: 0, right: 0, top: "50%",
    height:     "1px",
    background: "linear-gradient(to right, transparent 0%, #fff 8%, #fff 92%, transparent 100%)",
    pointerEvents: "none",
    opacity:    0,
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400&family=Montserrat:wght@700&family=Nunito:wght@400;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; }
        .hero-nav-link {
          color: rgba(175,200,252,0.4); text-decoration: none;
          font-family: 'Gotham Rounded','Nunito','Inter',sans-serif;
          font-size: 12px; font-weight: 400; letter-spacing: 0.1em;
          text-transform: lowercase; transition: color 0.25s ease;
        }
        .hero-nav-link:hover { color: rgba(175,200,252,0.85); }
        @keyframes fadeInUp { from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);} }
      `}</style>

      {/* Black overlay */}
      <div ref={overlayRef} style={{
        position:"fixed", inset:0, zIndex:9999,
        backgroundColor:"#000",
        pointerEvents:"none",
      }}/>

      {/* Floating splash/travel text */}
      <div ref={floatWrapRef} style={floatStyle}>
        <div ref={outlineRef} data-text="true" style={{
          ...textDivBase,
          color:"transparent",
          WebkitTextStroke:"1.5px #ffffff",
        }}>{TEXT}</div>

        <div ref={fillRef} style={{
          position:"absolute", inset:0, overflow:"hidden",
          clipPath:"inset(50% 0px 50% 0px)",
        }}>
          <div ref={fillTextRef} data-text="true" style={{
            ...textDivBase,
            color:"#ffffff",
          }}>{TEXT}</div>
        </div>

        <div ref={line1Ref} style={lineStyle}/>
        <div ref={line2Ref} style={lineStyle}/>
      </div>

      {/* Hero section */}
      <section style={{
        position:"relative", width:"100%", height:"100vh",
        background:"radial-gradient(ellipse at 44% 46%, #060918 0%, #020407 100%)",
        overflow:"hidden",
      }}>
        <StarGlobe constellations={constellations} stars={stars} projScale={projScale} />
        <GridDistortion />

        {/* Nav + Title layout block */}
        <div style={{
          position:"absolute", top:"50%",
          left:      heroSettled ? "clamp(28px, 5vw, 64px)" : "50%",
          transform: heroSettled ? "translateY(-50%)" : "translate(-50%, -50%)",
          zIndex:20,
          display:"flex", flexDirection:"column", gap:"14px",
          // ── FIX: suppress the left-transition entirely — we let the float
          // text do the animated travel; the placeholder just needs to be
          // in its final position before we measure it.
          transition: heroSettled
            ? "none"
            : "left 0.8s cubic-bezier(0.7,0,0.3,1), transform 0.8s cubic-bezier(0.7,0,0.3,1)",
          pointerEvents: heroSettled ? "auto" : "none",
        }}>
          <nav style={{
            display:"flex", gap:"clamp(16px, 2.5vw, 28px)", alignItems:"center",
            opacity: navVisible ? 1 : 0,
            transition:"opacity 0.6s ease 0.1s",
          }}>
            {["about","portfolio","blog","contact"].map((label, i) => (
              <a key={label} href={`#${label}`} className="hero-nav-link"
                style={{ animation: navVisible ? `fadeInUp 0.6s ease ${i*60+80}ms both` : "none" }}>
                {label}
              </a>
            ))}
          </nav>

          <h1 ref={placeholderRef} style={{
            fontFamily:    FONT,
            fontWeight:    700,
            fontSize:      "clamp(32px, 5vw, 64px)",
            letterSpacing: "0.04em",
            textTransform: "lowercase",
            margin:        0, lineHeight:1, whiteSpace:"nowrap",
            userSelect:    "none", pointerEvents:"none",
            color:   isHero ? "rgba(210,225,252,0.88)" : "transparent",
          }}>
            {TEXT}
          </h1>
        </div>
      </section>
    </>
  );
}