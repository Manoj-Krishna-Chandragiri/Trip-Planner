import { ArrowRight, Compass, MapPinned, Mic, ShieldCheck } from 'lucide-react';
import TopoBackground from './TopoBackground';

const HIGHLIGHTS = [
  {
    icon: Mic,
    title: 'Voice-Powered Planning',
    text: 'Create itineraries hands-free with natural speech and instant transcript capture.',
  },
  {
    icon: MapPinned,
    title: 'Real Map Geocoding',
    text: 'Every stop is verified against OpenStreetMap coordinates before it reaches the trip.',
  },
  {
    icon: ShieldCheck,
    title: 'Smart Transport Sanity',
    text: 'Geographic guardrails prevent impossible travel routes before submission ever starts.',
  },
];

export default function WelcomeScreen({ onContinue }) {
  return (
    <div className="welcome-screen">
      <div className="welcome-screen__blob welcome-screen__blob--navy" aria-hidden="true" />
      <div className="welcome-screen__blob welcome-screen__blob--amber" aria-hidden="true" />
      <TopoBackground />
      <div className="welcome-screen__content">
        <div className="welcome-screen__hero">
          <div className="welcome-screen__icon">
            <Compass size={40} strokeWidth={1.5} />
          </div>
          <p className="welcome-screen__eyebrow">AI Trip Planner</p>
          <h1>Plan routes that feel fast, grounded, and actually possible.</h1>
          <p className="welcome-screen__lede">
            Voice-first trip planning, real map enrichment, and transport sanity checks wrapped in a polished itinerary engine.
          </p>
          <button className="welcome-cta" onClick={onContinue}>
            <span>Get Started</span>
            <ArrowRight size={16} className="welcome-cta__icon" />
          </button>
        </div>

        <div className="welcome-screen__features" aria-label="Product highlights">
          {HIGHLIGHTS.map(({ icon: Icon, title, text }) => (
            <article key={title} className="feature-card">
              <div className="feature-card__icon">
                <Icon size={18} strokeWidth={2} />
              </div>
              <h2>{title}</h2>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
