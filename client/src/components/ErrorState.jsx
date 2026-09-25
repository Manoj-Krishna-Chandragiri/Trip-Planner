export default function ErrorState({ message, onRetry }) {
  return (
    <div className="status-panel status-panel--error" role="alert">
      <p className="status-panel__title">Couldn't plan that trip</p>
      <p>{message}</p>
      <button onClick={onRetry}>Try again</button>
    </div>
  );
}
