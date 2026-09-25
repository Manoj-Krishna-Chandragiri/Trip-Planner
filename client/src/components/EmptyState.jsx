import { useState } from 'react';
import { MapPin } from 'lucide-react';
import LocationModal from './LocationModal';
import { reverseGeocode } from '../services/geolocation';

const TRANSPORT_MODES = [
  { label: 'Walking', icon: '🚶' },
  { label: 'Cycling', icon: '🚲' },
  { label: 'Driving', icon: '🚗' },
  { label: 'Public transit', icon: '🚌' },
  { label: 'Train', icon: '🚆' },
  { label: 'Flying', icon: '✈️' },
];

// onSubmit now receives an object, not a bare string, so the backend can
// use travelingFrom/originLat/originLon/transportMode as real structured
// data (for the origin distance calculation) while description remains
// the free-text field Gemini reads -- this still satisfies the
// assignment's "free-form text input" requirement via the "anything
// else" field below, it's just no longer the ONLY thing submitted.
export default function EmptyState({ onSubmit }) {
  const [destination, setDestination] = useState('');
  const [transportMode, setTransportMode] = useState('');
  const [duration, setDuration] = useState(3);
  const [extra, setExtra] = useState('');
  const [travelingFrom, setTravelingFrom] = useState('');
  const [originCoords, setOriginCoords] = useState(null); // { lat, lon } | null
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [locating, setLocating] = useState(false);

  const canSubmit = destination.trim() && transportMode;

  function handleAllowLocation() {
    setShowLocationModal(false);
    if (!navigator.geolocation) {
      setTravelingFrom('Location unavailable');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        // Capture the REAL coordinates -- unlike a mock, these get sent
        // straight to the backend for the origin distance calculation,
        // skipping a lossy text-label round trip through geocoding again.
        const { latitude, longitude } = position.coords;
        setOriginCoords({ lat: latitude, lon: longitude });
        const label = await reverseGeocode(latitude, longitude);
        setTravelingFrom(label || 'Your current location');
        setLocating(false);
      },
      () => {
        setTravelingFrom('Location unavailable');
        setLocating(false);
      },
      { timeout: 8000 }
    );
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;

    const parts = [`A ${duration}-day trip to ${destination.trim()}`];
    if (travelingFrom.trim()) parts.push(`from ${travelingFrom.trim()}`);
    parts.push(`traveling by ${transportMode.toLowerCase()}`);
    const description = parts.join(', ') + '.' + (extra.trim() ? ' ' + extra.trim() : '');

    onSubmit({
      description,
      travelingFrom: travelingFrom.trim() || null,
      originLat: originCoords?.lat ?? null,
      originLon: originCoords?.lon ?? null,
      transportMode,
    });
  }

  return (
    <div className="empty-state">
      <h1>Where are we headed?</h1>
      <p className="empty-state__sub">
        Every stop gets checked against real map data before it reaches you.
      </p>

      <form className="basics-form" onSubmit={handleSubmit}>
        <label>
          Traveling from <span className="optional-tag">(optional)</span>
          <div className="field-with-button">
            <input
              type="text"
              value={travelingFrom}
              onChange={(e) => { setTravelingFrom(e.target.value); setOriginCoords(null); }}
              placeholder="e.g. Bangalore, India"
            />
            <button
              type="button"
              className="locate-btn"
              onClick={() => setShowLocationModal(true)}
              disabled={locating}
              title="Use my current location"
              aria-label="Use my current location"
            >
              {locating ? '…' : <MapPin size={15} />}
            </button>
          </div>
        </label>

        <label>
          Destination
          <input
            type="text"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="e.g. Mumbai, or Kyoto, Japan"
            required
          />
        </label>

        <label>
          Mode of transportation
          <div className="transport-options" role="radiogroup" aria-label="Mode of transportation">
            {TRANSPORT_MODES.map(({ label: mode, icon }) => (
              <button
                type="button"
                key={mode}
                role="radio"
                aria-checked={transportMode === mode}
                className={`transport-chip ${transportMode === mode ? 'transport-chip--selected' : ''}`}
                onClick={() => setTransportMode(mode)}
              >
                {icon} {mode}
              </button>
            ))}
          </div>
        </label>

        <label>
          How long will you stay?
          <div className="duration-input">
            <input
              type="number"
              min={1}
              max={30}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
            <span>days</span>
          </div>
        </label>

        <label>
          Anything else? <span className="optional-tag">(optional)</span>
          <textarea
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            placeholder="e.g. want to grab a bite on the way, traveling with kids, avoid highways..."
            rows={2}
          />
        </label>

        <button type="submit" className="basics-submit" disabled={!canSubmit}>
          Plan my trip
        </button>
      </form>

      {showLocationModal && (
        <LocationModal onAllow={handleAllowLocation} onDismiss={() => setShowLocationModal(false)} />
      )}
    </div>
  );
}
