import { useCallback, useState } from 'react';
import type { BookingSelection } from '@/src/types/booking';
import {
  readStoredBookingSelection,
  writeStoredBookingSelection,
} from '@/src/utils/clientStorage';

export function useBookingSelection() {
  const [bookingSelection, setBookingSelection] = useState<BookingSelection | null>(() =>
    readStoredBookingSelection()
  );

  const updateBookingSelection = useCallback((next: BookingSelection | null) => {
    setBookingSelection(next);
    writeStoredBookingSelection(next);
  }, []);

  return { bookingSelection, updateBookingSelection };
}
