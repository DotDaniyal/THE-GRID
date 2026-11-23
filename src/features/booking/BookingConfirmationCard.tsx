import { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpRight,
  Ban,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ShieldCheck,
} from 'lucide-react';
import { CONTACT, PAYMENT_INFO } from '@/src/config/brand';
import { useSlotStream, type SlotStreamEvent } from '@/src/hooks/useSlotStream';
import { getBookingLiveStatus } from '@/src/services/api/bookingsApi';
import {
  buildWhatsAppBookingMessage,
  buildWhatsAppBookingUrl,
} from '@/src/services/integrations/whatsapp';
import type { BookingStatus, CreatedBooking } from '@/src/types/booking';
import { formatReadableDate } from '@/src/utils/date';

interface BookingConfirmationCardProps {
  booking: CreatedBooking;
  onBookAnother: () => void;
}

function formatDateTimeLabel(isoValue?: string | null): string | null {
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

export function BookingConfirmationCard({
  booking,
  onBookAnother,
}: BookingConfirmationCardProps) {
  const [copiedMsg, setCopiedMsg] = useState(false);
  const [liveStatus, setLiveStatus] = useState<BookingStatus>(booking.status);
  const [holdExpiresAt, setHoldExpiresAt] = useState<string | null>(
    booking.holdExpiresAt ?? null
  );
  const [confirmedAt, setConfirmedAt] = useState<string | null>(
    booking.confirmedAt ?? null
  );

  useEffect(() => {
    setLiveStatus(booking.status);
    setHoldExpiresAt(booking.holdExpiresAt ?? null);
    setConfirmedAt(booking.confirmedAt ?? null);
  }, [booking]);

  const syncStatusFromServer = useCallback(
    async (signal?: AbortSignal) => {
      if (!booking.statusToken) return;
      try {
        const latest = await getBookingLiveStatus(
          booking.id,
          booking.statusToken,
          signal
        );
        if (signal?.aborted) return;
        setLiveStatus(latest.status);
        setHoldExpiresAt(latest.holdExpiresAt);
        setConfirmedAt(latest.confirmedAt);
      } catch {
        // Ignore transient background status polling errors
      }
    },
    [booking.id, booking.statusToken]
  );

  useEffect(() => {
    if (!booking.statusToken) return;
    const controller = new AbortController();
    void syncStatusFromServer(controller.signal);

    const pollInterval =
      liveStatus === 'PENDING'
        ? window.setInterval(() => {
            void syncStatusFromServer();
          }, 10_000)
        : null;

    return () => {
      controller.abort();
      if (pollInterval !== null) {
        window.clearInterval(pollInterval);
      }
    };
  }, [booking.statusToken, liveStatus, syncStatusFromServer]);

  const handleStreamEvent = useCallback(
    (event: SlotStreamEvent) => {
      if (
        event.type === 'slot_changed' &&
        (event.bookingId === booking.id || event.bookingDate === booking.bookingDate)
      ) {
        void syncStatusFromServer();
      }
    },
    [booking.id, booking.bookingDate, syncStatusFromServer]
  );

  useSlotStream({
    enabled: Boolean(booking.statusToken),
    onSyncEvent: handleStreamEvent,
    onWakeOrReconnect: syncStatusFromServer,
  });

  const syncedBooking: CreatedBooking = {
    ...booking,
    status: liveStatus,
    holdExpiresAt,
    confirmedAt,
  };

  const whatsappMessage = buildWhatsAppBookingMessage(syncedBooking);
  const whatsappHref = buildWhatsAppBookingUrl(syncedBooking);
  const advancePkr = Math.round((booking.totalAmountPkr * PAYMENT_INFO.advancePercent) / 100);
  const remainingPkr = booking.totalAmountPkr - advancePkr;
  const confirmedAtLabel = formatDateTimeLabel(confirmedAt);
  const holdExpiryLabel = formatDateTimeLabel(holdExpiresAt);

  const handleCopyMessage = async () => {
    try {
      await navigator.clipboard.writeText(whatsappMessage);
      setCopiedMsg(true);
      window.setTimeout(() => setCopiedMsg(false), 2600);
    } catch {
      // Ignore clipboard permission errors
    }
  };

  const isConfirmed = liveStatus === 'CONFIRMED';
  const isRejected = liveStatus === 'REJECTED';
  const isCancelled = liveStatus === 'CANCELLED';
  const isPending = liveStatus === 'PENDING';

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-xl border border-[#c4d835]/45 bg-[#121D52]/96 p-6 sm:p-8 space-y-6 shadow-[0_24px_70px_rgba(4,8,24,0.6)]"
    >
      <div className="flex items-start gap-4 pb-5 border-b border-white/10">
        <div
          className={`w-12 h-12 rounded-lg flex items-center justify-center shrink-0 ${
            isConfirmed
              ? 'bg-[#c4d835] text-[#0E1845]'
              : isPending
              ? 'bg-[#c4d835] text-[#0E1845]'
              : 'bg-rose-500/20 text-rose-200 border border-rose-400/40'
          }`}
        >
          {isConfirmed ? (
            <ShieldCheck className="w-6 h-6" />
          ) : isPending ? (
            <CheckCircle2 className="w-6 h-6" />
          ) : (
            <Ban className="w-6 h-6" />
          )}
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#c4d835]">
            {isConfirmed
              ? 'Reservation Verified & Confirmed'
              : isRejected
              ? 'Booking Request Rejected'
              : isCancelled
              ? 'Booking Cancelled / Slot Released'
              : 'Step 1 Complete · Requested'}
          </p>
          <h1 className="mt-1 font-display text-3xl sm:text-4xl font-extrabold uppercase text-white">
            {isConfirmed
              ? 'Booking Confirmed'
              : isRejected
              ? 'Request Not Approved'
              : isCancelled
              ? 'Booking Released'
              : 'Awaiting Advance Payment'}
          </h1>
          <p className="mt-1.5 text-sm text-slate-200 leading-relaxed">
            {isConfirmed ? (
              <>
                Your court reservation is{' '}
                <strong className="text-[#c4d835]">confirmed</strong>
                {confirmedAtLabel ? ` (${confirmedAtLabel} PKT)` : ''}. Present your
                Booking Reference ID at THE GRID reception before kickoff.
              </>
            ) : isRejected ? (
              <>
                This booking request was declined by THE GRID administration and the
                time slot has been released. You may select another available slot.
              </>
            ) : isCancelled ? (
              <>
                This booking was cancelled or its {PAYMENT_INFO.holdDurationMinutes}-minute
                advance hold expired. The slot has been returned to live availability.
              </>
            ) : (
              <>
                Your booking request has been logged and your slot is temporarily held for{' '}
                <strong className="text-white">
                  {PAYMENT_INFO.holdDurationMinutes} minutes
                </strong>
                {holdExpiryLabel ? ` (until ${holdExpiryLabel} PKT)` : ''}. Confirmation
                updates here automatically once your {PAYMENT_INFO.advancePercent}%
                advance transfer is verified.
              </>
            )}
          </p>
        </div>
      </div>

      {/* Unambiguous 3-stage state indicator */}
      <ol aria-label="Booking status progression" className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <li className="rounded-lg border border-[#c4d835]/50 bg-[#0B1236] p-3">
          <div className="flex items-center gap-1.5 font-bold uppercase text-[#c4d835]">
            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>1. Requested (Done)</span>
          </div>
          <p className="mt-1 text-slate-300">Request logged under {booking.id}.</p>
        </li>
        <li
          className={`rounded-lg border p-3 ${
            isConfirmed
              ? 'border-[#c4d835]/50 bg-[#0B1236]'
              : isPending
              ? 'border-amber-300/50 bg-amber-950/20'
              : 'border-white/10 bg-[#0B1236]/60'
          }`}
        >
          <div
            className={`flex items-center gap-1.5 font-bold uppercase ${
              isConfirmed
                ? 'text-[#c4d835]'
                : isPending
                ? 'text-amber-300'
                : 'text-slate-300'
            }`}
          >
            {isConfirmed ? (
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <Clock className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            <span>
              {isConfirmed
                ? '2. Advance Verified (Done)'
                : isPending
                ? '2. Awaiting Advance (Current)'
                : '2. Advance Verification'}
            </span>
          </div>
          <p className="mt-1 text-slate-200">
            Transfer PKR {advancePkr.toLocaleString()} within{' '}
            {PAYMENT_INFO.holdDurationMinutes} min.
          </p>
        </li>
        <li
          className={`rounded-lg border p-3 ${
            isConfirmed
              ? 'border-[#c4d835]/60 bg-[#192869]'
              : isRejected || isCancelled
              ? 'border-rose-400/40 bg-rose-950/25'
              : 'border-white/10 bg-[#0B1236]/60'
          }`}
        >
          <div
            className={`flex items-center gap-1.5 font-bold uppercase ${
              isConfirmed
                ? 'text-[#c4d835]'
                : isRejected || isCancelled
                ? 'text-rose-300'
                : 'text-slate-300'
            }`}
          >
            {isConfirmed ? (
              <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
            ) : isRejected || isCancelled ? (
              <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            <span>
              {isConfirmed
                ? '3. Confirmed (Active)'
                : isRejected
                ? '3. Rejected'
                : isCancelled
                ? '3. Cancelled'
                : '3. Confirmed (Next)'}
            </span>
          </div>
          <p className="mt-1 text-slate-300">
            {isConfirmed
              ? confirmedAtLabel
                ? `Confirmed at ${confirmedAtLabel} PKT.`
                : 'Verified by THE GRID admin team.'
              : isRejected || isCancelled
              ? 'Slot returned to public schedule.'
              : 'Admin verifies WhatsApp screenshot.'}
          </p>
        </li>
      </ol>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-lg border border-white/10 bg-[#0B1236]/85 p-5 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wider text-slate-400">
            Booking Reference ID
          </dt>
          <dd className="mt-1 font-mono-tabular text-base font-bold text-[#c4d835]">
            {booking.id}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-slate-400">
            Current Status
          </dt>
          <dd
            className={`mt-1 font-mono-tabular text-sm font-bold ${
              isConfirmed
                ? 'text-[#c4d835]'
                : isPending
                ? 'text-amber-300'
                : 'text-rose-300'
            }`}
          >
            {isConfirmed
              ? 'CONFIRMED'
              : isPending
              ? 'PENDING (Awaiting Advance Payment)'
              : liveStatus}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-slate-400">Customer Name</dt>
          <dd className="mt-1 font-semibold text-white">{booking.customerName}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-slate-400">Venue</dt>
          <dd className="mt-1 font-semibold text-white">{booking.venueName}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-slate-400">Selected Date</dt>
          <dd className="mt-1 font-mono-tabular font-semibold text-white">
            {formatReadableDate(booking.bookingDate)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-slate-400">Selected Time</dt>
          <dd className="mt-1 font-mono-tabular font-semibold text-white">
            {booking.displayName}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-slate-400">Booking Type</dt>
          <dd className="mt-1 font-semibold text-white capitalize">
            {booking.bookingType}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-slate-400">
            {isConfirmed ? '50% Advance / Remaining at Venue' : '50% Advance Due / Total'}
          </dt>
          <dd className="mt-1 font-mono-tabular text-base font-bold text-[#c4d835]">
            {isConfirmed
              ? `PKR ${advancePkr.toLocaleString()} paid · PKR ${remainingPkr.toLocaleString()} at venue`
              : `PKR ${advancePkr.toLocaleString()} now · PKR ${booking.totalAmountPkr.toLocaleString()} total`}
          </dd>
        </div>
      </dl>

      <div className="rounded-lg border border-[#c4d835]/30 bg-[#1B2B72]/60 p-4 text-xs sm:text-sm text-slate-200 leading-relaxed space-y-1.5">
        <div className="font-semibold text-[#c4d835]">
          Advance Payment &amp; Temporary Hold Instruction
        </div>
        <p>
          Transfer{' '}
          <strong className="font-mono-tabular text-white">
            PKR {advancePkr.toLocaleString()} ({PAYMENT_INFO.advancePercent}% advance)
          </strong>{' '}
          to <strong className="text-white">{PAYMENT_INFO.bankName}</strong> IBAN{' '}
          <span className="font-mono-tabular font-semibold text-white select-all">
            {PAYMENT_INFO.iban}
          </span>{' '}
          ({PAYMENT_INFO.accountTitle}), then send your booking message and payment screenshot to
          WhatsApp{' '}
          <span className="font-mono-tabular font-semibold text-white">
            {CONTACT.phoneDisplay}
          </span>{' '}
          within <strong className="text-white">{PAYMENT_INFO.holdDurationMinutes} minutes</strong>.
          The remaining{' '}
          <strong className="font-mono-tabular text-white">PKR {remainingPkr.toLocaleString()}</strong>{' '}
          is due at the venue before kickoff. Unverified holds are automatically released.
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-300">
            WhatsApp Request Message Preview
          </span>
          <button
            type="button"
            onClick={handleCopyMessage}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:text-[#c4d835] border border-white/15 rounded-md cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4d835]"
          >
            {copiedMsg ? (
              <>
                <Check className="w-3.5 h-3.5 text-[#c4d835]" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Message</span>
              </>
            )}
          </button>
        </div>

        <pre className="p-4 rounded-lg border border-white/10 bg-[#080E2B] text-xs font-mono-tabular text-slate-200 whitespace-pre-wrap leading-relaxed">
          {whatsappMessage}
        </pre>

        <p className="text-xs text-slate-300">
          Click below to open WhatsApp with your pre-filled booking details so you can attach your
          payment screenshot and send to THE GRID.
        </p>
      </div>

      <div className="pt-2 flex flex-col sm:flex-row gap-3">
        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3.5 min-h-[48px] text-sm font-bold text-[#0E1845] bg-[#c4d835] hover:bg-[#d4e157] rounded-lg transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <span>Open WhatsApp &amp; Send Request</span>
          <ArrowUpRight className="w-4 h-4" />
        </a>

        <button
          type="button"
          onClick={onBookAnother}
          className="inline-flex items-center justify-center gap-2 px-5 py-3.5 min-h-[48px] text-sm font-semibold text-white bg-white/5 hover:bg-white/10 border border-white/15 rounded-lg transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4d835]"
        >
          <ArrowLeft className="w-4 h-4 text-[#c4d835]" />
          <span>Book Another Slot</span>
        </button>
      </div>
    </motion.div>
  );
}
