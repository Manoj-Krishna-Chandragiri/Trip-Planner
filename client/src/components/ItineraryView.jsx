import { useState, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { MapContainer, TileLayer, Marker, Polyline, Popup } from 'react-leaflet';
import {
  GripVertical, ArrowUp, ArrowDown, X, MapPin, Hotel, Compass,
  CheckCircle2, AlertCircle,
} from 'lucide-react';
import { formatDuration, formatDistance } from '../utils/itineraryHelpers';
import { fetchDailyForecast, describeWeatherCode } from '../services/weather';

// Plain redirect links -- no API, no key, no cost. The user sees Google's
// own real reviews/photos/ratings on Google's own site; nothing is
// fetched, displayed, or fabricated inside this app.
function googleMapsUrl(query) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
function googleHotelsNearUrl(query) {
  return `https://www.google.com/maps/search/hotels+near+${encodeURIComponent(query)}`;
}

// Category label for the color-coded type badge. The `type` value itself
// comes straight from Gemini's structured output (server/services/gemini.js
// already asks for one of these five and describes it as being "used for a
// color-coded category badge in the UI") -- this just supplies the display
// label and CSS hook; the color values live in App.css as --type-* vars so
// they can vary by light/dark theme without any JS theme lookup here.
const TYPE_LABELS = {
  landmark: 'Landmark',
  food: 'Food & Drink',
  nature: 'Nature',
  museum: 'Museum',
  shopping: 'Shopping',
};

export default function ItineraryView({ itinerary, isFallback, onRemoveStop, onReorderStops, onMoveStop, onApplyRefinement }) {
  // Which stop IDs are currently expanded to show description + reason.
  // A Set (not an array) so toggling is O(1) and duplicate-safe.
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  // Which stop IDs the user has checked off as visited. Same pattern as
  // expandedIds: local UI state only, not sent to the backend, and not
  // persisted across a reload -- this is a personal checklist, not itinerary
  // data, so it doesn't belong in the itinerary object itself.
  const [visitedIds, setVisitedIds] = useState(() => new Set());
  const [refineText, setRefineText] = useState('');
  const [forecast, setForecast] = useState(null); // array indexed by day, or null if unavailable

  // Weather is fetched once per itinerary, keyed off the first stop we
  // actually have coordinates for (an unverified stop has none). This is
  // best-effort context, not a hard requirement -- if it fails, forecast
  // stays null and the day headers just don't show a weather chip.
  useEffect(() => {
    const anchor = itinerary.days.flatMap((d) => d.stops).find((s) => s.lat != null && s.lon != null);
    if (!anchor) return;
    fetchDailyForecast(anchor.lat, anchor.lon, itinerary.days.length).then(setForecast);
  }, [itinerary]);

  function toggleExpanded(id) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // Separate from expand/collapse on purpose: checking the box shouldn't
  // also open the stop's details. stopPropagation keeps the click from
  // bubbling up to the card's expand toggle.
  function toggleVisited(id, e) {
    e.stopPropagation();
    setVisitedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // INTERVIEW NOTE: One shared DragDropContext, not one per day.
  // @hello-pangea/dnd only lets you drag between Droppables that share a
  // DragDropContext ancestor -- with a separate context per day (the old
  // structure), a drag could never leave the day it started in, because
  // each day's Droppable was isolated inside its own context. Each day
  // still gets its own <Droppable droppableId={`day-${i}`}>, so within-day
  // reordering works exactly as before; only the wrapping context moved.
  function handleDragEnd(result) {
    if (!result.destination) return; // Dropped outside any droppable

    const sourceDayIndex = Number(result.source.droppableId.replace('day-', ''));
    const destDayIndex = Number(result.destination.droppableId.replace('day-', ''));
    const sourceIndex = result.source.index;
    const destIndex = result.destination.index;

    if (sourceDayIndex === destDayIndex) {
      if (sourceIndex === destIndex) return;
      onReorderStops(sourceDayIndex, sourceIndex, destIndex);
    } else {
      onMoveStop(sourceDayIndex, destDayIndex, sourceIndex, destIndex);
    }
  }

  // Up/down buttons as a mobile-friendly alternative to drag -- touch
  // drag-and-drop can be unreliable, this guarantees reordering always
  // works regardless of device. Extended to cross day boundaries: pressing
  // "up" on a day's first stop sends it to the END of the previous day;
  // pressing "down" on a day's last stop sends it to the START of the next
  // day. Buttons are only disabled when there's truly nowhere to go (up on
  // the very first stop of Day 1, down on the very last stop of the last
  // day) -- see the disabled= checks where these are called below.
  function handleMoveUp(dayIndex, stopIndex) {
    if (stopIndex > 0) {
      onReorderStops(dayIndex, stopIndex, stopIndex - 1);
      return;
    }
    if (dayIndex > 0) {
      const destDayIndex = dayIndex - 1;
      const destIndex = itinerary.days[destDayIndex].stops.length; // end of previous day
      onMoveStop(dayIndex, destDayIndex, stopIndex, destIndex);
    }
  }

  function handleMoveDown(dayIndex, stopIndex, isLast) {
    if (!isLast) {
      onReorderStops(dayIndex, stopIndex, stopIndex + 1);
      return;
    }
    if (dayIndex < itinerary.days.length - 1) {
      onMoveStop(dayIndex, dayIndex + 1, stopIndex, 0); // start of next day
    }
  }

  function handleRefineSubmit(e) {
    e.preventDefault();
    if (!refineText.trim()) return;
    onApplyRefinement(refineText.trim());
    setRefineText('');
  }

  return (
    <div className="itinerary">
      {isFallback && (
        <div className="fallback-banner" role="status">
          <strong>Basic itinerary.</strong>{' '}
          {itinerary.fallbackReason || 'The AI service is unavailable right now — this was built from map data instead.'}
        </div>
      )}

      <h1 className="itinerary__title">{itinerary.tripTitle}</h1>
      {forecast && (
        <p className="weather-caveat">
          Weather assumes the trip starts today — actual dates may differ.
        </p>
      )}

      <DragDropContext onDragEnd={handleDragEnd}>
        {itinerary.days.map((day, dayIndex) => {
          // Only stops we could actually geocode get plotted — an
          // unverified stop has no reliable coordinates to show.
          const verifiedStops = day.stops.filter((s) => s.verified && s.lat != null);
          const dayForecast = forecast?.[dayIndex];
          const weatherInfo = dayForecast ? describeWeatherCode(dayForecast.weatherCode) : null;
          const isRainy = dayForecast && dayForecast.precipitationChance >= 40;

          return (
            <section key={day.dayNumber} className="day-block">
              {day.transitionFromPrevious && (
                day.transitionFromPrevious.isUnrealistic ? (
                  <div className="fallback-banner" role="alert">
                    <strong>⚠️ Long jump between days.</strong> This day starts roughly{' '}
                    {formatDistance(day.transitionFromPrevious.distanceMeters)} from where the previous
                    day ended{day.transitionFromPrevious.isStraightLine ? ' (straight-line estimate)' : ''} —
                    that's not realistic for {itinerary.transportMode || 'the selected mode'} in a single
                    overnight transition. Consider a flight or an explicit travel day between them.
                  </div>
                ) : (
                  <p className="origin-chip">
                    <Compass size={13} className="origin-chip__icon" />{' '}
                    {formatDistance(day.transitionFromPrevious.distanceMeters)} ·{' '}
                    {formatDuration(day.transitionFromPrevious.durationSeconds)} (est.) from the previous day's last stop
                  </p>
                )
              )}
              <div className="day-block__header">
                <h2>Day {day.dayNumber}: {day.title}</h2>
                {day.tight && (
                  <span
                    className="badge badge--warning"
                    title={`~${Math.round(day.totalPlannedMinutes / 60)}h of stops + travel planned`}
                  >
                    Tight schedule
                  </span>
                )}
                {dayForecast && (
                  <span
                    className={`badge ${isRainy ? 'badge--warning' : 'badge--info'}`}
                    title={`${weatherInfo.label}, ${Math.round(dayForecast.tempMin)}–${Math.round(dayForecast.tempMax)}°C`}
                  >
                    {weatherInfo.icon} {dayForecast.precipitationChance}% rain
                  </span>
                )}
                <div className="day-block__links">
                  {/* Hotels near this day's LAST stop, not the trip's overall
                      destination -- where to stay changes day to day on a
                      multi-day trip. */}
                  {day.stops.length > 0 && (
                    <a
                      className="link-out"
                      href={googleHotelsNearUrl(day.stops[day.stops.length - 1].displayName || `${day.stops[day.stops.length - 1].name}, ${itinerary.region}`)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Hotel size={12} /> Find hotels nearby
                    </a>
                  )}
                </div>
              </div>

              {dayIndex === 0 && itinerary.originInfo && (
                <p className="origin-chip">
                  <Compass size={13} className="origin-chip__icon" />{' '}
                  {formatDistance(itinerary.originInfo.distanceMeters)} · {formatDuration(itinerary.originInfo.durationSeconds)}
                  {itinerary.originInfo.durationIsEstimate ? ' (est.)' : ''} from {itinerary.originInfo.label}
                </p>
              )}

              {verifiedStops.length >= 2 && (
                <div className="day-block__map">
                  <MapContainer
                    key={`map-day-${day.dayNumber}`}
                    bounds={verifiedStops.map((s) => [s.lat, s.lon])}
                    boundsOptions={{ padding: [24, 24] }}
                    scrollWheelZoom={false}
                    style={{ height: '180px', width: '100%' }}
                  >
                    <TileLayer
                      attribution="&copy; OpenStreetMap contributors"
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <Polyline
                      positions={verifiedStops.map((s) => [s.lat, s.lon])}
                      pathOptions={{ color: 'var(--accent)', dashArray: '6 6', weight: 3 }}
                    />
                    {verifiedStops.map((s, i) => (
                      <Marker key={s.id} position={[s.lat, s.lon]}>
                        <Popup>{i + 1}. {s.name}</Popup>
                      </Marker>
                    ))}
                  </MapContainer>
                </div>
              )}

              <Droppable droppableId={`day-${dayIndex}`}>
                {(provided) => (
                  <ol className="stop-list" ref={provided.innerRef} {...provided.droppableProps}>
                    {day.stops.map((stop, stopIndex) => {
                      const isFirst = stopIndex === 0;
                      const isLast = stopIndex === day.stops.length - 1;
                      const isExpanded = expandedIds.has(stop.id);
                      const isVisited = visitedIds.has(stop.id);
                      const typeLabel = stop.type && TYPE_LABELS[stop.type];

                      return (
                        <Draggable key={stop.id} draggableId={stop.id} index={stopIndex}>
                          {(dragProvided, dragSnapshot) => (
                            <li
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              className={`stop-card ${dragSnapshot.isDragging ? 'stop-card--dragging' : ''} ${isVisited ? 'stop-card--visited' : ''}`}
                            >
                              {/* Spine: numbered pin + dashed line down to the next stop.
                                  Stretches to match content height automatically since
                                  it's a flex row sibling — no JS measurement needed. */}
                              <div className="stop-card__spine">
                                <span className="stop-card__pin">{stopIndex + 1}</span>
                                {!isLast && <span className="stop-card__line" />}
                              </div>

                              <div className="stop-card__content">
                                <div className="stop-card__row">
                                  <span
                                    className="stop-card__handle"
                                    {...dragProvided.dragHandleProps}
                                    aria-label="Drag to reorder"
                                  >
                                    <GripVertical size={14} />
                                  </span>

                                  <input
                                    type="checkbox"
                                    className="stop-card__checkbox"
                                    checked={isVisited}
                                    onChange={(e) => toggleVisited(stop.id, e)}
                                    onClick={(e) => e.stopPropagation()}
                                    aria-label={`Mark ${stop.name} as visited`}
                                  />

                                  <button
                                    type="button"
                                    className={`stop-card__main ${isExpanded ? 'stop-card__main--expanded' : ''}`}
                                    onClick={() => toggleExpanded(stop.id)}
                                    aria-expanded={isExpanded}
                                  >
                                    <span className="stop-card__name-row">
                                      <span className={`stop-card__name ${isVisited ? 'stop-card__name--visited' : ''}`}>
                                        {stop.name}
                                      </span>
                                      {typeLabel && (
                                        <span
                                          className="badge badge--type"
                                          style={{ '--type-color': `var(--type-${stop.type})` }}
                                        >
                                          {typeLabel}
                                        </span>
                                      )}
                                      <span className={`badge ${stop.verified ? 'badge--verified' : 'badge--unverified'}`}>
                                        {stop.verified ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
                                        {stop.verified ? 'Verified' : 'Unverified'}
                                      </span>
                                    </span>
                                    <span className="stop-card__duration">{stop.suggestedDurationMinutes} min</span>
                                  </button>

                                  <div className="stop-card__actions">
                                    <button
                                      type="button"
                                      aria-label="Move up"
                                      disabled={isFirst && dayIndex === 0}
                                      onClick={() => handleMoveUp(dayIndex, stopIndex)}
                                    >
                                      <ArrowUp size={12} />
                                    </button>
                                    <button
                                      type="button"
                                      aria-label="Move down"
                                      disabled={isLast && dayIndex === itinerary.days.length - 1}
                                      onClick={() => handleMoveDown(dayIndex, stopIndex, isLast)}
                                    >
                                      <ArrowDown size={12} />
                                    </button>
                                    <button
                                      type="button"
                                      aria-label={`Remove ${stop.name}`}
                                      className="stop-card__remove"
                                      onClick={() => onRemoveStop(dayIndex, stop.id)}
                                    >
                                      <X size={12} />
                                    </button>
                                  </div>
                                </div>

                                {isExpanded && (
                                  <div className="stop-card__details">
                                    <p>{stop.description}</p>
                                    <p className="stop-card__reason">Why this stop: {stop.reason}</p>
                                    {!stop.verified && (
                                      <p className="stop-card__unverified-note">
                                        Couldn't confirm this location against map data — treat the
                                        name and details as unverified.
                                      </p>
                                    )}
                                    <a
                                      className="link-out"
                                      href={googleMapsUrl(stop.displayName || `${stop.name}, ${itinerary.region}`)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      <MapPin size={12} /> View on Google Maps
                                    </a>
                                  </div>
                                )}

                                {stop.travelToNext && (
                                  <div className="travel-chip">
                                    → {formatDuration(stop.travelToNext.durationSeconds)}
                                    {stop.travelToNext.durationIsEstimate ? ' (est.)' : ''} · {formatDistance(stop.travelToNext.distanceMeters)} to the next stop
                                  </div>
                                )}
                              </div>
                            </li>
                          )}
                        </Draggable>
                      );
                    })}
                    {provided.placeholder}
                  </ol>
                )}
              </Droppable>
            </section>
          );
        })}
      </DragDropContext>

      <form className="refine-form" onSubmit={handleRefineSubmit}>
        <input
          type="text"
          value={refineText}
          onChange={(e) => setRefineText(e.target.value)}
          placeholder='Ask for a change — e.g. "make day 2 more relaxed"'
        />
        <button type="submit" disabled={!refineText.trim()}>Update</button>
      </form>
    </div>
  );
}
