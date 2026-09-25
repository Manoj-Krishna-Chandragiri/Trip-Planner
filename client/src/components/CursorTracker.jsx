import { useEffect, useRef, useState } from 'react';

const BODY = 'M3,12 L21,4 L17,12 L21,20 Z';
const FOLD = 'M3,12 L17,12';

const TRAIL = [
  { scale: 0.72, opacity: 0.28 },
  { scale: 0.54, opacity: 0.16 },
  { scale: 0.38, opacity: 0.09 },
];

export default function CursorTracker() {
  const [isTouchDevice] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches
  );

  const mainRef = useRef(null);
  const trailRefs = useRef([null, null, null]);
  const posRef = useRef({ x: -300, y: -300 });
  const targetRef = useRef({ x: -300, y: -300 });
  const angleRef = useRef(0);

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

      posRef.current.x += (targetRef.current.x - posRef.current.x) * 0.1;
      posRef.current.y += (targetRef.current.y - posRef.current.y) * 0.1;

      const dx = posRef.current.x - prevX;
      const dy = posRef.current.y - prevY;

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
