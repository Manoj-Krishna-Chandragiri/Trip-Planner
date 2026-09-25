import React, { useState } from 'react';
import { Compass } from 'lucide-react';
import { useTripPlanner } from './hooks/useTripPlanner';
import { useTheme } from './hooks/useTheme';
import TripForm from './components/TripForm';
import EmptyState from './components/EmptyState';
import WelcomeScreen from './components/WelcomeScreen';
import CursorTracker from './components/CursorTracker';
import ThemeToggle from './components/ThemeToggle';
import LoadingState from './components/LoadingState';
import ErrorState from './components/ErrorState';
import ItineraryView from './components/ItineraryView';

// App renders the correct UI state based on the state machine in useTripPlanner.
// States: idle → loading → success | error | fallback
export default function App() {
  // Separate from the data state machine below on purpose -- this is pure
  // "have we shown the intro yet" UI state, local to this component, and
  // resets to false permanently once the user clicks past it (we don't
  // want the welcome screen reappearing every time they plan a new trip).
  const [showWelcome, setShowWelcome] = useState(true);
  const { theme, toggleTheme } = useTheme();

  const {
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
  } = useTripPlanner();

  const hasResult = status === 'success' || status === 'fallback';

  return (
    <div className="app">
      <CursorTracker />
      <header className="app-header">
        <div className="header-content">
          <div className="logo">
            <Compass size={17} className="logo-icon" strokeWidth={1.5} />
            <span className="logo-text">Trip Planner</span>
          </div>
          {/* Show compact search bar in header once a result exists */}
          {hasResult && (
            <TripForm
              onSubmit={submit}
              isLoading={status === 'loading'}
              compact
              initialValue={lastDescription}
            />
          )}
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
      </header>

      <main className="app-main">
        {status === 'idle' && (
          <div className="intro-viewport">
            <div className={`intro-slider ${showWelcome ? '' : 'intro-slider--advanced'}`}>
              <div className="intro-slide">
                <WelcomeScreen onContinue={() => setShowWelcome(false)} />
              </div>
              <div className="intro-slide">
                <EmptyState onSubmit={submit} />
              </div>
            </div>
          </div>
        )}

        {status === 'loading' && (
          <LoadingState />
        )}

        {status === 'error' && (
          <ErrorState message={error} onRetry={retry} />
        )}

        {hasResult && itinerary && (
          <ItineraryView
            itinerary={itinerary}
            isFallback={status === 'fallback'}
            onRemoveStop={removeStop}
            onReorderStops={reorderStops}
            onMoveStop={moveStop}
            onApplyRefinement={applyRefinement}
            onPlanAnotherTrip={resetState}
          />
        )}
      </main>
    </div>
  );
}
