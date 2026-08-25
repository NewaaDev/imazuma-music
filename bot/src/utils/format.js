export function duration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'direct/inconnue';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}

export function truncate(text, max = 100) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
