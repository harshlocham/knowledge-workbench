export function formatRelativeTime(iso: string) {
  const date = new Date(iso);
  const diffMs = date.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const minutes = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  if (minutes < 1) return "Just now";
  if (minutes < 60) return rtf.format(Math.sign(diffMs) * minutes, "minute");
  if (hours < 48) return rtf.format(Math.sign(diffMs) * hours, "hour");
  if (days < 30) return rtf.format(Math.sign(diffMs) * days, "day");

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const ICONS = ["📘", "📗", "📙", "📕", "📓", "🗂️", "🧠", "✨", "🌊", "🍃"] as const;

export function notebookIcon(title: string) {
  let hash = 0;
  for (let i = 0; i < title.length; i += 1) {
    hash = (hash + title.charCodeAt(i) * (i + 1)) % ICONS.length;
  }
  return ICONS[hash] ?? "📘";
}
