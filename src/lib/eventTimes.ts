// Pure — safe for both the event editor's browser script and server routes.
// An end time earlier than the start (e.g. 8:00 PM to 12:00 AM) means the
// next day; Google rejects an event whose end isn't after its start.

// The editor's date + start/end "HH:mm" (browser-local) → the end as an ISO
// instant, rolled to the next day when it's before the start. Null when the
// end equals the start (a zero-length event).
export function endAfterStart(date: string, startTime: string, endTime: string): string | null {
  const start = new Date(`${date}T${startTime}:00`);
  const end = new Date(`${date}T${endTime}:00`);
  if (end.getTime() === start.getTime()) return null;
  if (end < start) end.setDate(end.getDate() + 1);
  return end.toISOString();
}

// A recurring series' first-occurrence end date ("YYYY-MM-DD"): the anchor
// date, or the day after when the end "HH:mm" is at or before the start.
export function seriesAnchorEndDate(anchorDate: string, startTime: string, endTime: string): string {
  return endTime <= startTime ? new Date(Date.parse(`${anchorDate}T00:00:00Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10) : anchorDate;
}
