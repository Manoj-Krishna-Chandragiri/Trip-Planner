// Pure utility functions for itinerary state mutations.
//
// INTERVIEW NOTE: Why pure functions that return new objects?
// React state updates must be immutable — mutating the previous state
// directly causes React to skip re-renders (same object reference).
// Every function here returns a brand-new top-level object so React
// always detects the change.

// Remove a stop from a specific day by its ID.
export function removeStopFromDay(itinerary, dayIndex, stopId) {
  const days = itinerary.days.map((day, i) => {
    if (i !== dayIndex) return day;
    return {
      ...day,
      stops: day.stops.filter(stop => stop.id !== stopId),
    };
  });
  return { ...itinerary, days };
}

// Reorder stops within a day using source/destination indices.
// Used by both drag-and-drop (from @hello-pangea/dnd's onDragEnd)
// and the up/down arrow buttons.
export function reorderStopsInDay(itinerary, dayIndex, sourceIndex, destIndex) {
  if (sourceIndex === destIndex) return itinerary; // No-op — same position

  const days = itinerary.days.map((day, i) => {
    if (i !== dayIndex) return day;
    const stops = [...day.stops];                  // Shallow copy of the array
    const [moved] = stops.splice(sourceIndex, 1);  // Remove from source
    stops.splice(destIndex, 0, moved);             // Insert at destination
    return { ...day, stops };
  });

  return { ...itinerary, days };
}

// Move a stop from one day to another (or reorder within the same day).
//
// INTERVIEW NOTE: Why splice both days in the SAME .map() pass instead of
// two separate calls (removeStopFromDay then an "insert" function)? Because
// sourceDayIndex and destDayIndex are indices into the SAME days array --
// removing from source first would shift indices if you then tried to
// insert using the original array, and building two intermediate itinerary
// objects is wasted work. One pass, one new array, no index drift.
export function moveStopBetweenDays(itinerary, sourceDayIndex, destDayIndex, sourceIndex, destIndex) {
  if (sourceDayIndex === destDayIndex) {
    return reorderStopsInDay(itinerary, sourceDayIndex, sourceIndex, destIndex);
  }

  const stop = itinerary.days[sourceDayIndex]?.stops[sourceIndex];
  if (!stop) return itinerary; // Nothing at that index -- no-op rather than throw

  const days = itinerary.days.map((day, i) => {
    if (i === sourceDayIndex) {
      const stops = [...day.stops];
      stops.splice(sourceIndex, 1);
      return { ...day, stops };
    }
    if (i === destDayIndex) {
      const stops = [...day.stops];
      stops.splice(destIndex, 0, stop);
      return { ...day, stops };
    }
    return day;
  });

  return { ...itinerary, days };
}

// Format seconds into human-readable duration: "12 min", "1h 25 min"
export function formatDuration(seconds) {
  if (!seconds) return null;
  const totalMins = Math.round(seconds / 60);
  if (totalMins < 60) return `${totalMins} min`;
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return m > 0 ? `${h}h ${m} min` : `${h}h`;
}

// Format meters: "450 m", "3.2 km"
export function formatDistance(meters) {
  if (!meters) return null;
  if (meters < 1000) return `${meters} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
