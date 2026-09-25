import { useEffect, useRef, useState } from 'react';

// Paper airplane path -- points right at angle 0. Rotation is applied via
// CSS transform based on real movement direction, not baked into the SVG.
const BODY = 'M3,12 L21,4 L17,12 L21,20 Z';
const FOLD = 'M3,12 L17,12';

// Each trailing copy: how much smaller and fainter than the main icon.
const TRAIL = [
  { scale: 0.72, opacity: 0.28 },
  { scale: 0.54, opacity: 0.16 },
  { scale: 0.38, opacity: 0.09 },
];

// A soft, lagging cursor follower shaped like a paper plane that banks
// to face its direction of travel, with a short fading trail behind it.
// pointer-events: none throughout so it never intercepts clicks or
// interferes with drag-and-drop reordering elsewhere in the app.
export default function CursorTracker() {
  const [isTouchDevice] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches
  );

  const mainRef = useRef(null);
  const trailRefs = useRef([null, null, null]);
  const posRef = useRef({ x: -300, y: -300 });
  const targetRef = useRef({ x: -300, y: -300 });
  const angleRef = useRef(0);
  // Rolling history of the last few real positions+angles, sampled every
  // few frames -- this is what makes the trail follow the actual path
  // instead of just fading the same spot in place.
  const historyRef = useRef([
    { x: -300, y: -300, a: 0 },
    { x: -300, y: -300, a: 0 },
    { x: -300, y: -300, a: 0 },
  ]);
  const rafRef = useRef(0);
  const firstMove = useRef(true);
  const frame = useRef(0);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (isTouchDevice || prefersReducedMotion) return;

    function handleMove(e) {
      if (firstMove.current) {
        // Snap to the cursor on the very first move instead of lerping
        // in from off-screen (-300,-300), which would look like the
        // plane flying in from a corner on page load.
        posRef.current = { x: e.clientX, y: e.clientY };
        const h = { x: e.clientX, y: e.clientY, a: 0 };
        historyRef.current = [h, { ...h }, { ...h }];
        firstMove.current = false;
      }
      targetRef.current = { x: e.clientX, y: e.clientY };
    }

    function tick() {
      const prevX = posRef.current.x;
      const prevY = posRef.current.y;

      // Lerp 10% of the remaining distance each frame -- the lag/spring feel.
      posRef.current.x += (targetRef.current.x - posRef.current.x) * 0.1;
      posRef.current.y += (targetRef.current.y - posRef.current.y) * 0.1;

      const dx = posRef.current.x - prevX;
      const dy = posRef.current.y - prevY;

      // Only re-aim the plane when it's actually moved a meaningful
      // amount -- otherwise sub-pixel jitter at rest causes flickering
      // rotation. Angle is smoothed (not snapped) via the shortest
      // angular path, wrapping correctly across the -pi/pi boundary.
      if (dx * dx + dy * dy > 0.06) {
        const targetAngle = Math.atan2(dy, dx);
        let delta = targetAngle - angleRef.current;
        while (delta > Math.PI) delta -= 2 * Math.PI;
        while (delta < -Math.PI) delta += 2 * Math.PI;
        angleRef.current += delta * 0.18;
      }

      frame.current++;
      if (frame.current % 3 === 0) {
        historyRef.current = [
          { x: posRef.current.x, y: posRef.current.y, a: angleRef.current },
          historyRef.current[0],
          historyRef.current[1],
        ];
      }

      const { x, y } = posRef.current;
      const a = angleRef.current;

      if (mainRef.current) {
        mainRef.current.style.transform = `translate(${x - 12}px,${y - 12}px) rotate(${a}rad)`;
      }
      TRAIL.forEach(({ scale, opacity }, i) => {
        const el = trailRefs.current[i];
        const h = historyRef.current[i];
        if (el) {
          el.style.transform = `translate(${h.x - 12}px,${h.y - 12}px) rotate(${h.a}rad) scale(${scale})`;
          el.style.opacity = String(opacity);
        }
      });

      rafRef.current = requestAnimationFrame(tick);
    }

    window.addEventListener('mousemove', handleMove, { passive: true });
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      cancelAnimationFrame(rafRef.current);
    };
  }, [isTouchDevice]);

  if (isTouchDevice) return null;

  const svgStyle = {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '24px',
    height: '24px',
    pointerEvents: 'none',
    zIndex: 99999,
    willChange: 'transform',
    transform: 'translate(-300px,-300px)',
    overflow: 'visible',
  };

  // var(--accent) so the plane's color stays correct in both themes
  // automatically, instead of a color hardcoded to one palette.
  const Plane = () => (
    <>
      <path d={BODY} fill="var(--accent)" fillOpacity="0.92" />
      <path d={FOLD} stroke="var(--card)" strokeOpacity="0.65" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    </>
  );

  return (
    <>
      {TRAIL.map((_, i) => (
        <svg
          key={i}
          ref={(el) => { trailRefs.current[i] = el; }}
          viewBox="0 0 24 24"
          style={{ ...svgStyle, opacity: 0 }}
          aria-hidden="true"
        >
          <Plane />
        </svg>
      ))}
      <svg ref={mainRef} viewBox="0 0 24 24" style={svgStyle} aria-hidden="true">
        <Plane />
      </svg>
    </>
  );
}
