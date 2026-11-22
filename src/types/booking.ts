export type SlotStatus = 'AVAILABLE' | 'BOOKED' | 'PAST';
export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED';
export type BookingType = 'individual' | 'shared';

export interface SlotAvailability {
  slotId: string;
  courtNumber: 1;
  venueName: string;
  startTime: string;
  endTime: string;
  displayName: string;
  durationMinutes: number;
  pricePkr: number;
  status: SlotStatus;
  bookingStatus: 'PENDING' | 'CONFIRMED' | null;
  isAvailable: boolean;
}

export interface BookingSelection {
  bookingDate: string;
  slot: SlotAvailability;
}

export interface SharedParticipant {
  name: string;
  phone: string;
}

export interface CreateBookingPayload {
  customerName: string;
  customerEmail: string;
  countryCode: string;
  customerPhone: string;
  bookingType: BookingType;
  bookingDate: string;
  startTime: string;
  additionalGuestsCount: number;
  participants?: SharedParticipant[];
}

export interface CreatedBooking {
  id: string;
  courtNumber: 1;
  venueName: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  displayName: string;
  durationMinutes: number;
  bookingType: BookingType;
  customerName: string;
  customerEmail: string;
  countryCode: string;
  customerPhone: string;
  additionalGuestsCount: number;
  totalAmountPkr: number;
  status: BookingStatus;
  createdAt: string;
}

export interface AdminBookingRow {
  id: string;
  court_number: number;
  venue_name: string;
  booking_date: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  booking_type: BookingType;
  customer_name: string;
  customer_email: string;
  country_code: string;
  customer_phone: string;
  participants_json: string | null;
  additional_guests_count: number;
  total_amount_pkr: number;
  status: BookingStatus;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminNotification {
  id: number;
  booking_id: string;
  message: string;
  is_read: number;
  created_at: string;
}

export interface OperatingHourConfig {
  start_time: string;
  end_time: string;
  display_name: string;
  price_pkr: number;
  is_active: number;
}

export interface AdminAuthStatus {
  hasEnvPasscode: boolean;
  hasClaimedPasscode: boolean;
  setupRequired: boolean;
}

export interface CountryCodeOption {
  code: string;
  label: string;
  placeholder: string;
}
