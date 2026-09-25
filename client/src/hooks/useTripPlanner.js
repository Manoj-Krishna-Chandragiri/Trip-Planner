// Core state machine hook for the trip planner.
//
// INTERVIEW NOTE — Race condition guard (two layers):
//
// Layer 1 — AbortController:
//   Cancels the HTTP request itself when a new submit fires.
//   This is best-effort: the browser may have already sent the request.
//
// Layer 2 — requestId:
//   A monotonically-increasing counter. Each submit captures its own ID.
//   When the response arrives, if the counter has moved on (a newer submit
//   happened while we were waiting), the stale response is silently discarded.
//   This handles cases where abort wasn't fast enough.
//
// Both layers together guarantee: only the LATEST submitted request's
// response ever updates state.

import { useState, useCallback, useRef } from 'react';
import { removeStopFromDay, reorderStopsInDay, moveStopBetweenDays } from '../utils/itineraryHelpers';

export function useTripPlanner() {
  const [status, setStatus] = useState('idle');    // 'idle' | 'loading' | 'success' | 'error' | 'fallback'
  const [itinerary, setItinerary] = useState(null);
  const [error, setError] = useState(null);
  const [lastDescription, setLastDescription] = useState('');

  // requestIdRef: incremented on every submit. Used for stale response detection.
  const requestIdRef = useRef(0);
  // abortControllerRef: holds the AbortController for the current in-flight request.
  const abortControllerRef = useRef(null);
  // Full params of the last submission (not just the description) so
  // retry() can replay travelingFrom/origin/transportMode too, not just
  // re-send the text.
  const lastParamsRef = useRef(null);

  const submit = useCallback(async (input) => {
    // The compact header search bar calls submit(description) with a
    // plain string; the trip-basics form calls submit({ description,
    // travelingFrom, originLat, originLon, transportMode }). Normalize
    // both into one shape here so everything downstream only deals with
    // one case.
    const params = typeof input === 'string' ? { description: input } : (input || {});
    const description = params.description;
    if (!description?.trim()) return;

    lastParamsRef.current = params;

    // Cancel any in-flight request before starting a new one
    abortControllerRef.current?.abort();

    const currentId = ++requestIdRef.current;  // Capture this request's ID
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setStatus('loading');
    setError(null);
    setLastDescription(description);

    try {
      const response = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: description.trim(),
          travelingFrom: params.travelingFrom || null,
          originLat: params.originLat ?? null,
          originLon: params.originLon ?? null,
          transportMode: params.transportMode || null,
        }),
        signal: controller.signal,
      });

      // Stale check #1: did a newer request fire while fetch() was in progress?
      if (currentId !== requestIdRef.current) return;

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || errData.error || `Server error ${response.status}`);
      }

      const data = await response.json();

      // Stale check #2: JSON parsing of a large itinerary can take a moment
      if (currentId !== requestIdRef.current) return;

      setItinerary(data.itinerary);
      setStatus(data.itinerary?.isFallback ? 'fallback' : 'success');

    } catch (err) {
      if (err.name === 'AbortError') return;           // Intentionally cancelled
      if (currentId !== requestIdRef.current) return;  // Stale, discard silently

      setStatus('error');
      setError(err.message || 'An unexpected error occurred. Please try again.');
    }
  }, []);

  // Retry re-submits the exact last params (description + origin + mode),
  // not just the text, so a retry after an origin-aware request stays origin-aware.
  const retry = useCallback(() => {
    if (lastParamsRef.current) submit(lastParamsRef.current);
  }, [submit]);

  // ── Local itinerary mutations (no re-fetch needed) ──────────────
  // These are pure functions — they return new objects, never mutate in place.

  const removeStop = useCallback((dayIndex, stopId) => {
    setItinerary(prev => prev ? removeStopFromDay(prev, dayIndex, stopId) : prev);
  }, []);

  const reorderStops = useCallback((dayIndex, sourceIndex, destIndex) => {
    setItinerary(prev => prev ? reorderStopsInDay(prev, dayIndex, sourceIndex, destIndex) : prev);
  }, []);

  const moveStop = useCallback((sourceDayIndex, destDayIndex, sourceIndex, destIndex) => {
    setItinerary(prev => prev ? moveStopBetweenDays(prev, sourceDayIndex, destDayIndex, sourceIndex, destIndex) : prev);
  }, []);

  // ── Diff-based refinement ───────────────────────────────────────
  const applyRefinement = useCallback(async (refinementRequest) => {
    if (!itinerary || !refinementRequest?.trim()) return;

    abortControllerRef.current?.abort();

    const currentId = ++requestIdRef.current;
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setStatus('loading');
    setError(null);

    try {
      const response = await fetch('/api/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentItinerary: itinerary,
          refinementRequest: refinementRequest.trim(),
        }),
        signal: controller.signal,
      });

      if (currentId !== requestIdRef.current) return;

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || errData.error || 'Refinement failed');
      }

      const data = await response.json();
      if (currentId !== requestIdRef.current) return;

      setItinerary(data.itinerary);
      setStatus(data.itinerary?.isFallback ? 'fallback' : 'success');

    } catch (err) {
      if (err.name === 'AbortError') return;
      if (currentId !== requestIdRef.current) return;

      setStatus('error');
      setError(err.message || 'Refinement failed. Please try again.');
    }
  }, [itinerary]);

  return {
    status,
    itinerary,
    error,
    submit,
    retry,
    removeStop,
    reorderStops,
    moveStop,
    applyRefinement,
    lastDescription,
  };
}
