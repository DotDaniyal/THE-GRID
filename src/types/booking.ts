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
  customerNotes?: string;
  bookingType: BookingType;
  bookingDate: string;
  startTime: string;
  additionalGuestsCount: number;
  participants?: SharedParticipant[];
  policiesAccepted?: boolean;
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
  customerNotes?: string | null;
  additionalGuestsCount: number;
  totalAmountPkr: number;
  status: BookingStatus;
  holdExpiresAt?: string | null;
  confirmedAt?: string | null;
  statusToken?: string;
  createdAt: string;
}

export interface BookingLiveStatus {
  id: string;
  status: BookingStatus;
  bookingDate: string;
  startTime: string;
  holdExpiresAt: string | null;
  confirmedAt: string | null;
  updatedAt: string;
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
  customer_notes?: string | null;
  participants_json: string | null;
  additional_guests_count: number;
  total_amount_pkr: number;
  status: BookingStatus;
  admin_notes: string | null;
  hold_expires_at?: string | null;
  confirmed_at?: string | null;
  confirmed_by?: string | null;
  rejected_at?: string | null;
  rejected_by?: string | null;
  cancelled_at?: string | null;
  cancelled_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminDashboardStats {
  totalBookings: number;
  pendingBookings: number;
  confirmedBookings: number;
  rejectedBookings: number;
  cancelledBookings: number;
  upcomingBookings: number;
  todaysBookings: number;
  confirmedRevenuePkr: number;
}

export interface AdminActivityItem {
  id: string;
  action: string;
  actor: string;
  target_id?: string | null;
  summary: string;
  created_at: string;
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

export interface AdminAccountSummary {
  id: number;
  username: string;
  displayName: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'LEGACY_SHARED';
  mfaEnabled: boolean;
  isActive?: boolean;
  createdAt?: string;
  lastLoginAt?: string | null;
}

export interface AdminAuthStatus {
  authenticated: boolean;
  setupRequired: boolean;
  authMode: 'named_accounts' | 'legacy_passcode_fallback' | 'setup_required';
  storageConfigured?: boolean;
  storageMessage?: string | null;
  expiresAt: number | null;
  account: AdminAccountSummary | null;
  mfaMigrationRecommended: boolean;
  sessionTtlMinutes: number;
}

export interface CountryCodeOption {
  code: string;
  label: string;
  placeholder: string;
}
