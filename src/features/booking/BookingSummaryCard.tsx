import { motion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { LOCATION, PAYMENT_INFO } from '@/src/config/brand';
import { SINGLE_COURT } from '@/src/config/venue';
import type { SlotAvailability } from '@/src/types/booking';
import { formatReadableDate } from '@/src/utils/date';

interface BookingSummaryCardProps {
  selectedDate: string;
  selectedSlot: SlotAvailability | null;
  onContinue: () => void;
}

export function BookingSummaryCard({
  selectedDate,
  selectedSlot,
  onContinue,
}: BookingSummaryCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.14 }}
      className="rounded-xl border border-[#c4d835]/35 bg-[#121D52]/95 p-6 space-y-6 shadow-[0_20px_50px_rgba(4,8,24,0.5)]"
    >
      <div className="pb-4 border-b border-white/10">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#c4d835]">
          Booking Summary
        </p>
        <h3 className="mt-1 font-display text-2xl font-bold uppercase text-white">
          {SINGLE_COURT.name}
        </h3>
        <p className="mt-0.5 text-xs text-slate-300">
          {LOCATION.street}, {LOCATION.district}
        </p>
      </div>

      <dl className="space-y-3.5 text-sm">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-slate-300">Venue</dt>
          <dd className="font-semibold text-white text-right">THE GRID Court</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-slate-300">Date</dt>
          <dd className="font-mono-tabular font-semibold text-white text-right">
            {formatReadableDate(selectedDate)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-slate-300">Time Slot</dt>
          <dd className="font-mono-tabular font-semibold text-right text-[#c4d835]">
            {selectedSlot ? selectedSlot.displayName : 'Select an available slot'}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-slate-300">Duration</dt>
          <dd className="font-mono-tabular font-semibold text-white text-right">
            60 Minutes
          </dd>
        </div>
      </dl>

      <div className="pt-4 border-t border-white/10 flex items-baseline justify-between">
        <span className="text-sm font-medium text-slate-200">Total Amount</span>
        <span className="font-mono-tabular text-2xl font-bold text-[#c4d835]">
          {selectedSlot ? `PKR ${selectedSlot.pricePkr.toLocaleString()}` : 'Not selected'}
        </span>
      </div>

      <button
        type="button"
        disabled={!selectedSlot}
        onClick={onContinue}
        className="w-full inline-flex items-center justify-center gap-2 px-6 py-4 min-h-[52px] text-sm font-bold uppercase tracking-wide text-[#0E1845] bg-[#c4d835] hover:bg-[#d4e157] disabled:bg-[#c4d835]/30 disabled:text-slate-300/70 disabled:cursor-not-allowed rounded-lg transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <span>CONTINUE TO BOOKING</span>
        <ArrowRight className="w-4 h-4" />
      </button>

      <p className="text-xs text-slate-300/80 leading-relaxed">
        {PAYMENT_INFO.advancePercent}% advance payment confirmation applies via{' '}
        {PAYMENT_INFO.bankName} after submitting your booking request.
      </p>
    </motion.div>
  );
}
