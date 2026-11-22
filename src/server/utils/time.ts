export const KARACHI_TIMEZONE = 'Asia/Karachi';

export interface KarachiNow {
  dateStr: string;
  hours: number;
  minutes: number;
  minutesFromMidnight: number;
}

export function getKarachiNow(now: Date = new Date()): KarachiNow {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: KARACHI_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }

  const year = map.year ?? '2026';
  const month = map.month ?? '01';
  const day = map.day ?? '01';
  const rawHour = Number(map.hour ?? '0');
  const hours = rawHour === 24 ? 0 : rawHour;
  const minutes = Number(map.minute ?? '0');

  return {
    dateStr: `${year}-${month}-${day}`,
    hours,
    minutes,
    minutesFromMidnight: hours * 60 + minutes,
  };
}

export function isValidIsoDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function isSlotPassedInKarachi(
  bookingDate: string,
  startTime: string,
  endTime: string,
  karachiNow: KarachiNow = getKarachiNow()
): boolean {
  if (bookingDate < karachiNow.dateStr) {
    return true;
  }
  if (bookingDate > karachiNow.dateStr) {
    return false;
  }

  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const startMins = sh * 60 + sm;
  let endMins = eh * 60 + em;
  if (endMins <= startMins) {
    endMins += 24 * 60;
  }
  return karachiNow.minutesFromMidnight >= endMins;
}
