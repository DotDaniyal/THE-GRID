import { EventEmitter } from 'node:events';

export interface SlotSyncEvent {
  type: 'slot_changed' | 'hours_changed';
  bookingDate?: string;
  startTime?: string;
  bookingId?: string;
  bookingStatus?: 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';
  updatedAt: string;
}

class BookingEventBus extends EventEmitter {}

const bus = new BookingEventBus();
bus.setMaxListeners(500);

export function emitSlotUpdate(event: SlotSyncEvent): void {
  bus.emit('sync', event);
}

export function subscribeSlotUpdates(listener: (event: SlotSyncEvent) => void): () => void {
  bus.on('sync', listener);
  return () => {
    bus.off('sync', listener);
  };
}
