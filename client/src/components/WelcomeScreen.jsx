import { Compass } from 'lucide-react';
import TopoBackground from './TopoBackground';

export default function WelcomeScreen({ onContinue }) {
  return (
    <div className="welcome-screen">
      <div className="welcome-screen__blob welcome-screen__blob--navy" aria-hidden="true" />
      <div className="welcome-screen__blob welcome-screen__blob--amber" aria-hidden="true" />
      <TopoBackground />
      <div className="welcome-screen__content">
        <div className="welcome-screen__icon">
          <Compass size={40} strokeWidth={1.5} />
        </div>
        <h1>Welcome to Trip Planner!</h1>
        <p>Let's get you started.</p>
        <button onClick={onContinue}>Get Started</button>
      </div>
    </div>
  );
}
