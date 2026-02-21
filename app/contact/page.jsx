"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import PixelCard from "./pixelcard";
import GooeyNav from "../../components/Gooeynav";

const FONT = "'Proxima Nova', 'Montserrat', 'Helvetica Neue', Helvetica, Arial, sans-serif";

const NAV_ITEMS = [
  { label: "about",     href: "/about"     },
  { label: "portfolio", href: "/portfolio" },
  { label: "blog",      href: "/blog"      },
  { label: "contact",   href: "/contact"   },
];

// ── SVG Icons ────────────────────────────────────────────────────────────────
const InstagramIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
    stroke="rgba(244,244,245,0.85)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
    <circle cx="12" cy="12" r="4"/>
    <circle cx="17.5" cy="6.5" r="0.5" fill="rgba(244,244,245,0.85)" stroke="none"/>
  </svg>
);
const EmailIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
    stroke="rgba(244,244,245,0.85)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2"/>
    <path d="m2 7 10 7 10-7"/>
  </svg>
);
const LinkedInIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
    stroke="rgba(244,244,245,0.85)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/>
    <rect x="2" y="9" width="4" height="12"/>
    <circle cx="4" cy="4" r="2"/>
  </svg>
);
const GitHubIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="rgba(244,244,245,0.85)">
    <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"/>
  </svg>
);

