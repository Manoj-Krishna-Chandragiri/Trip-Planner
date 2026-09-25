import { useEffect, useRef, useState } from 'react';
import { MapPin, Mic, MicOff } from 'lucide-react';
import LocationModal from './LocationModal';
import { reverseGeocode } from '../services/geolocation';

const WALK_CYCLE_ALERT = 'Walking/Cycling is not physically possible across oceans/major distances. Please select Flying or Transit.';
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';

const TRANSPORT_MODES = [
  { label: 'Walking', icon: '🚶' },
  { label: 'Cycling', icon: '🚲' },
  { label: 'Driving', icon: '🚗' },
  { label: 'Public transit', icon: '🚌' },
  { label: 'Train', icon: '🚆' },
  { label: 'Flying', icon: '✈️' },
];

const TRIP_TEMPLATES = [
  {
    label: 'Weekend in Goa (Driving, 3 Days)',
    travelingFrom: 'Mumbai, India',
    destination: 'Goa, India',
    transportMode: 'Driving',
    duration: 3,
    extra: 'Beach cafés, sunset points, and relaxed coastal drives.',
  },
  {
    label: '3-Day Food & Culture Tour in Jaipur (Walking, 3 Days)',
    travelingFrom: 'Jaipur, India',
    destination: 'Jaipur, India',
    transportMode: 'Walking',
    duration: 3,
    extra: 'Palaces, street food, bazaars, and heritage lanes.',
  },
  {
    label: '5-Day Tokyo Highlights (Public Transit, 5 Days)',
    travelingFrom: 'Tokyo, Japan',
    destination: 'Tokyo, Japan',
    transportMode: 'Public transit',
    duration: 5,
    extra: 'Shrines, food markets, skyline views, and easy transit hops.',
  },
];

const SpeechRecognitionCtor = typeof window !== 'undefined'
  ? window.SpeechRecognition || window.webkitSpeechRecognition
  : null;

