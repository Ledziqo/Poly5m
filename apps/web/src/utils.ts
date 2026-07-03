export function formatET(date: Date | number | string): string {
  const d = new Date(date);
  const timeStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(d);
  
  return `${timeStr} ET`;
}

export function formatLocalTime(date: Date | number | string, includeSeconds = false): string {
  const d = new Date(date);
  return new Intl.DateTimeFormat(undefined, {
    hour: includeSeconds ? '2-digit' : 'numeric',
    minute: '2-digit',
    second: includeSeconds ? '2-digit' : undefined,
    hour12: !includeSeconds,
  }).format(d);
}
