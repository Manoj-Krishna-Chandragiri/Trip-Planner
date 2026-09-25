

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

export function formatDuration(seconds) {
  if (!seconds) return null;
  const totalMins = Math.round(seconds / 60);
  if (totalMins < 60) return `${totalMins} min`;
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return m > 0 ? `${h}h ${m} min` : `${h}h`;
}

export function formatDistance(meters) {
  if (!meters) return null;
  if (meters < 1000) return `${meters} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
