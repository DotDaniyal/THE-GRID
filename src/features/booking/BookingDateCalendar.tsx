import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { addDaysToIsoDate, formatReadableDate } from '@/src/utils/date';

interface BookingDateCalendarProps {
  selectedDate: string;
  karachiToday: string;
  onSelectDate: (isoDate: string) => void;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function BookingDateCalendar({
  selectedDate,
  karachiToday,
  onSelectDate,
}: BookingDateCalendarProps) {
  const [todayY, todayM] = karachiToday.split('-').map(Number);
  const [selY, selM] = selectedDate.split('-').map(Number);

  const [viewYear, setViewYear] = useState(selY || todayY);
  const [viewMonth, setViewMonth] = useState(selM || todayM);

  useEffect(() => {
    const [y, m] = selectedDate.split('-').map(Number);
    if (y && m) {
      setViewYear(y);
      setViewMonth(m);
    }
  }, [selectedDate]);

  const isAtMinMonth = viewYear < todayY || (viewYear === todayY && viewMonth <= todayM);
  const tomorrowStr = useMemo(() => addDaysToIsoDate(karachiToday, 1), [karachiToday]);

  const goPrevMonth = () => {
    if (isAtMinMonth) return;
    if (viewMonth === 1) {
      setViewYear((y) => y - 1);
      setViewMonth(12);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const goNextMonth = () => {
    if (viewMonth === 12) {
      setViewYear((y) => y + 1);
      setViewMonth(1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const monthTitle = useMemo(() => {
    const dt = new Date(Date.UTC(viewYear, viewMonth - 1, 1));
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      month: 'long',
      year: 'numeric',
    }).format(dt);
  }, [viewYear, viewMonth]);

  const calendarCells = useMemo(() => {
    const firstDayWeekday = new Date(Date.UTC(viewYear, viewMonth - 1, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(viewYear, viewMonth, 0)).getUTCDate();
    const cells: Array<{ iso: string | null; day: number | null }> = [];

    for (let i = 0; i < firstDayWeekday; i++) {
      cells.push({ iso: null, day: null });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${viewYear}-${String(viewMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({ iso, day: d });
    }
    return cells;
  }, [viewYear, viewMonth]);

  const handleQuickSelect = (iso: string) => {
    const [y, m] = iso.split('-').map(Number);
    setViewYear(y);
    setViewMonth(m);
    onSelectDate(iso);
  };

  return (
    <div className="rounded-xl border border-[#c4d835]/30 bg-[#16235C]/92 p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-white/10">
        <div className="flex items-center gap-2.5">
          <CalendarDays className="w-5 h-5 text-[#c4d835] shrink-0" aria-hidden="true" />
          <div>
            <div className="text-xs uppercase tracking-[0.14em] text-slate-300">
              Selected Date (PKT · Asia/Karachi)
            </div>
            <div className="font-mono-tabular text-base font-semibold text-[#c4d835]">
              {formatReadableDate(selectedDate)}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleQuickSelect(karachiToday)}
            className={`px-3.5 py-2 min-h-[40px] text-xs font-semibold rounded-md border transition-colors cursor-pointer whitespace-nowrap ${
              selectedDate === karachiToday
                ? 'bg-[#c4d835] text-[#101A47] border-[#c4d835]'
                : 'bg-[#0F1947]/80 text-slate-200 border-white/15 hover:border-[#c4d835]/60'
            }`}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => handleQuickSelect(tomorrowStr)}
            className={`px-3.5 py-2 min-h-[40px] text-xs font-semibold rounded-md border transition-colors cursor-pointer whitespace-nowrap ${
              selectedDate === tomorrowStr
                ? 'bg-[#c4d835] text-[#101A47] border-[#c4d835]'
                : 'bg-[#0F1947]/80 text-slate-200 border-white/15 hover:border-[#c4d835]/60'
            }`}
          >
            Tomorrow
          </button>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <button
          type="button"
          onClick={goPrevMonth}
          disabled={isAtMinMonth}
          aria-label="Previous month"
          className="w-10 h-10 rounded-md border border-white/15 bg-[#0F1947]/80 text-slate-200 hover:border-[#c4d835] hover:text-[#c4d835] disabled:opacity-35 disabled:cursor-not-allowed flex items-center justify-center transition-colors cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <h3 className="font-display text-xl sm:text-2xl font-bold uppercase tracking-wide text-white">
          {monthTitle}
        </h3>

        <button
          type="button"
          onClick={goNextMonth}
          aria-label="Next month"
          className="w-10 h-10 rounded-md border border-white/15 bg-[#0F1947]/80 text-slate-200 hover:border-[#c4d835] hover:text-[#c4d835] flex items-center justify-center transition-colors cursor-pointer"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-1.5 text-center">
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className="py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-300/80"
          >
            {day}
          </div>
        ))}
      </div>

      <div className="mt-1.5 grid grid-cols-7 gap-1.5">
          {calendarCells.map((cell, idx) => {
            if (!cell.iso || cell.day === null) {
              return <div key={`empty-${idx}`} className="h-11 sm:h-12" />;
            }

            const isPast = cell.iso < karachiToday;
            const isToday = cell.iso === karachiToday;
            const isSelected = cell.iso === selectedDate;

            return (
              <button
                key={cell.iso}
                type="button"
                disabled={isPast}
                onClick={() => onSelectDate(cell.iso!)}
                aria-label={`${formatReadableDate(cell.iso)}${isPast ? ' (Past date unavailable)' : ''}`}
                aria-pressed={isSelected}
                className={`relative h-11 sm:h-12 rounded-lg font-mono-tabular text-sm font-semibold transition-all duration-150 flex flex-col items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                  isPast
                    ? 'text-slate-500/50 bg-[#0D163E]/30 cursor-not-allowed'
                    : isSelected
                    ? 'bg-[#c4d835] text-[#101A47] shadow-[0_4px_18px_rgba(196,216,53,0.35)] cursor-pointer'
                    : isToday
                    ? 'bg-[#223488] text-white border border-[#c4d835]/75 hover:bg-[#2C42A6] cursor-pointer'
                    : 'bg-[#121F54]/85 text-white border border-white/10 hover:border-[#c4d835]/65 hover:bg-[#1E307A] cursor-pointer'
                }`}
              >
                <span>{cell.day}</span>
                {!isPast && !isSelected && (
                  <span
                    aria-hidden="true"
                    className={`mt-1 w-3 h-[2px] ${
                      isToday ? 'bg-[#c4d835]' : 'bg-[#c4d835]/50'
                    }`}
                  />
                )}
              </button>
            );
          })}
      </div>
    </div>
  );
}
