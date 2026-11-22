import { useEffect } from 'react';
import { X } from 'lucide-react';
import { CONTACT } from '@/src/config/brand';

export type LegalDocType = 'privacy' | 'terms' | null;

interface LegalModalProps {
  legalDoc: LegalDocType;
  onClose: () => void;
}

export function LegalModal({ legalDoc, onClose }: LegalModalProps) {
  useEffect(() => {
    if (!legalDoc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [legalDoc, onClose]);

  if (!legalDoc) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={legalDoc === 'privacy' ? 'Privacy Policy' : 'Terms and Conditions'}
      className="fixed inset-0 z-50 bg-[#070A14]/92 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="max-w-xl w-full rounded-xl border border-white/15 bg-[#0E1428] p-6 sm:p-8 max-h-[85vh] overflow-y-auto space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 pb-3 border-b border-white/10">
          <h3 className="font-display text-2xl font-bold uppercase text-white">
            {legalDoc === 'privacy' ? 'Privacy Policy' : 'Terms & Conditions'}
          </h3>
          <button
            type="button"
            aria-label="Close modal"
            onClick={onClose}
            className="w-10 h-10 rounded-md text-slate-300 hover:text-white hover:bg-white/10 flex items-center justify-center cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {legalDoc === 'privacy' ? (
          <div className="space-y-3 text-sm text-slate-300 leading-relaxed">
            <p>
              THE GRID by FC Rovers respects the privacy of all players, academy families, and
              visitors using our digital booking and inquiry channels.
            </p>
            <p>
              Contact details provided during court bookings or WhatsApp inquiries (such as your
              name, phone number, and slot preferences) are used solely to coordinate court
              reservations, confirm match schedules, and provide venue assistance.
            </p>
            <p>
              We do not sell or distribute player contact records to third parties. For privacy
              or booking record inquiries, reach us at{' '}
              <span className="text-white font-medium">{CONTACT.email}</span> or{' '}
              <span className="font-mono-tabular text-white">{CONTACT.phoneDisplay}</span>.
            </p>
          </div>
        ) : (
          <div className="space-y-3 text-sm text-slate-300 leading-relaxed">
            <p>
              1. <strong className="text-white">Court Reservations:</strong> Hourly bookings apply
              strictly to the reserved 60-minute window on THE GRID Futsal Court.
            </p>
            <p>
              2. <strong className="text-white">Cancellations:</strong> Pending reservations may
              be cancelled prior to confirmation. Confirmed bookings require direct coordination
              with THE GRID admin at {CONTACT.email} or {CONTACT.phoneDisplay}.
            </p>
            <p>
              3. <strong className="text-white">Cantonment Access &amp; Footwear:</strong> Players
              must carry valid original CNIC identification for Malir Cantonment checkpost entry
              and wear turf-appropriate futsal footwear (no metal studs).
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
