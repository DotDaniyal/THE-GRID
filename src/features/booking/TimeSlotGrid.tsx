import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Lock,
  RefreshCw,
} from 'lucide-react';
import type { SlotAvailability } from '@/src/types/booking';

interface TimeSlotGridProps {
  slots: SlotAvailability[];
  selectedSlot: SlotAvailability | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onSelectSlot: (slot: SlotAvailability) => void;
}

export function TimeSlotGrid({
  slots,
  selectedSlot,
  loading,
  error,
  onRefresh,
  onSelectSlot,
}: TimeSlotGridProps) {
  const availableCount = slots.filter((s) => s.status === 'AVAILABLE').length;
  const bookedCount = slots.filter((s) => s.status === 'BOOKED').length;

  return (
    <section
      aria-labelledby="step-slots-heading"
      className="rounded-xl border border-[#c4d835]/30 bg-[#16235C]/92 p-4 sm:p-6"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-white/10">
        <div>
          <h2
            id="step-slots-heading"
            className="font-display text-2xl font-bold uppercase tracking-wide text-[#c4d835]"
          >
            2. Choose an Available Time Slot
          </h2>
          <p className="mt-0.5 text-xs sm:text-sm text-slate-300">
            {loading
              ? 'Checking real-time court availability...'
              : error
              ? 'Unable to load court availability right now.'
              : `${availableCount} available · ${bookedCount} booked · 60-minute slots (PKT)`}
          </p>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[38px] text-xs font-semibold text-slate-200 bg-[#0F1947]/80 hover:text-[#c4d835] border border-white/15 rounded-md transition-colors cursor-pointer disabled:opacity-50 self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-200">
        <div className="inline-flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm border border-[#c4d835]/70 bg-[#1F3180]" />
          <span>Available</span>
        </div>
        <div className="inline-flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm bg-[#c4d835]" />
          <span>Selected</span>
        </div>
        <div className="inline-flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm border border-white/15 bg-[#0D163E] opacity-60" />
          <span>Booked</span>
        </div>
        <div className="inline-flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm border border-white/10 bg-[#0A1130] opacity-45" />
          <span>Time Passed</span>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-5 p-4 rounded-lg border border-rose-400/40 bg-rose-950/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-start gap-2.5 text-sm text-rose-200">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-300" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            className="px-4 py-2 min-h-[38px] text-xs font-semibold text-white bg-rose-600/80 hover:bg-rose-600 rounded-md cursor-pointer self-start sm:self-auto"
          >
            Retry
          </button>
        </div>
      )}

      {loading && (
        <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {Array.from({ length: 12 }).map((_, idx) => (
            <div
              key={idx}
              className="h-[78px] rounded-lg border border-white/10 bg-[#101B4D]/70"
            />
          ))}
        </div>
      )}

      {!loading && !error && slots.length === 0 && (
        <div className="mt-6 py-10 text-center text-sm text-slate-300">
          No operating hours configured for this date.
        </div>
      )}

      {!loading && !error && slots.length > 0 && (
        <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {slots.map((slot) => {
            const isSelected = selectedSlot?.startTime === slot.startTime;
            const isBooked = slot.status === 'BOOKED';
            const isPast = slot.status === 'PAST';
            const isAvailable = slot.status === 'AVAILABLE';

            return (
              <button
                key={slot.slotId}
                type="button"
                disabled={!isAvailable}
                onClick={() => onSelectSlot(slot)}
                aria-pressed={isSelected}
                aria-label={`${slot.displayName}, ${
                  isBooked
                    ? 'Booked'
                    : isPast
                    ? 'Time Passed'
                    : `Available for PKR ${slot.pricePkr}`
                }`}
                className={`relative min-h-[82px] px-3 py-3 rounded-lg border text-left transition-all duration-150 flex flex-col justify-between focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                  isSelected
                    ? 'bg-[#c4d835] text-[#0E1845] border-[#d4e157] shadow-[0_8px_24px_rgba(196,216,53,0.32)] cursor-pointer'
                    : isAvailable
                    ? 'bg-[#1D2E7B]/85 text-white border-[#c4d835]/55 hover:border-[#c4d835] hover:bg-[#253A99] hover:-translate-y-0.5 active:scale-[0.98] cursor-pointer'
                    : isBooked
                    ? 'bg-[#0C1438]/65 text-slate-300/65 border-white/10 opacity-55 cursor-not-allowed'
                    : 'bg-[#09102E]/55 text-slate-400/60 border-white/5 opacity-45 cursor-not-allowed'
                }`}
              >
                <div className="flex items-start justify-between gap-1.5">
                  <span className="font-mono-tabular text-xs font-semibold leading-snug">
                    {slot.displayName}
                  </span>
                  {isSelected && (
                    <CheckCircle2
                      className="w-4 h-4 text-[#0E1845] shrink-0"
                      aria-hidden="true"
                    />
                  )}
                  {isBooked && (
                    <Lock
                      className="w-3.5 h-3.5 text-slate-400/70 shrink-0"
                      aria-hidden="true"
                    />
                  )}
                </div>

                <div className="mt-2 flex items-center justify-between gap-2">
                  {isBooked ? (
                    <span className="text-[11px] font-bold uppercase tracking-wider text-amber-200/80">
                      BOOKED
                    </span>
                  ) : isPast ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      <Clock className="w-3 h-3" aria-hidden="true" />
                      TIME PASSED
                    </span>
                  ) : (
                    <>
                      <span
                        className={`font-mono-tabular text-sm font-bold ${
                          isSelected ? 'text-[#0E1845]' : 'text-[#c4d835]'
                        }`}
                      >
                        PKR {slot.pricePkr.toLocaleString()}
                      </span>
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider ${
                          isSelected ? 'text-[#0E1845]' : 'text-slate-300'
                        }`}
                      >
                        {isSelected ? 'SELECTED' : 'OPEN'}
                      </span>
                    </>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
