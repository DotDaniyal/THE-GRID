import { CONTACT } from '@/src/config/brand';
import type { CreatedBooking } from '@/src/types/booking';
import { formatReadableDate } from '@/src/utils/date';

export function buildWhatsAppBookingMessage(booking: CreatedBooking): string {
  const typeLabel = booking.bookingType === 'shared' ? 'Shared' : 'Individual';
  const statusLabel =
    booking.status === 'PENDING' ? 'Pending Confirmation' : booking.status;

  return [
    'THE GRID - NEW BOOKING REQUEST',
    '',
    `Booking ID: ${booking.id}`,
    '',
    `Customer Name: ${booking.customerName}`,
    '',
    `Phone: ${booking.customerPhone}`,
    '',
    `Email: ${booking.customerEmail}`,
    '',
    `Venue: ${booking.venueName}`,
    '',
    `Date: ${formatReadableDate(booking.bookingDate)} (${booking.bookingDate})`,
    '',
    `Time: ${booking.displayName}`,
    '',
    `Booking Type: ${typeLabel}`,
    '',
    `Total Amount: PKR ${booking.totalAmountPkr.toLocaleString()}`,
    '',
    `Status: ${statusLabel}`,
  ].join('\n');
}

export function buildWhatsAppBookingUrl(booking: CreatedBooking): string {
  const message = buildWhatsAppBookingMessage(booking);
  return `${CONTACT.whatsappUrl}?text=${encodeURIComponent(message)}`;
}

export function buildWhatsAppInquiryUrl(
  name: string,
  phone: string,
  topic: string,
  message: string
): string {
  const text = `Hello THE GRID, my name is ${name.trim() || 'a player'} (${phone.trim() || 'N/A'}). Inquiry regarding ${topic}: ${message.trim()}`;
  return `${CONTACT.whatsappUrl}?text=${encodeURIComponent(text)}`;
}
