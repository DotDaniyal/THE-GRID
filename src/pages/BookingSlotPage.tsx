import { useState } from 'react';
import { motion } from 'motion/react';
import { MapPin } from 'lucide-react';
import { LOCATION } from '@/src/config/brand';
import { SINGLE_COURT } from '@/src/config/venue';
import { useSlotAvailability } from '@/src/hooks/useSlotAvailability';
import { BookingDateCalendar } from '@/src/features/booking/BookingDateCalendar';
import { TimeSlotGrid } from '@/src/features/booking/TimeSlotGrid';
import { BookingSummaryCard } from '@/src/features/booking/BookingSummaryCard';
import type { BookingSelection, SlotAvailability } from '@/src/types/booking';

interface BookingSlotPageProps {
  karachiToday: string;
  selection: BookingSelection | null;
  onSelectionChange: (next: BookingSelection | null) => void;
  onContinueToDetails: () => void;
}

export function BookingSlotPage({
  karachiToday,
  selection,
  onSelectionChange,
  onContinueToDetails,
}: BookingSlotPageProps) {
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    selection?.bookingDate && selection.bookingDate >= karachiToday
      ? selection.bookingDate
      : karachiToday
  );

  const { slots, loading, error, refreshSlots } = useSlotAvailability(selectedDate);

  const selectedSlot =
    selection && selection.bookingDate === selectedDate ? selection.slot : null;

  const handleDateChange = (nextDate: string) => {
    if (nextDate === selectedDate) return;
    setSelectedDate(nextDate);
    onSelectionChange(null);
  };

  const handleSlotClick = (slot: SlotAvailability) => {
    if (!slot.isAvailable) return;
    if (selectedSlot?.startTime === slot.startTime) {
      onSelectionChange(null);
      return;
    }
    onSelectionChange({
      bookingDate: selectedDate,
      slot,
    });
  };

  return (
    <div className="relative min-h-screen pt-24 pb-20 bg-[#0C153B] overflow-x-clip">
      <div aria-hidden="true" className="fixed inset-0 z-0 pointer-events-none">
        <img
          src="/gallery/turf.jpeg"
          alt=""
          className="w-full h-full object-cover object-center opacity-30"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0C153B]/92 via-[#152463]/88 to-[#09102E]/96" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="pb-8 border-b border-[#c4d835]/20 flex flex-col md:flex-row md:items-end justify-between gap-4"
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#c4d835]">
              Page 02 · Court Reservation
            </p>
            <h1 className="mt-2 font-display text-4xl sm:text-5xl font-extrabold uppercase tracking-tight text-white">
              Book Your Futsal Court
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-200">
              <span className="font-semibold text-white">{SINGLE_COURT.name}</span>
              <span aria-hidden="true" className="text-slate-400">
                ·
              </span>
              <span className="inline-flex items-center gap-1.5 text-slate-300">
                <MapPin className="w-3.5 h-3.5 text-[#c4d835]" aria-hidden="true" />
                {LOCATION.district}, Karachi
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wider">
            <span className="text-[#c4d835]">01. Date &amp; Time Slot</span>
            <span aria-hidden="true" className="text-slate-400">
              /
            </span>
            <span className="text-slate-400">02. Booking Details</span>
          </div>
        </motion.div>

        <div className="mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-8 space-y-8">
            <motion.section
              aria-labelledby="step-date-heading"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.05 }}
            >
              <div className="mb-3 flex items-center justify-between gap-4">
                <h2
                  id="step-date-heading"
                  className="font-display text-2xl font-bold uppercase tracking-wide text-[#c4d835]"
                >
                  1. Select Your Booking Date
                </h2>
              </div>

              <BookingDateCalendar
                selectedDate={selectedDate}
                karachiToday={karachiToday}
                onSelectDate={handleDateChange}
              />
            </motion.section>

            <TimeSlotGrid
              slots={slots}
              selectedSlot={selectedSlot}
              loading={loading}
              error={error}
              onRefresh={() => void refreshSlots(selectedDate)}
              onSelectSlot={handleSlotClick}
            />
          </div>

          <aside className="lg:col-span-4 lg:sticky lg:top-24">
            <BookingSummaryCard
              selectedDate={selectedDate}
              selectedSlot={selectedSlot}
              onContinue={onContinueToDetails}
            />
          </aside>
        </div>
      </div>
    </div>
  );
}
