export function formatViewerTime(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const whole = Math.floor(seconds);
  const millis = Math.round((seconds - whole) * 1000);
  const mm = String(minutes).padStart(2, "0");
  const ss = String(whole).padStart(2, "0");
  const mmm = String(millis).padStart(3, "0");

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${mm}:${ss}.${mmm}`;
  }

  return `${mm}:${ss}.${mmm}`;
}

export function formatCompactTime(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