// ── Card content (children passed into PixelCard) ────────────────────────────
function CardContent({ handle, platform, Icon }) {
  // Line: starts at bottom of circle, runs through both text nodes, fades out
  const LINE_HEIGHT = 110; // px — enough to pass through handle + label + tail

  return (
    <div style={{
      position: "relative",
      zIndex: 2,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      marginTop: "-12%", // push cluster into upper portion of card
    }}>
      {/* Icon circle — larger */}
      <div style={{
        width: "60px",
        height: "60px",
        borderRadius: "50%",
        border: "1px solid rgba(255,255,255,0.2)",
        background: "rgba(255,255,255,0.05)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        position: "relative",
        zIndex: 2,
      }}>
        <Icon />
      </div>

      {/* Vertical line from circle bottom, through text, fades out */}
      <div style={{
        width: "1px",
        height: `${LINE_HEIGHT}px`,
        background: "linear-gradient(to bottom, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0) 100%)",
        flexShrink: 0,
      }} />

      {/* Text block — pulled up so line pierces through it */}
      <div style={{
        marginTop: `-${LINE_HEIGHT - 8}px`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "10px",
        position: "relative",
        zIndex: 3,
      }}>
        <p style={{
          fontFamily: FONT,
          fontWeight: 700,
          fontSize: "clamp(15px, 2vw, 22px)",
          color: "rgba(244,244,245,0.95)",
          margin: 0,
          textAlign: "center",
          letterSpacing: "0.01em",
          whiteSpace: "nowrap",
          padding: "0 20px",
        }}>
          {handle}
        </p>
        <p style={{
          fontFamily: FONT,
          fontWeight: 400,
          fontSize: "13px",
          color: "rgba(113,113,122,0.9)",
          margin: 0,
          textAlign: "center",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}>
          {platform}
        </p>
      </div>
    </div>
  );
}

// ── Particles background ──────────────────────────────────────────────────────
function Particles() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let W, H, rafId;
    const dots = Array.from({ length: 110 }, () => ({
      x: Math.random(), y: Math.random(),
      vx: (Math.random() - 0.5) * 0.0014,
      vy: (Math.random() - 0.5) * 0.0014,
      r: Math.random() * 1.2 + 0.25,
      a: Math.random() * 0.55 + 0.08,
    }));
    const resize = () => { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; };
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      for (const d of dots) {
        d.x += d.vx; d.y += d.vy;
        if (d.x < 0) d.x = 1; if (d.x > 1) d.x = 0;
        if (d.y < 0) d.y = 1; if (d.y > 1) d.y = 0;
        ctx.beginPath();
        ctx.arc(d.x * W, d.y * H, d.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(200,218,255,${d.a})`;
        ctx.fill();
      }
      rafId = requestAnimationFrame(draw);
    };
    resize(); draw();
    window.addEventListener("resize", resize);
    return () => { cancelAnimationFrame(rafId); window.removeEventListener("resize", resize); };
  }, []);
  return <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 0 }} />;
}

// ── Page ─────────────────────────────────────────────────────────────────────
const CONTACTS = [
  { href: "https://www.instagram.com/yahayabasiron/", handle: "@yahayabasiron", platform: "Instagram", Icon: InstagramIcon, colors: "#d946ef,#f0abfc,#e879f9" },
  { href: "mailto:yahaya@gmail.com",                  handle: "yahaya@gmail.com", platform: "Email",    Icon: EmailIcon,     colors: "#6366f1,#a5b4fc,#c7d2fe" },
  { href: "https://www.linkedin.com/in/yahayabasiron/", handle: "yahayabasiron", platform: "LinkedIn", Icon: LinkedInIcon,  colors: "#38bdf8,#7dd3fc,#bae6fd" },
  { href: "https://github.com/Yahayabb",              handle: "Yahayabb",         platform: "GitHub",   Icon: GitHubIcon,    colors: "#a1a1aa,#d4d4d8,#f4f4f5" },
];

export default function ContactPage() {
  const [show, setShow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setShow(true), 60); return () => clearTimeout(t); }, []);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        /* Force the whole page to exactly viewport height, no scroll */
        html, body { height: 100%; overflow: hidden; }

        @keyframes _fu {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .cp-in { opacity: 0; }
        .cp-in.cp-show { animation: _fu 0.5s cubic-bezier(.4,0,.2,1) forwards; }

        /* 2×2 grid fills remaining height */
        .cp-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 14px;
          width: 100%;
          max-width: 700px;
          /* Let cards grow to fill available vertical space */
          flex: 1;
          min-height: 0;
        }

        /* Override PixelCard fixed dimensions — let the grid drive size */
        .cp-grid .pixel-card {
          width: 100% !important;
          height: 100% !important;
          aspect-ratio: unset !important;
        }

        /* Brighter border + slight lift on hover */
        .cp-grid .pixel-card:hover {
          border-color: rgba(175, 200, 252, 0.35) !important;
          transform: translateY(-3px);
          transition: border-color 200ms cubic-bezier(0.5,1,0.89,1),
                      transform 200ms cubic-bezier(0.5,1,0.89,1) !important;
        }

        @media (max-width: 540px) {
          .cp-grid { grid-template-columns: 1fr !important; }
          html, body { overflow: auto; }
        }
      `}</style>

      <div style={{
        position: "fixed",
        inset: 0,
        background: "radial-gradient(ellipse at 44% 46%, #060918 0%, #020407 100%)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}>
        <Particles />

        {/* ── Header ─────────────────────────────────────────── */}
        <header style={{
          position: "relative",
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "20px 28px",
          flexShrink: 0,
        }}>
          {/* Back arrow only — no text */}
          <a href="/" aria-label="Back to home" style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "rgba(175,200,252,0.4)",
            textDecoration: "none",
            transition: "color 0.2s",
            padding: "4px",
          }}
            onMouseOver={e => e.currentTarget.style.color = "rgba(175,200,252,0.85)"}
            onMouseOut={e => e.currentTarget.style.color = "rgba(175,200,252,0.4)"}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </a>

          {/* Real GooeyNav — "contact" is index 3 */}
          <GooeyNav items={NAV_ITEMS} initialActiveIndex={3} />
        </header>

        {/* Top glow line */}
        <div style={{
          flexShrink: 0,
          width: "100%", height: "1px",
          background: "linear-gradient(90deg, transparent, rgba(100,140,255,0.25) 50%, transparent)",
          position: "relative", zIndex: 10,
        }} />

        {/* ── Main — fills remaining height ──────────────────── */}
        <main style={{
          position: "relative",
          zIndex: 10,
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px 28px",
        }}>
          <div
            className="cp-grid"
            style={{ height: "100%" }}
          >
            {CONTACTS.map((c, i) => (
              <div
                key={c.platform}
                className={`cp-in${show ? " cp-show" : ""}`}
                style={{ animationDelay: `${0.06 + i * 0.08}s`, minHeight: 0 }}
              >
                <a
                  href={c.href}
                  target={c.href.startsWith("mailto") ? undefined : "_blank"}
                  rel="noopener noreferrer"
                  style={{ textDecoration: "none", display: "block", height: "100%" }}
                >
                  <PixelCard colors={c.colors} gap={5} speed={35} noFocus={false}>
                    <CardContent handle={c.handle} platform={c.platform} Icon={c.Icon} />
                  </PixelCard>
                </a>
              </div>
            ))}
          </div>
        </main>

        {/* Bottom glow line */}
        <div style={{
          flexShrink: 0,
          width: "100%", height: "1px",
          background: "linear-gradient(90deg, transparent, rgba(100,140,255,0.25) 50%, transparent)",
          position: "relative", zIndex: 10,
        }} />
      </div>
    </>
  );
}