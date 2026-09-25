// Decorative topographic contour lines, purely visual (aria-hidden). Lines
// are generated from a formula rather than hand-drawn paths so the same
// component works at any container size via the SVG viewBox.
function topoPath(yBase, i) {
  const flip = i % 2 === 0;
  const a1 = 18 + (i % 5) * 7;
  const a2 = 12 + (i % 4) * 8;
  return (
    `M -100,${yBase} ` +
    `Q 260,${yBase + a1 * (flip ? -1 : 1)} ` +
    `560,${yBase + a2 * (flip ? 0.6 : -0.6)} ` +
    `Q 880,${yBase + a1 * (flip ? -0.85 : 0.85)} ` +
    `1300,${yBase}`
  );
}

export default function TopoBackground({ intensity = 1 }) {
  const lines = Array.from({ length: 15 }, (_, i) => {
    const yBase = (i / 14) * 810 - 5;
    const lineOpacity = (0.14 + (i % 3) * 0.05) * intensity;
    const strokeWidth = i % 4 === 0 ? '1.1' : '0.75';
    return { d: topoPath(yBase, i), lineOpacity, strokeWidth };
  });

  return (
    <svg
      aria-hidden="true"
      className="topo-background"
      viewBox="0 0 1200 800"
      preserveAspectRatio="xMidYMid slice"
    >
      {lines.map(({ d, lineOpacity, strokeWidth }, i) => (
        <path key={i} d={d} fill="none" strokeWidth={strokeWidth} opacity={lineOpacity} />
      ))}
    </svg>
  );
}
