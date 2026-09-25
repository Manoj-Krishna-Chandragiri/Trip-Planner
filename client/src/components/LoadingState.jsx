import { useState, useEffect } from 'react';

const STEPS = [
  'Plotting your route…',
  'Verifying stops against map data…',
  'Estimating travel times between stops…',
  'Organising your day-by-day itinerary…',
];

const STEP_MS = 900;

export default function LoadingState() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setStep((s) => (s < STEPS.length - 1 ? s + 1 : s)); // holds at the last index
    }, STEP_MS);
    return () => clearInterval(timer);
  }, []);

  const progressPct = ((step + 1) / (STEPS.length + 1)) * 100; // caps below 100% on purpose

  return (
    <div className="status-panel status-panel--loading" role="status" aria-live="polite">
      <div className="loading-compass" aria-hidden="true">
        <svg width="72" height="72" viewBox="0 0 72 72" className="loading-compass__ring">
          <circle cx="36" cy="36" r="32" fill="none" stroke="var(--accent)" strokeOpacity="0.2" strokeWidth="2" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((angle, i) => (
            <circle
              key={angle}
              cx={36 + 32 * Math.cos((angle * Math.PI) / 180)}
              cy={36 + 32 * Math.sin((angle * Math.PI) / 180)}
              r="2"
              fill="var(--accent)"
              fillOpacity={i % 2 === 0 ? 1 : 0.4}
            />
          ))}
        </svg>
        <svg width="72" height="72" viewBox="0 0 72 72" className="loading-compass__needle">
          <polygon points="36,12 40,36 36,42 32,36" fill="var(--ink)" />
          <polygon points="36,60 40,36 36,42 32,36" fill="var(--muted)" />
          <circle cx="36" cy="36" r="4" fill="var(--card)" stroke="var(--ink)" strokeWidth="1.5" />
        </svg>
      </div>

      <p className="loading-step-text">{STEPS[step]}</p>

      <div className="step-dots">
        {STEPS.map((_, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
            <div className={`step-dot ${i < step ? 'step-dot--done' : i === step ? 'step-dot--active' : ''}`} />
            {i < STEPS.length - 1 && (
              <div className="step-dashes">
                {[0, 1, 2].map((j) => (
                  <div key={j} className={`step-dash ${i < step ? 'step-dash--done' : ''}`} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="step-progress-track">
        <div className="step-progress-fill" style={{ width: `${progressPct}%` }} />
      </div>
      <p className="step-count">Step {step + 1} of {STEPS.length}</p>
    </div>
  );
}
