

import { useState, useCallback, useRef } from 'react';
import { removeStopFromDay, reorderStopsInDay, moveStopBetweenDays } from '../utils/itineraryHelpers';

export function useTripPlanner() {
  const [status, setStatus] = useState('idle');    // 'idle' | 'loading' | 'success' | 'error' | 'fallback'
  const [itinerary, setItinerary] = useState(null);
  const [error, setError] = useState(null);
  const [lastDescription, setLastDescription] = useState('');

  const requestIdRef = useRef(0);

  const abortControllerRef = useRef(null);

  const lastParamsRef = useRef(null);

  const submit = useCallback(async (input) => {

    const params = typeof input === 'string' ? { description: input } : (input || {});
    const description = params.description;
    if (!description?.trim()) return;

    lastParamsRef.current = params;

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

      if (currentId !== requestIdRef.current) return;

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || errData.error || `Server error ${response.status}`);
      }

      const data = await response.json();

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

  const retry = useCallback(() => {
    if (lastParamsRef.current) submit(lastParamsRef.current);
  }, [submit]);

  const resetState = useCallback(() => {
    abortControllerRef.current?.abort();
    requestIdRef.current += 1;
    lastParamsRef.current = null;
    setStatus('idle');
    setItinerary(null);
    setError(null);
    setLastDescription('');
  }, []);

  const removeStop = useCallback((dayIndex, stopId) => {
    setItinerary(prev => prev ? removeStopFromDay(prev, dayIndex, stopId) : prev);
  }, []);

  const reorderStops = useCallback((dayIndex, sourceIndex, destIndex) => {
    setItinerary(prev => prev ? reorderStopsInDay(prev, dayIndex, sourceIndex, destIndex) : prev);
  }, []);

  const moveStop = useCallback((sourceDayIndex, destDayIndex, sourceIndex, destIndex) => {
    setItinerary(prev => prev ? moveStopBetweenDays(prev, sourceDayIndex, destDayIndex, sourceIndex, destIndex) : prev);
  }, []);

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
    resetState,
  };
}
