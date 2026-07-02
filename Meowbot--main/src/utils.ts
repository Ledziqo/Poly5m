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