export default function EmptyState({ onSubmit }) {
  const [destination, setDestination] = useState('');
  const [transportMode, setTransportMode] = useState('');
  const [duration, setDuration] = useState(3);
  const [extra, setExtra] = useState('');
  const [travelingFrom, setTravelingFrom] = useState('');
  const [originCoords, setOriginCoords] = useState(null); // { lat, lon } | null
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [locating, setLocating] = useState(false);
  const [activeSpeechField, setActiveSpeechField] = useState(null);
  const [speechSupported] = useState(Boolean(SpeechRecognitionCtor));
  const [speechError, setSpeechError] = useState('');
  const recognitionRef = useRef(null);

  const parsedDuration = Number(duration);
  const canSubmit = Boolean(destination.trim() && transportMode && parsedDuration >= 1);
  const showDurationWarning = Number.isFinite(parsedDuration) && parsedDuration > 14;

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort?.();
    };
  }, []);

  function stopSpeechRecognition() {
    recognitionRef.current?.abort?.();
    recognitionRef.current = null;
    setActiveSpeechField(null);
  }

  function setSpeechFieldValue(field, transcript) {
    const cleanTranscript = transcript.trim();
    if (!cleanTranscript) return;

    const applyValue = (currentValue, append = true) => {
      const current = currentValue.trim();
      if (!current) return cleanTranscript;
      return append ? `${current} ${cleanTranscript}` : cleanTranscript;
    };

    if (field === 'destination') {
      setDestination((current) => applyValue(current, true));
    } else if (field === 'extra') {
      setExtra((current) => applyValue(current, true));
    }
  }

  function startSpeechRecognition(field) {
    if (!speechSupported) {
      setSpeechError('Speech recognition is not supported in this browser.');
      return;
    }

    if (activeSpeechField === field) {
      stopSpeechRecognition();
      return;
    }

    stopSpeechRecognition();
    setSpeechError('');

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setActiveSpeechField(field);
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript || '';
      setSpeechFieldValue(field, transcript);
    };
    recognition.onerror = () => {
      setSpeechError('Could not understand that audio input. Please try again.');
      setActiveSpeechField(null);
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setActiveSpeechField((current) => (current === field ? null : current));
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch {
      setSpeechError('Speech recognition could not start in this browser.');
      recognitionRef.current = null;
      setActiveSpeechField(null);
    }
  }

  function haversineKm(a, b) {
    const toRad = (value) => (value * Math.PI) / 180;
    const earthRadiusKm = 6371;
    const deltaLat = toRad(b.lat - a.lat);
    const deltaLon = toRad(b.lon - a.lon);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
    return 2 * earthRadiusKm * Math.asin(Math.sqrt(h));
  }

  async function fetchPlaceGeo(query, coords) {
    try {
      if (coords?.lat != null && coords?.lon != null) {
        const response = await fetch(`${NOMINATIM_BASE}/reverse?format=jsonv2&lat=${coords.lat}&lon=${coords.lon}&zoom=5`);
        if (!response.ok) return null;
        const data = await response.json();
        const address = data.address || {};
        return {
          lat: coords.lat,
          lon: coords.lon,
          countryCode: (address.country_code || '').toUpperCase() || null,
        };
      }

      if (!query?.trim()) return null;
      const response = await fetch(`${NOMINATIM_BASE}/search?format=jsonv2&limit=1&q=${encodeURIComponent(query.trim())}`);
      if (!response.ok) return null;
      const data = await response.json();
      const place = Array.isArray(data) ? data[0] : null;
      if (!place) return null;
      const address = place.address || {};
      return {
        lat: Number.parseFloat(place.lat),
        lon: Number.parseFloat(place.lon),
        countryCode: (address.country_code || '').toUpperCase() || null,
      };
    } catch {
      return null;
    }
  }

  function handleAllowLocation() {
    setShowLocationModal(false);
    if (!navigator.geolocation) {
      setTravelingFrom('Location unavailable');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {

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

  function applyTemplate(template) {
    stopSpeechRecognition();
    setTravelingFrom(template.travelingFrom);
    setDestination(template.destination);
    setTransportMode(template.transportMode);
    setDuration(template.duration);
    setExtra(template.extra);
    setOriginCoords(null);
    setSpeechError('');
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;

    const transportIsWalkOrCycle = transportMode === 'Walking' || transportMode === 'Cycling';

    const submitTrip = async () => {
      if (transportIsWalkOrCycle) {
        const [originGeo, destinationGeo] = await Promise.all([
          fetchPlaceGeo(travelingFrom, originCoords),
          fetchPlaceGeo(destination.trim(), null),
        ]);

        const countriesDiffer = originGeo?.countryCode && destinationGeo?.countryCode && originGeo.countryCode !== destinationGeo.countryCode;
        const distanceKm = originGeo && destinationGeo && Number.isFinite(originGeo.lat) && Number.isFinite(originGeo.lon) && Number.isFinite(destinationGeo.lat) && Number.isFinite(destinationGeo.lon)
          ? haversineKm(originGeo, destinationGeo)
          : null;

        if (countriesDiffer || (distanceKm != null && distanceKm > 1000)) {
          window.alert(WALK_CYCLE_ALERT);
          return;
        }
      }

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
    };

    submitTrip();
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
          <div className="field-with-button field-with-button--with-mic">
            <input
              type="text"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="e.g. Mumbai, or Kyoto, Japan"
              required
            />
            <button
              type="button"
              className={`mic-btn ${activeSpeechField === 'destination' ? 'mic-btn--active' : ''}`}
              onClick={() => startSpeechRecognition('destination')}
              disabled={!speechSupported}
              aria-pressed={activeSpeechField === 'destination'}
              aria-label="Use speech to fill destination"
              title={speechSupported ? 'Use speech to fill destination' : 'Speech recognition is not supported in this browser'}
            >
              {activeSpeechField === 'destination' ? <MicOff size={15} /> : <Mic size={15} />}
            </button>
          </div>
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
              onChange={(e) => setDuration(e.target.value === '' ? '' : Number(e.target.value))}
            />
            <span>days</span>
          </div>
          {showDurationWarning && (
            <p className="field-warning" role="status">
              For best performance, itineraries are capped at 14 days.
            </p>
          )}
        </label>

        <label>
          Anything else? <span className="optional-tag">(optional)</span>
          <div className="field-with-button field-with-button--textarea">
            <textarea
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder="e.g. want to grab a bite on the way, traveling with kids, avoid highways..."
              rows={2}
            />
            <button
              type="button"
              className={`mic-btn mic-btn--textarea ${activeSpeechField === 'extra' ? 'mic-btn--active' : ''}`}
              onClick={() => startSpeechRecognition('extra')}
              disabled={!speechSupported}
              aria-pressed={activeSpeechField === 'extra'}
              aria-label="Use speech to fill additional notes"
              title={speechSupported ? 'Use speech to fill additional notes' : 'Speech recognition is not supported in this browser'}
            >
              {activeSpeechField === 'extra' ? <MicOff size={15} /> : <Mic size={15} />}
            </button>
          </div>
        </label>

        <div className="template-pills" aria-label="Popular Trips">
          <span className="template-pills__label">Popular Trips</span>
          <div className="template-pills__list">
            {TRIP_TEMPLATES.map((template) => (
              <button
                key={template.label}
                type="button"
                className="template-pill"
                onClick={() => applyTemplate(template)}
              >
                {template.label}
              </button>
            ))}
          </div>
        </div>

        {speechError && (
          <p className="field-warning" role="alert">
            {speechError}
          </p>
        )}

        <button type="submit" className="basics-submit" disabled={!canSubmit}>
          Plan My Trip
        </button>
      </form>

      {showLocationModal && (
        <LocationModal onAllow={handleAllowLocation} onDismiss={() => setShowLocationModal(false)} />
      )}
    </div>
  );
}
