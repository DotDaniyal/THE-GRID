import { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, ArrowUpRight, Check, CheckCircle2, Clock, Copy, ShieldCheck } from 'lucide-react';
import { CONTACT, PAYMENT_INFO } from '@/src/config/brand';
import {
  buildWhatsAppBookingMessage,
  buildWhatsAppBookingUrl,
} from '@/src/services/integrations/whatsapp';
import type { CreatedBooking } from '@/src/types/booking';
import { formatReadableDate } from '@/src/utils/date';

interface BookingConfirmationCardProps {
  booking: CreatedBooking;
  onBookAnother: () => void;
}

export function BookingConfirmationCard({
  booking,
  onBookAnother,
}: BookingConfirmationCardProps) {
  const [copiedMsg, setCopiedMsg] = useState(false);

  const whatsappMessage = buildWhatsAppBookingMessage(booking);
  const whatsappHref = buildWhatsAppBookingUrl(booking);
  const advancePkr = Math.round((booking.totalAmountPkr * PAYMENT_INFO.advancePercent) / 100);
  const remainingPkr = booking.totalAmountPkr - advancePkr;

  const handleCopyMessage = async () => {
    try {
      await navigator.clipboard.writeText(whatsappMessage);
      setCopiedMsg(true);
      window.setTimeout(() => setCopiedMsg(false), 2600);
    } catch {
      // Ignore clipboard permission errors
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-xl border border-[#c4d835]/45 bg-[#121D52]/96 p-6 sm:p-8 space-y-6 shadow-[0_24px_70px_rgba(4,8,24,0.6)]"
    >
      <div className="flex items-start gap-4 pb-5 border-b border-white/10">
        <div className="w-12 h-12 rounded-lg bg-[#c4d835] text-[#0E1845] flex items-center justify-center shrink-0">
          <CheckCircle2 className="w-6 h-6" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#c4d835]">
            Step 1 Complete · Requested
          </p>
          <h1 className="mt-1 font-display text-3xl sm:text-4xl font-extrabold uppercase text-white">
            Awaiting Advance Payment
          </h1>
          <p className="mt-1.5 text-sm text-slate-200 leading-relaxed">
            Your booking request has been logged and your slot is temporarily held for{' '}
            <strong className="text-white">{PAYMENT_INFO.holdDurationMinutes} minutes</strong>.
            Confirmation completes only after your {PAYMENT_INFO.advancePercent}% advance transfer is
            verified.
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
        <li className="rounded-lg border border-amber-300/50 bg-amber-950/20 p-3">
          <div className="flex items-center gap-1.5 font-bold uppercase text-amber-300">
            <Clock className="w-3.5 h-3.5" aria-hidden="true" />
            <span>2. Awaiting Advance (Current)</span>
          </div>
          <p className="mt-1 text-slate-200">
            Transfer PKR {advancePkr.toLocaleString()} within {PAYMENT_INFO.holdDurationMinutes} min.
          </p>
        </li>
        <li className="rounded-lg border border-white/10 bg-[#0B1236]/60 p-3">
          <div className="flex items-center gap-1.5 font-bold uppercase text-slate-300">
            <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
            <span>3. Confirmed (Next)</span>
          </div>
          <p className="mt-1 text-slate-400">Admin verifies WhatsApp screenshot.</p>
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
          <dd className="mt-1 font-mono-tabular text-sm font-bold text-amber-300">
            {booking.status} (Awaiting Advance Payment)
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
            50% Advance Due / Total
          </dt>
          <dd className="mt-1 font-mono-tabular text-base font-bold text-[#c4d835]">
            PKR {advancePkr.toLocaleString()} now · PKR {booking.totalAmountPkr.toLocaleString()} total
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
