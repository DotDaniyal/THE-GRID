import { useEffect, useRef } from 'react';

export interface SlotStreamEvent {
  type: 'slot_changed' | 'hours_changed';
  bookingDate?: string;
  startTime?: string;
  bookingId?: string;
  bookingStatus?: 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';
  updatedAt: string;
}

interface UseSlotStreamOptions {
  enabled?: boolean;
  onSyncEvent: (event: SlotStreamEvent) => void;
  onWakeOrReconnect?: () => void;
}

export function useSlotStream({
  enabled = true,
  onSyncEvent,
  onWakeOrReconnect,
}: UseSlotStreamOptions): void {
  const onSyncRef = useRef(onSyncEvent);
  const onWakeRef = useRef(onWakeOrReconnect);

  useEffect(() => {
    onSyncRef.current = onSyncEvent;
  }, [onSyncEvent]);

  useEffect(() => {
    onWakeRef.current = onWakeOrReconnect;
  }, [onWakeOrReconnect]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    let es: EventSource | null = null;
    let hasConnectedOnce = false;

    if (typeof window.EventSource === 'function') {
      es = new window.EventSource('/api/slots/stream');
      let hadErrorDisconnect = false;

      es.addEventListener('error', () => {
        hadErrorDisconnect = true;
      });

      es.addEventListener('connected', () => {
        if (hasConnectedOnce && hadErrorDisconnect) {
          onWakeRef.current?.();
        }
        hasConnectedOnce = true;
        hadErrorDisconnect = false;
      });

      const handleEvent = (raw: MessageEvent) => {
        try {
          const parsed = JSON.parse(String(raw.data)) as SlotStreamEvent;
          onSyncRef.current(parsed);
        } catch {
          // Ignore malformed event data
        }
      };

      es.addEventListener('slot_changed', handleEvent);
      es.addEventListener('hours_changed', handleEvent);
    }

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        onWakeRef.current?.();
      }
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    return () => {
      es?.close();
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [enabled]);
}
