import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { CONTACT, PAYMENT_INFO } from '@/src/config/brand';

export type LegalDocType = 'privacy' | 'terms' | 'cancellation' | null;

interface LegalModalProps {
  legalDoc: LegalDocType;
  onClose: () => void;
  onSwitchDoc?: (doc: Exclude<LegalDocType, null>) => void;
}

const TITLES: Record<Exclude<LegalDocType, null>, string> = {
  terms: 'Terms & Conditions',
  privacy: 'Privacy Policy',
  cancellation: 'Cancellation & Refund Policy',
};

export function LegalModal({ legalDoc, onClose, onSwitchDoc }: LegalModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!legalDoc) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);

        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [legalDoc, onClose]);

  if (!legalDoc) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-modal-title"
      className="fixed inset-0 z-50 bg-[#070A14]/92 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="max-w-xl w-full rounded-xl border border-white/15 bg-[#0E1428] p-6 sm:p-8 max-h-[85vh] overflow-y-auto space-y-5 shadow-[0_24px_70px_rgba(4,8,24,0.85)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 pb-3 border-b border-white/10">
          <h3 id="legal-modal-title" className="font-display text-2xl font-bold uppercase text-white">
            {TITLES[legalDoc]}
          </h3>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close policy dialog"
            onClick={onClose}
            className="w-10 h-10 rounded-md text-slate-300 hover:text-white hover:bg-white/10 flex items-center justify-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4d835]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {onSwitchDoc && (
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Policy documents">
            {(['terms', 'privacy', 'cancellation'] as const).map((docKey) => (
              <button
                key={docKey}
                type="button"
                role="tab"
                aria-selected={legalDoc === docKey}
                onClick={() => onSwitchDoc(docKey)}
                className={`px-3 py-1.5 min-h-[36px] text-xs font-semibold rounded-md border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4d835] ${
                  legalDoc === docKey
                    ? 'bg-[#c4d835] text-[#0E1845] border-[#c4d835]'
                    : 'bg-[#121D52] text-slate-300 border-white/15 hover:text-white'
                }`}
              >
                {TITLES[docKey]}
              </button>
            ))}
          </div>
        )}

        {legalDoc === 'privacy' && (
          <div className="space-y-3 text-sm text-slate-300 leading-relaxed">
            <p>
              THE GRID by FC Rovers respects the privacy of all players, academy families, and
              visitors using our digital booking and inquiry channels.
            </p>
            <p>
              Contact details provided during court bookings or WhatsApp inquiries (such as your
              full name, email address, phone number, and slot preferences) are used solely to
              coordinate court reservations, verify advance payments, confirm match schedules, and
              provide venue assistance.
            </p>
            <p>
              We do not sell or distribute player contact records to third parties. For privacy
              or booking record inquiries, reach us at{' '}
              <span className="text-white font-medium">{CONTACT.email}</span> or{' '}
              <span className="font-mono-tabular text-white">{CONTACT.phoneDisplay}</span>.
            </p>
          </div>
        )}

        {legalDoc === 'terms' && (
          <div className="space-y-3 text-sm text-slate-300 leading-relaxed">
            <p>
              1. <strong className="text-white">Booking Request &amp; Advance Confirmation:</strong>{' '}
              Submitting the online booking form creates a pending booking request, not an immediate
              confirmed reservation. Your booking is confirmed only after your{' '}
              <strong className="text-white">{PAYMENT_INFO.advancePercent}% advance payment</strong>{' '}
              via {PAYMENT_INFO.bankName} is verified by THE GRID team.
            </p>
            <p>
              2. <strong className="text-white">Temporary Hold Window:</strong> Upon submitting your
              request, the selected 60-minute slot is temporarily held for{' '}
              <strong className="text-white">{PAYMENT_INFO.holdDurationMinutes} minutes</strong>{' '}
              while you send payment proof on WhatsApp ({CONTACT.phoneDisplay}). Unverified holds
              are automatically released so other players may book the slot.
            </p>
            <p>
              3. <strong className="text-white">Court Usage &amp; Punctuality:</strong> Hourly
              bookings apply strictly to the reserved 60-minute window on THE GRID Futsal Court.
              The remaining 50% balance is payable at the venue prior to kickoff.
            </p>
            <p>
              4. <strong className="text-white">Cantonment Access &amp; Footwear:</strong> Players
              must carry valid original CNIC identification for Malir Cantonment checkpost entry
              and wear turf-appropriate futsal footwear (no metal studs).
            </p>
          </div>
        )}

        {legalDoc === 'cancellation' && (
          <div className="space-y-3 text-sm text-slate-300 leading-relaxed">
            <p>
              1. <strong className="text-white">Unpaid Temporary Holds:</strong> If you do not
              complete the {PAYMENT_INFO.advancePercent}% advance transfer within{' '}
              {PAYMENT_INFO.holdDurationMinutes} minutes of submitting your request, your temporary
              hold is automatically released with no fee.
            </p>
            <p>
              2. <strong className="text-white">Confirmed Bookings (24+ Hours Notice):</strong>{' '}
              Cancellations or rescheduling requests submitted at least 24 hours before kickoff are
              eligible for a full advance refund or a complimentary slot reschedule, subject to
              court availability.
            </p>
            <p>
              3. <strong className="text-white">Late Cancellations &amp; No-Shows:</strong>{' '}
              Cancellations within 24 hours of kickoff or no-shows forfeit the{' '}
              {PAYMENT_INFO.advancePercent}% advance deposit.
            </p>
            <p>
              4. <strong className="text-white">Venue / Weather Closures:</strong> If THE GRID
              cancels a match due to severe weather or facility maintenance, players receive a full
              100% refund of their advance payment or a free reschedule. Contact{' '}
              <span className="text-white font-medium">{CONTACT.email}</span> or WhatsApp{' '}
              <span className="font-mono-tabular text-white">{CONTACT.phoneDisplay}</span> for
              support.
            </p>
          </div>
        )}

        <div className="pt-2 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 min-h-[42px] text-xs font-bold uppercase tracking-wider text-[#0E1845] bg-[#c4d835] hover:bg-[#d4e157] rounded-md transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
