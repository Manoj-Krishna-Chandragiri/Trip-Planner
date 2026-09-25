import { Sun, Moon } from 'lucide-react';

export default function ThemeToggle({ theme, onToggle }) {
  const nextLabel = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={onToggle}
      aria-label={`Switch to ${nextLabel} mode`}
      title={`Switch to ${nextLabel} mode`}
    >
      {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}
