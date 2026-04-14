/**
 * Date formatting utilities.
 * All dates stored as ISO 8601 strings.
 */

export function nowISO(): string {
  return new Date().toISOString()
}

export function dateToSessionId(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
  ].join('-')
}

export function isoToDisplay(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function isoToDate(iso: string): string {
  return iso.slice(0, 10) // "YYYY-MM-DD"
}

export function minutesBetween(start: string, end: string): number {
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)
}

export function isOlderThanDays(iso: string, days: number): boolean {
  const ms = days * 24 * 60 * 60 * 1000
  return Date.now() - new Date(iso).getTime() > ms
}
