import { useState, useCallback } from 'react';
import type { BookingSelection } from '@/src/types/booking';

const SELECTION_STORAGE_KEY = 'thegrid_booking_selection_v1';

export function useBookingSelection() {
  const [bookingSelection, setBookingSelection] = useState<BookingSelection | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.sessionStorage?.getItem(SELECTION_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as BookingSelection;
      if (parsed?.bookingDate && parsed?.slot?.startTime) {
        return parsed;
      }
    } catch {
      // Ignore invalid stored selection
    }
    return null;
  });

  const updateBookingSelection = useCallback((next: BookingSelection | null) => {
    setBookingSelection(next);
    try {
      if (next) {
        window.sessionStorage?.setItem(SELECTION_STORAGE_KEY, JSON.stringify(next));
      } else {
        window.sessionStorage?.removeItem(SELECTION_STORAGE_KEY);
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

  return { bookingSelection, updateBookingSelection };
}
