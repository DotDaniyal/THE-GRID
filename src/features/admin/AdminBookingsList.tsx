import { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  Ban,
  Calendar,
  Check,
  Eye,
  FileText,
  Search,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import type { AdminBookingRow, BookingStatus, SharedParticipant } from '@/src/types/booking';

interface AdminBookingsListProps {
  bookings: AdminBookingRow[];
  updatingId: string | null;
  onUpdateStatus: (
    bookingId: string,
    status: BookingStatus,
    adminNotes?: string
  ) => Promise<void>;
}

const STATUS_FILTERS: Array<'ALL' | BookingStatus> = [
  'ALL',
  'PENDING',
  'CONFIRMED',
  'REJECTED',
  'CANCELLED',
];

function formatAuditTime(isoValue?: string | null): string | null {
  if (!isoValue) return null;
  const parsed = new Date(isoValue);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString('en-PK', {
    timeZone: 'Asia/Karachi',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function parseParticipants(raw: string | null): SharedParticipant[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is { name?: unknown; phone?: unknown } => Boolean(item && typeof item === 'object'))
      .map((item) => ({
        name: typeof item.name === 'string' ? item.name.trim() : '',
        phone: typeof item.phone === 'string' ? item.phone.trim() : '',
      }))
      .filter((p) => p.name.length > 0 || p.phone.length > 0);
  } catch {
    return [];
  }
}

function getStatusBadgeClasses(status: BookingStatus): string {
  switch (status) {
    case 'CONFIRMED':
      return 'bg-[#c4d835]/15 text-[#c4d835] border-[#c4d835]/40';
    case 'PENDING':
      return 'bg-amber-500/15 text-amber-300 border-amber-400/40';
    case 'REJECTED':
      return 'bg-rose-500/15 text-rose-300 border-rose-400/40';
    case 'CANCELLED':
    default:
      return 'bg-slate-500/15 text-slate-300 border-white/20';
  }
}

export function AdminBookingsList({
  bookings,
  updatingId,
  onUpdateStatus,
}: AdminBookingsListProps) {
  const [statusFilter, setStatusFilter] = useState<'ALL' | BookingStatus>('ALL');
  const [dateFilter, setDateFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [adminNotesDraft, setAdminNotesDraft] = useState('');

  const selectedBooking = selectedBookingId
    ? bookings.find((b) => b.id === selectedBookingId) ?? null
    : null;

  useEffect(() => {
    if (!selectedBooking) return;
    setAdminNotesDraft(selectedBooking.admin_notes ?? '');
  }, [selectedBooking?.id, selectedBooking?.admin_notes]);

  useEffect(() => {
    if (!selectedBookingId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedBookingId(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedBookingId]);

  const filteredBookings = bookings.filter((b) => {
    if (statusFilter !== 'ALL' && b.status !== statusFilter) return false;
    if (dateFilter && b.booking_date !== dateFilter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.trim().toLowerCase();
    return (
      b.id.toLowerCase().includes(q) ||
      b.customer_name.toLowerCase().includes(q) ||
      b.customer_phone.toLowerCase().includes(q) ||
      b.customer_email.toLowerCase().includes(q) ||
      b.booking_date.includes(q) ||
      (b.customer_notes ? b.customer_notes.toLowerCase().includes(q) : false)
    );
  });

  const handleModalStatusChange = async (bookingId: string, nextStatus: BookingStatus) => {
    await onUpdateStatus(bookingId, nextStatus, adminNotesDraft.trim());
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`px-3.5 py-2 min-h-[38px] text-xs font-semibold rounded-md border cursor-pointer ${
                statusFilter === st
                  ? 'bg-[#c4d835] text-[#0E1845] border-[#c4d835]'
                  : 'bg-[#121D52] text-slate-300 border-white/15 hover:text-white'
              }`}
            >
              {st}
            </button>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <div className="relative flex items-center">
            <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-3 pointer-events-none" />
            <input
              type="date"
              aria-label="Filter by booking date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="min-h-[40px] pl-9 pr-3 py-2 text-xs text-white bg-[#121D52] border border-white/15 rounded-md focus:outline-none focus:border-[#c4d835] font-mono-tabular"
            />
            {dateFilter && (
              <button
                type="button"
                aria-label="Clear date filter"
                onClick={() => setDateFilter('')}
                className="ml-1.5 inline-flex items-center justify-center p-2 min-h-[38px] text-xs text-slate-300 hover:text-white bg-[#121D52] border border-white/15 rounded-md cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search ID, name, phone, email..."
              className="w-full min-h-[40px] pl-9 pr-3 py-2 text-xs text-white bg-[#121D52] border border-white/15 rounded-md focus:outline-none focus:border-[#c4d835]"
            />
          </div>
        </div>
      </div>

      {filteredBookings.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-[#121D52]/70 p-10 text-center text-sm text-slate-300">
          {bookings.length === 0
            ? 'No booking requests yet. New customer submissions will appear here automatically.'
            : 'No booking requests match the current filter.'}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredBookings.map((b) => {
            const cleanDigits = b.customer_phone.replace(/[^\d]/g, '');
            const waLink = cleanDigits ? `https://wa.me/${cleanDigits}` : undefined;
            const createdLabel = formatAuditTime(b.created_at);
            const holdLabel = formatAuditTime(b.hold_expires_at);
            const confirmedLabel = formatAuditTime(b.confirmed_at);
            const rejectedLabel = formatAuditTime(b.rejected_at);
            const cancelledLabel = formatAuditTime(b.cancelled_at);

            return (
              <div
                key={b.id}
                className="rounded-xl border border-white/12 bg-[#121D52]/80 p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
              >
                <div className="space-y-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <span className="font-mono-tabular text-sm font-bold text-[#c4d835]">
                      {b.id}
                    </span>
                    <span aria-hidden="true" className="text-slate-500">
                      ·
                    </span>
                    <span className="font-semibold text-white">{b.customer_name}</span>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold uppercase rounded border ${getStatusBadgeClasses(
                        b.status
                      )}`}
                    >
                      {b.status}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-300">
                    <span className="font-mono-tabular">
                      {b.booking_date} · {b.start_time}-{b.end_time} ({b.duration_minutes} min)
                    </span>
                    <span className="font-mono-tabular font-semibold text-white">
                      PKR {b.total_amount_pkr.toLocaleString()}
                    </span>
                    <span className="capitalize">
                      {b.booking_type}
                      {b.booking_type === 'shared' && b.additional_guests_count > 0
                        ? ` (+${b.additional_guests_count} players)`
                        : ''}
                    </span>
                    <span className="font-mono-tabular">{b.customer_phone}</span>
                    <span>{b.customer_email}</span>
                  </div>

                  {b.customer_notes && (
                    <div className="flex items-start gap-1.5 text-xs text-slate-200 bg-[#0B1338]/75 border border-white/10 rounded-md px-2.5 py-1.5">
                      <FileText className="w-3.5 h-3.5 text-[#c4d835] shrink-0 mt-0.5" />
                      <span className="line-clamp-2">{b.customer_notes}</span>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
                    {createdLabel && <span>Requested: {createdLabel} PKT</span>}
                    {b.status === 'PENDING' && holdLabel && (
                      <span className="text-amber-300/90">
                        Hold expires: {holdLabel} PKT
                      </span>
                    )}
                    {b.status === 'CONFIRMED' && confirmedLabel && (
                      <span className="text-[#c4d835]/90">
                        Confirmed: {confirmedLabel} PKT
                        {b.confirmed_by ? ` by ${b.confirmed_by}` : ''}
                      </span>
                    )}
                    {b.status === 'REJECTED' && rejectedLabel && (
                      <span className="text-rose-300/90">
                        Rejected: {rejectedLabel} PKT
                        {b.rejected_by ? ` by ${b.rejected_by}` : ''}
                      </span>
                    )}
                    {b.status === 'CANCELLED' && cancelledLabel && (
                      <span className="text-slate-300/90">
                        Cancelled: {cancelledLabel} PKT
                        {b.cancelled_by ? ` by ${b.cancelled_by}` : ''}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setSelectedBookingId(b.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] text-xs font-semibold text-white bg-white/5 hover:bg-white/10 border border-white/15 rounded-md cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5 text-[#c4d835]" />
                    <span>Details</span>
                  </button>

                  {waLink && (
                    <a
                      href={waLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-3 py-2 min-h-[38px] text-xs font-semibold text-white bg-white/5 hover:bg-white/10 border border-white/15 rounded-md"
                    >
                      <span>WhatsApp</span>
                      <ArrowUpRight className="w-3.5 h-3.5 text-[#c4d835]" />
                    </a>
                  )}

                  {b.status !== 'CONFIRMED' && (
                    <button
                      type="button"
                      disabled={updatingId === b.id}
                      onClick={() => void onUpdateStatus(b.id, 'CONFIRMED')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[38px] text-xs font-bold text-[#0E1845] bg-[#c4d835] hover:bg-[#d4e157] rounded-md cursor-pointer disabled:opacity-50"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Confirm</span>
                    </button>
                  )}

                  {b.status === 'PENDING' && (
                    <button
                      type="button"
                      disabled={updatingId === b.id}
                      onClick={() => void onUpdateStatus(b.id, 'REJECTED')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[38px] text-xs font-semibold text-rose-200 bg-rose-950/60 hover:bg-rose-900/70 border border-rose-400/30 rounded-md cursor-pointer disabled:opacity-50"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Reject</span>
                    </button>
                  )}

                  {(b.status === 'PENDING' || b.status === 'CONFIRMED') && (
                    <button
                      type="button"
                      disabled={updatingId === b.id}
                      onClick={() => void onUpdateStatus(b.id, 'CANCELLED')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[38px] text-xs font-semibold text-slate-200 bg-white/5 hover:bg-white/10 border border-white/15 rounded-md cursor-pointer disabled:opacity-50"
                    >
                      <Ban className="w-3.5 h-3.5" />
                      <span>Cancel</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedBooking && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSelectedBookingId(null);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="booking-detail-modal-title"
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-[#c4d835]/35 bg-[#121D52] p-6 space-y-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-white/10">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2
                    id="booking-detail-modal-title"
                    className="font-mono-tabular text-lg font-bold text-[#c4d835]"
                  >
                    {selectedBooking.id}
                  </h2>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold uppercase rounded border ${getStatusBadgeClasses(
                      selectedBooking.status
                    )}`}
                  >
                    {selectedBooking.status}
                  </span>
                </div>
                <p className="mt-1 text-sm font-semibold text-white">
                  {selectedBooking.customer_name}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close booking details"
                onClick={() => setSelectedBookingId(null)}
                className="p-2 rounded-md text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="rounded-lg border border-white/10 bg-[#0B1338] p-3.5 space-y-1.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Slot & Pricing
                </div>
                <div className="font-mono-tabular font-semibold text-white">
                  {selectedBooking.booking_date} · {selectedBooking.start_time}-
                  {selectedBooking.end_time}
                </div>
                <div className="text-slate-300">
                  {selectedBooking.venue_name} · {selectedBooking.duration_minutes} min
                </div>
                <div className="font-mono-tabular font-bold text-[#c4d835]">
                  Total: PKR {selectedBooking.total_amount_pkr.toLocaleString()} (50% Advance: PKR{' '}
                  {Math.round(selectedBooking.total_amount_pkr / 2).toLocaleString()})
                </div>
                <div className="capitalize text-slate-300">
                  Type: {selectedBooking.booking_type}
                </div>
              </div>

              <div className="rounded-lg border border-white/10 bg-[#0B1338] p-3.5 space-y-1.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Customer Contact
                </div>
                <div className="font-semibold text-white">
                  {selectedBooking.customer_name}
                </div>
                <div className="font-mono-tabular text-slate-200">
                  {selectedBooking.customer_phone}
                </div>
                <div className="text-slate-300 break-all">
                  {selectedBooking.customer_email}
                </div>
                {selectedBooking.customer_phone.replace(/[^\d]/g, '') && (
                  <a
                    href={`https://wa.me/${selectedBooking.customer_phone.replace(/[^\d]/g, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 pt-1 text-xs font-semibold text-[#c4d835] hover:underline"
                  >
                    <span>Message on WhatsApp</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </div>

            {selectedBooking.customer_notes && (
              <div className="rounded-lg border border-white/10 bg-[#0B1338] p-3.5 space-y-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Customer Notes
                </div>
                <p className="text-xs text-slate-200 whitespace-pre-wrap">
                  {selectedBooking.customer_notes}
                </p>
              </div>
            )}

            {selectedBooking.booking_type === 'shared' && (
              <div className="rounded-lg border border-white/10 bg-[#0B1338] p-3.5 space-y-2">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-[#c4d835]" />
                    Shared Match Players
                  </span>
                  <span className="font-mono-tabular text-slate-300">
                    +{selectedBooking.additional_guests_count} guests
                  </span>
                </div>
                {(() => {
                  const participants = parseParticipants(selectedBooking.participants_json);
                  if (participants.length === 0) {
                    return (
                      <p className="text-xs text-slate-400">
                        No named co-player contacts listed.
                      </p>
                    );
                  }
                  return (
                    <ul className="space-y-1 text-xs text-slate-200">
                      {participants.map((p, idx) => (
                        <li
                          key={`${p.name}-${p.phone}-${idx}`}
                          className="flex items-center justify-between gap-2 border-t border-white/5 pt-1 first:border-0 first:pt-0"
                        >
                          <span>{p.name || 'Unnamed player'}</span>
                          <span className="font-mono-tabular text-slate-400">{p.phone}</span>
                        </li>
                      ))}
                    </ul>
                  );
                })()}
              </div>
            )}

            <div className="space-y-1.5">
              <label
                htmlFor="admin-booking-notes"
                className="block text-[10px] font-bold uppercase tracking-wider text-slate-400"
              >
                Internal Admin Notes
              </label>
              <textarea
                id="admin-booking-notes"
                rows={2}
                maxLength={500}
                value={adminNotesDraft}
                onChange={(e) => setAdminNotesDraft(e.target.value)}
                placeholder="Add internal payment reference or decision note (saved when updating status)..."
                className="w-full px-3 py-2 text-xs text-white bg-[#0B1338] border border-white/15 rounded-md focus:outline-none focus:border-[#c4d835] resize-none"
              />
            </div>

            <div className="rounded-lg border border-white/10 bg-[#0B1338] p-3.5 space-y-1 text-[11px] text-slate-300">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Audit Timeline
              </div>
              {formatAuditTime(selectedBooking.created_at) && (
                <div>Created: {formatAuditTime(selectedBooking.created_at)} PKT</div>
              )}
              {selectedBooking.status === 'PENDING' &&
                formatAuditTime(selectedBooking.hold_expires_at) && (
                  <div className="text-amber-300">
                    Hold Expires: {formatAuditTime(selectedBooking.hold_expires_at)} PKT
                  </div>
                )}
              {formatAuditTime(selectedBooking.confirmed_at) && (
                <div className="text-[#c4d835]">
                  Confirmed: {formatAuditTime(selectedBooking.confirmed_at)} PKT
                  {selectedBooking.confirmed_by ? ` by ${selectedBooking.confirmed_by}` : ''}
                </div>
              )}
              {formatAuditTime(selectedBooking.rejected_at) && (
                <div className="text-rose-300">
                  Rejected: {formatAuditTime(selectedBooking.rejected_at)} PKT
                  {selectedBooking.rejected_by ? ` by ${selectedBooking.rejected_by}` : ''}
                </div>
              )}
              {formatAuditTime(selectedBooking.cancelled_at) && (
                <div className="text-slate-300">
                  Cancelled: {formatAuditTime(selectedBooking.cancelled_at)} PKT
                  {selectedBooking.cancelled_by ? ` by ${selectedBooking.cancelled_by}` : ''}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-white/10">
              {selectedBooking.status !== 'CONFIRMED' && (
                <button
                  type="button"
                  disabled={updatingId === selectedBooking.id}
                  onClick={() => void handleModalStatusChange(selectedBooking.id, 'CONFIRMED')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[38px] text-xs font-bold text-[#0E1845] bg-[#c4d835] hover:bg-[#d4e157] rounded-md cursor-pointer disabled:opacity-50"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Confirm Booking</span>
                </button>
              )}

              {selectedBooking.status === 'PENDING' && (
                <button
                  type="button"
                  disabled={updatingId === selectedBooking.id}
                  onClick={() => void handleModalStatusChange(selectedBooking.id, 'REJECTED')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[38px] text-xs font-semibold text-rose-200 bg-rose-950/60 hover:bg-rose-900/70 border border-rose-400/30 rounded-md cursor-pointer disabled:opacity-50"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>Reject Booking</span>
                </button>
              )}

              {(selectedBooking.status === 'PENDING' ||
                selectedBooking.status === 'CONFIRMED') && (
                <button
                  type="button"
                  disabled={updatingId === selectedBooking.id}
                  onClick={() => void handleModalStatusChange(selectedBooking.id, 'CANCELLED')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[38px] text-xs font-semibold text-slate-200 bg-white/5 hover:bg-white/10 border border-white/15 rounded-md cursor-pointer disabled:opacity-50"
                >
                  <Ban className="w-3.5 h-3.5" />
                  <span>Cancel Booking</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
