import { useState, useEffect, useCallback, useRef } from 'react';
import { getAvailableSlots } from '@/src/services/api/bookingsApi';
import type { SlotAvailability } from '@/src/types/booking';

export function useSlotAvailability(selectedDate: string) {
  const [slots, setSlots] = useState<SlotAvailability[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refreshSlots = useCallback(async (dateIso: string = selectedDate) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const fetched = await getAvailableSlots(dateIso, controller.signal);
      if (!controller.signal.aborted) {
        setSlots(fetched);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      setError(err instanceof Error ? err.message : 'Unable to reach booking server.');
      setSlots([]);
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [selectedDate]);

  useEffect(() => {
    void refreshSlots(selectedDate);
    return () => abortRef.current?.abort();
  }, [selectedDate, refreshSlots]);

  return { slots, loading, error, refreshSlots };
}
