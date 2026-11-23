import { useState } from 'react';
import { ArrowUpRight, Ban, Calendar, Check, Search, X, XCircle } from 'lucide-react';
import type { AdminBookingRow, BookingStatus } from '@/src/types/booking';

interface AdminBookingsListProps {
  bookings: AdminBookingRow[];
  updatingId: string | null;
  onUpdateStatus: (bookingId: string, status: BookingStatus) => Promise<void>;
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
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function AdminBookingsList({
  bookings,
  updatingId,
  onUpdateStatus,
}: AdminBookingsListProps) {
  const [statusFilter, setStatusFilter] = useState<'ALL' | BookingStatus>('ALL');
  const [dateFilter, setDateFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

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
      b.booking_date.includes(q)
    );
  });

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
          No booking requests match the current filter.
        </div>
      ) : (
        <div className="space-y-3">
          {filteredBookings.map((b) => {
            const cleanDigits = b.customer_phone.replace(/[^\d]/g, '');
            const waLink = cleanDigits ? `https://wa.me/${cleanDigits}` : undefined;
            const createdLabel = formatAuditTime(b.created_at);
            const holdLabel = formatAuditTime(b.hold_expires_at);
            const confirmedLabel = formatAuditTime(b.confirmed_at);

            return (
              <div
                key={b.id}
                className="rounded-xl border border-white/12 bg-[#121D52]/80 p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
              >
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono-tabular text-sm font-bold text-[#c4d835]">
                      {b.id}
                    </span>
                    <span aria-hidden="true" className="text-slate-500">
                      ·
                    </span>
                    <span className="font-semibold text-white">{b.customer_name}</span>
                    <span aria-hidden="true" className="text-slate-500">
                      ·
                    </span>
                    <span
                      className={`text-xs font-bold uppercase ${
                        b.status === 'CONFIRMED'
                          ? 'text-[#c4d835]'
                          : b.status === 'PENDING'
                          ? 'text-amber-300'
                          : 'text-rose-300'
                      }`}
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
                    <span className="capitalize">{b.booking_type}</span>
                    <span className="font-mono-tabular">{b.customer_phone}</span>
                    <span>{b.customer_email}</span>
                  </div>

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
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
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
                      <span>Approve</span>
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
    </div>
  );
}
