import { apiRequest } from '@/src/services/api/client';
import type {
  CreateBookingPayload,
  CreatedBooking,
  SlotAvailability,
} from '@/src/types/booking';

export async function getAvailableSlots(
  dateIso: string,
  signal?: AbortSignal
): Promise<SlotAvailability[]> {
  const data = await apiRequest<{ slots?: SlotAvailability[] }>(
    `/api/slots?date=${encodeURIComponent(dateIso)}`,
    { signal }
  );
  return Array.isArray(data.slots) ? data.slots : [];
}

export async function submitBookingRequest(
  payload: CreateBookingPayload
): Promise<CreatedBooking> {
  const data = await apiRequest<{ booking?: CreatedBooking }>('/api/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!data.booking) {
    throw new Error('Could not submit booking request.');
  }
  return data.booking;
}
