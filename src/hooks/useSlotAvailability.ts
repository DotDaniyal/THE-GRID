import { useState, useEffect, useCallback, useRef } from 'react';
import { useSlotStream, type SlotStreamEvent } from '@/src/hooks/useSlotStream';
import { getAvailableSlots } from '@/src/services/api/bookingsApi';
import type { SlotAvailability } from '@/src/types/booking';

export function useSlotAvailability(selectedDate: string) {
  const [slots, setSlots] = useState<SlotAvailability[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refreshSlots = useCallback(
    async (dateIso: string = selectedDate, options?: { silent?: boolean }) => {
      const isSilent = options?.silent ?? false;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (!isSilent) {
        setLoading(true);
        setError(null);
      }

      try {
        const fetched = await getAvailableSlots(dateIso, controller.signal);
        if (!controller.signal.aborted) {
          setSlots(fetched);
          setError(null);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        if (!isSilent) {
          setError(err instanceof Error ? err.message : 'Unable to reach booking server.');
          setSlots([]);
        }
      } finally {
        if (!controller.signal.aborted && !isSilent) {
          setLoading(false);
        }
      }
    },
    [selectedDate]
  );

  useEffect(() => {
    void refreshSlots(selectedDate, { silent: false });
    return () => abortRef.current?.abort();
  }, [selectedDate, refreshSlots]);

  const handleStreamEvent = useCallback(
    (evt: SlotStreamEvent) => {
      if (
        evt.type === 'hours_changed' ||
        !evt.bookingDate ||
        evt.bookingDate === selectedDate
      ) {
        void refreshSlots(selectedDate, { silent: true });
      }
    },
    [selectedDate, refreshSlots]
  );

  const handleWake = useCallback(() => {
    void refreshSlots(selectedDate, { silent: true });
  }, [selectedDate, refreshSlots]);

  useSlotStream({
    enabled: Boolean(selectedDate),
    onSyncEvent: handleStreamEvent,
    onWakeOrReconnect: handleWake,
  });

  // Fallback periodic refresh every 15 seconds if proxy suspends SSE
  useEffect(() => {
    if (!selectedDate) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refreshSlots(selectedDate, { silent: true });
      }
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [selectedDate, refreshSlots]);

  return { slots, loading, error, refreshSlots };
}
