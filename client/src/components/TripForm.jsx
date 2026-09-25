import { useState } from 'react';

export default function TripForm({ onSubmit, isLoading, compact = false, initialValue = '' }) {
  const [value, setValue] = useState(initialValue);

  function handleSubmit(e) {
    e.preventDefault(); // stop the native full-page-reload submit
    if (!value.trim() || isLoading) return;
    onSubmit(value.trim());
  }

  return (
    <form className={`trip-form ${compact ? 'trip-form--compact' : ''}`} onSubmit={handleSubmit}>
      {compact ? (
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Plan another trip..."
          aria-label="Describe a trip"
        />
      ) : (
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. 4 days in Kyoto, mostly temples and good ramen, traveling on foot and by train"
          rows={4}
          aria-label="Describe your trip"
        />
      )}
      <button type="submit" disabled={isLoading || !value.trim()}>
        {isLoading ? 'Planning…' : 'Plan my trip'}
      </button>
    </form>
  );
}
