import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, ArrowLeft, CheckCircle2, Clock, Lock, ShieldCheck, User, Users } from 'lucide-react';
import { LegalModal, type LegalDocType } from '@/src/components/modals/LegalModal';
import { CONTACT, PAYMENT_INFO } from '@/src/config/brand';
import { COUNTRY_CODES, SINGLE_COURT } from '@/src/config/venue';
import { BookingConfirmationCard } from '@/src/features/booking/BookingConfirmationCard';
import { SharedSplitPanel } from '@/src/features/booking/SharedSplitPanel';
import { submitBookingRequest } from '@/src/services/api/bookingsApi';
import type {
  BookingSelection,
  BookingType,
  CreatedBooking,
  SharedParticipant,
} from '@/src/types/booking';
import { formatReadableDate } from '@/src/utils/date';
import { validateCustomerDetails } from '@/src/utils/validation';

interface BookingDetailsPageProps {
  selection: BookingSelection | null;
  onBackToSlots: () => void;
  onBookingSubmitted: () => void;
}

const DEFAULT_PARTICIPANTS = (): SharedParticipant[] =>
  Array.from({ length: 6 }, () => ({ name: '', phone: '' }));

export function BookingDetailsPage({
  selection,
  onBackToSlots,
  onBookingSubmitted,
}: BookingDetailsPageProps) {
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [countryCode, setCountryCode] = useState('+92');
  const [customerPhone, setCustomerPhone] = useState('');
  const [bookingType, setBookingType] = useState<BookingType>('individual');
  const [participants, setParticipants] = useState<SharedParticipant[]>(DEFAULT_PARTICIPANTS);
  const [additionalGuestsCount, setAdditionalGuestsCount] = useState(0);
  const [policiesAccepted, setPoliciesAccepted] = useState(false);

  const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>({});
  const [policyFeedbackRequested, setPolicyFeedbackRequested] = useState(false);
  const [legalDoc, setLegalDoc] = useState<LegalDocType>(null);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmedBooking, setConfirmedBooking] = useState<CreatedBooking | null>(null);

  const policyCheckboxRef = useRef<HTMLInputElement | null>(null);

  const liveValidationErrors = useMemo(
    () =>
      validateCustomerDetails({
        customerName,
        customerEmail,
        countryCode,
        customerPhone,
      }),
    [customerName, customerEmail, countryCode, customerPhone]
  );

  const areCustomerFieldsValid = Object.keys(liveValidationErrors).length === 0;
  const canSubmit = areCustomerFieldsValid && policiesAccepted && !submitting;

  if (!selection && !confirmedBooking) {
    return (
      <div className="relative min-h-screen pt-28 pb-20 bg-[#0C153B] flex items-center justify-center px-4">
        <div className="max-w-md w-full rounded-xl border border-[#c4d835]/30 bg-[#16235C]/80 p-8 text-center space-y-4">
          <h1 className="font-display text-3xl font-bold uppercase text-white">
            No Time Slot Selected
          </h1>
          <p className="text-sm text-slate-300">
            Please select your booking date and an available hourly slot first.
          </p>
          <button
            type="button"
            onClick={onBackToSlots}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 min-h-[46px] text-sm font-bold text-[#0E1845] bg-[#c4d835] hover:bg-[#d4e157] rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Choose Date &amp; Time Slot</span>
          </button>
        </div>
      </div>
    );
  }

  if (confirmedBooking) {
    return (
      <div className="relative min-h-screen pt-24 pb-20 bg-[#0C153B] overflow-hidden">
        <div aria-hidden="true" className="fixed inset-0 z-0 pointer-events-none">
          <img
            src="/gallery/turf.jpeg"
            alt=""
            className="w-full h-full object-cover object-center opacity-25"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#0C153B]/92 via-[#152463]/90 to-[#09102E]/96" />
        </div>

        <div className="relative z-10 max-w-3xl mx-auto px-4 sm:px-6">
          <BookingConfirmationCard
            booking={confirmedBooking}
            onBookAnother={onBackToSlots}
          />
        </div>
      </div>
    );
  }

  const activeSelection = selection!;
  const activeCountry =
    COUNTRY_CODES.find((c) => c.code === countryCode) ?? COUNTRY_CODES[0];

  const totalPkr = activeSelection.slot.pricePkr;
  const advancePkr = Math.round((totalPkr * PAYMENT_INFO.advancePercent) / 100);
  const remainingPkr = totalPkr - advancePkr;

  const visibleFieldErrors = {
    customerName: touchedFields.customerName ? liveValidationErrors.customerName : undefined,
    customerEmail: touchedFields.customerEmail ? liveValidationErrors.customerEmail : undefined,
    customerPhone: touchedFields.customerPhone ? liveValidationErrors.customerPhone : undefined,
  };

  const showPolicyError = policyFeedbackRequested && !policiesAccepted;

  const revealValidationState = () => {
    setTouchedFields({
      customerName: true,
      customerEmail: true,
      customerPhone: true,
    });
    setPolicyFeedbackRequested(true);
    if (areCustomerFieldsValid && !policiesAccepted) {
      policyCheckboxRef.current?.focus();
    }
  };

  const handleFormKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (
      e.key === 'Enter' &&
      (e.target as HTMLElement)?.tagName === 'INPUT' &&
      !canSubmit
    ) {
      e.preventDefault();
      revealValidationState();
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitError(null);

    if (!areCustomerFieldsValid || !policiesAccepted) {
      revealValidationState();
      return;
    }

    setSubmitting(true);
    try {
      const created = await submitBookingRequest({
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim(),
        countryCode,
        customerPhone: customerPhone.trim(),
        bookingType,
        bookingDate: activeSelection.bookingDate,
        startTime: activeSelection.slot.startTime,
        additionalGuestsCount: bookingType === 'shared' ? additionalGuestsCount : 0,
        participants: bookingType === 'shared' ? participants : undefined,
        policiesAccepted: true,
      });

      setConfirmedBooking(created);
      onBookingSubmitted();
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Network error submitting booking request.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const updateParticipant = (idx: number, field: keyof SharedParticipant, value: string) => {
    setParticipants((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p))
    );
  };

  return (
    <div className="relative min-h-screen pt-24 pb-20 bg-[#0C153B] overflow-hidden">
      <div aria-hidden="true" className="fixed inset-0 z-0 pointer-events-none">
        <img
          src="/gallery/turf.jpeg"
          alt=""
          className="w-full h-full object-cover object-center opacity-30"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0C153B]/92 via-[#152463]/88 to-[#09102E]/96" />
      </div>

      <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="pb-6 border-b border-[#c4d835]/20 flex flex-col sm:flex-row sm:items-end justify-between gap-4"
        >
          <div>
            <button
              type="button"
              onClick={onBackToSlots}
              className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#c4d835] hover:text-white transition-colors mb-3 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4d835] rounded"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Change Date / Time Slot</span>
            </button>
            <h1 className="font-display text-4xl sm:text-5xl font-extrabold uppercase tracking-tight text-white">
              Booking Details
            </h1>
            <p className="mt-1 text-sm text-slate-300">
              Page 03 · Review payment rules and complete your player details to submit a booking request.
            </p>
          </div>

          <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wider">
            <span className="text-slate-400">01. Date &amp; Time</span>
            <span aria-hidden="true" className="text-slate-500">
              /
            </span>
            <span className="text-[#c4d835]">02. Booking Details</span>
          </div>
        </motion.div>

        {/* Slot & Amount Summary */}
        <motion.section
          aria-label="Selected booking summary"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 }}
          className="rounded-xl border border-[#c4d835]/35 bg-[#16235C]/92 p-5 sm:p-6 grid grid-cols-2 md:grid-cols-4 gap-4"
        >
          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-300">Selected Ground</div>
            <div className="mt-1 text-sm font-semibold text-white">{SINGLE_COURT.name}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-300">Booking Date</div>
            <div className="mt-1 font-mono-tabular text-sm font-semibold text-white">
              {formatReadableDate(activeSelection.bookingDate)}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-300">Booking Time</div>
            <div className="mt-1 font-mono-tabular text-sm font-semibold text-[#c4d835]">
              {activeSelection.slot.displayName}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-300">
              Total Amount (PKR)
            </div>
            <div className="mt-1 font-mono-tabular text-lg font-bold text-[#c4d835]">
              PKR {totalPkr.toLocaleString()}
            </div>
          </div>
        </motion.section>

        {/* Payment, Temporary Hold & Confirmation Clarity */}
        <motion.section
          aria-labelledby="payment-clarity-heading"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.08 }}
          className="rounded-xl border border-[#c4d835]/35 bg-[#121D52]/95 p-5 sm:p-6 space-y-5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-white/10">
            <div>
              <h2
                id="payment-clarity-heading"
                className="font-display text-xl sm:text-2xl font-bold uppercase text-white"
              >
                Reservation Status &amp; Advance Payment Guide
              </h2>
              <p className="mt-1 text-xs sm:text-sm text-slate-200">
                Submitting this form creates a <strong className="text-white">booking request</strong>, not an immediately confirmed reservation.
              </p>
            </div>
            <div className="shrink-0 rounded-lg border border-[#c4d835]/40 bg-[#0B1338] px-4 py-2.5 text-left sm:text-right">
              <div className="text-[11px] uppercase tracking-wider text-[#c4d835] font-semibold">
                {PAYMENT_INFO.advancePercent}% Advance Required
              </div>
              <div className="font-mono-tabular text-base font-bold text-white">
                PKR {advancePkr.toLocaleString()} now · PKR {remainingPkr.toLocaleString()} at venue
              </div>
            </div>
          </div>

          {/* Unambiguous 3-step confirmation progression */}
          <div aria-label="Booking confirmation stages" className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
              Confirmation Progression
            </div>
            <ol className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <li className="rounded-lg border border-[#c4d835]/45 bg-[#0B1338]/90 p-3 space-y-1">
                <div className="flex items-center gap-1.5 font-bold uppercase text-[#c4d835]">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>1. Requested</span>
                </div>
                <p className="text-slate-300 leading-relaxed">
                  Submit this form to log your slot request and receive a booking reference ID.
                </p>
              </li>
              <li className="rounded-lg border border-white/15 bg-[#0B1338]/75 p-3 space-y-1">
                <div className="flex items-center gap-1.5 font-bold uppercase text-amber-300">
                  <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>2. Awaiting Advance Payment</span>
                </div>
                <p className="text-slate-300 leading-relaxed">
                  Slot is temporarily held for {PAYMENT_INFO.holdDurationMinutes} minutes while you transfer {PAYMENT_INFO.advancePercent}% and share proof on WhatsApp.
                </p>
              </li>
              <li className="rounded-lg border border-white/15 bg-[#0B1338]/75 p-3 space-y-1">
                <div className="flex items-center gap-1.5 font-bold uppercase text-white">
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-[#c4d835]" aria-hidden="true" />
                  <span>3. Confirmed</span>
                </div>
                <p className="text-slate-300 leading-relaxed">
                  THE GRID team verifies your transfer and confirms your court slot.
                </p>
              </li>
            </ol>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1 text-xs sm:text-sm text-slate-200 leading-relaxed">
            <div className="rounded-lg border border-white/10 bg-[#09102E]/85 p-4 space-y-1.5">
              <div className="font-semibold text-[#c4d835]">
                Temporary Hold &amp; Auto-Release Policy
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                A <strong className="text-white">{PAYMENT_INFO.advancePercent}% advance payment is required to confirm your booking.</strong>{' '}
                Your selected slot is placed on a temporary{' '}
                <strong className="text-white">{PAYMENT_INFO.holdDurationMinutes}-minute hold</strong>{' '}
                only after you submit this request (not while filling out the form). If advance
                payment proof is not received within {PAYMENT_INFO.holdDurationMinutes} minutes, the
                hold is automatically released for other players.
              </p>
            </div>

            <div className="rounded-lg border border-white/10 bg-[#09102E]/85 p-4 space-y-1.5">
              <div className="font-semibold text-[#c4d835]">
                Payment Method &amp; Next Steps ({PAYMENT_INFO.bankName})
              </div>
              <ol className="text-xs text-slate-300 space-y-1 list-decimal list-inside leading-relaxed">
                <li>
                  Transfer <strong className="font-mono-tabular text-white">PKR {advancePkr.toLocaleString()}</strong> to{' '}
                  <strong className="text-white">{PAYMENT_INFO.bankName}</strong> IBAN{' '}
                  <span className="font-mono-tabular text-white font-semibold select-all">
                    {PAYMENT_INFO.iban}
                  </span>{' '}
                  ({PAYMENT_INFO.accountTitle}).
                </li>
                <li>
                  Send your payment screenshot and Booking Reference ID via WhatsApp to{' '}
                  <span className="font-mono-tabular text-white font-semibold">
                    {CONTACT.phoneDisplay}
                  </span>
                  .
                </li>
              </ol>
            </div>
          </div>
        </motion.section>

        <motion.form
          onSubmit={handleSubmit}
          onKeyDown={handleFormKeyDown}
          noValidate
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.1 }}
          className="rounded-xl border border-[#c4d835]/30 bg-[#16235C]/92 p-6 sm:p-8 space-y-6"
        >
          <h2 className="font-display text-2xl font-bold uppercase text-[#c4d835]">
            3. Enter Your Details
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label htmlFor="bd-name" className="block text-xs font-semibold text-slate-200 mb-1.5">
                Customer Full Name <span className="text-[#c4d835]">*</span>
              </label>
              <input
                id="bd-name"
                type="text"
                required
                aria-invalid={Boolean(visibleFieldErrors.customerName)}
                aria-describedby={visibleFieldErrors.customerName ? 'bd-name-error' : undefined}
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                onBlur={() => setTouchedFields((prev) => ({ ...prev, customerName: true }))}
                placeholder="e.g. Daniyal Hayyat"
                className="w-full min-h-[46px] px-3.5 py-2.5 text-sm text-white bg-[#0B1338]/90 border border-white/20 rounded-lg focus:outline-none focus:border-[#c4d835] focus-visible:ring-2 focus-visible:ring-[#c4d835]"
              />
              {visibleFieldErrors.customerName && (
                <p id="bd-name-error" role="alert" className="mt-1 text-xs text-rose-300">
                  {visibleFieldErrors.customerName}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="bd-email" className="block text-xs font-semibold text-slate-200 mb-1.5">
                Email Address <span className="text-[#c4d835]">*</span>
              </label>
              <input
                id="bd-email"
                type="email"
                required
                aria-invalid={Boolean(visibleFieldErrors.customerEmail)}
                aria-describedby={visibleFieldErrors.customerEmail ? 'bd-email-error' : undefined}
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                onBlur={() => setTouchedFields((prev) => ({ ...prev, customerEmail: true }))}
                placeholder="player@example.com"
                className="w-full min-h-[46px] px-3.5 py-2.5 text-sm text-white bg-[#0B1338]/90 border border-white/20 rounded-lg focus:outline-none focus:border-[#c4d835] focus-visible:ring-2 focus-visible:ring-[#c4d835]"
              />
              {visibleFieldErrors.customerEmail && (
                <p id="bd-email-error" role="alert" className="mt-1 text-xs text-rose-300">
                  {visibleFieldErrors.customerEmail}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="bd-country" className="block text-xs font-semibold text-slate-200 mb-1.5">
                Country Code <span className="text-[#c4d835]">*</span>
              </label>
              <select
                id="bd-country"
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value)}
                className="w-full min-h-[46px] px-3.5 py-2.5 text-sm text-white bg-[#0B1338]/90 border border-white/20 rounded-lg focus:outline-none focus:border-[#c4d835] focus-visible:ring-2 focus-visible:ring-[#c4d835]"
              >
                {COUNTRY_CODES.map((c) => (
                  <option key={c.code} value={c.code} className="bg-[#0B1338] text-white">
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="bd-phone" className="block text-xs font-semibold text-slate-200 mb-1.5">
                WhatsApp / Mobile Number <span className="text-[#c4d835]">*</span>
              </label>
              <div className="flex">
                <span className="inline-flex items-center px-3 min-h-[46px] font-mono-tabular text-sm font-semibold text-[#c4d835] bg-[#090F2D] border border-r-0 border-white/20 rounded-l-lg">
                  {countryCode}
                </span>
                <input
                  id="bd-phone"
                  type="tel"
                  required
                  aria-invalid={Boolean(visibleFieldErrors.customerPhone)}
                  aria-describedby={visibleFieldErrors.customerPhone ? 'bd-phone-error' : undefined}
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  onBlur={() => setTouchedFields((prev) => ({ ...prev, customerPhone: true }))}
                  placeholder={activeCountry.placeholder}
                  className="flex-1 min-w-0 min-h-[46px] px-3.5 py-2.5 font-mono-tabular text-sm text-white bg-[#0B1338]/90 border border-white/20 rounded-r-lg focus:outline-none focus:border-[#c4d835] focus-visible:ring-2 focus-visible:ring-[#c4d835]"
                />
              </div>
              {visibleFieldErrors.customerPhone && (
                <p id="bd-phone-error" role="alert" className="mt-1 text-xs text-rose-300">
                  {visibleFieldErrors.customerPhone}
                </p>
              )}
            </div>
          </div>

          <div className="pt-2 border-t border-white/10 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                  Booking Type
                </div>
                <p className="text-xs text-slate-300/80 mt-0.5">
                  Choose Individual or split court fees with your squad under Shared.
                </p>
              </div>

              <div
                role="radiogroup"
                aria-label="Booking type"
                className="inline-flex p-1 rounded-lg bg-[#0B1338] border border-white/15 self-start sm:self-auto"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={bookingType === 'individual'}
                  onClick={() => setBookingType('individual')}
                  className={`inline-flex items-center gap-2 px-4 py-2 min-h-[40px] text-xs sm:text-sm font-semibold rounded-md transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4d835] ${
                    bookingType === 'individual'
                      ? 'bg-[#c4d835] text-[#0E1845]'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <User className="w-4 h-4" />
                  <span>Individual</span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={bookingType === 'shared'}
                  onClick={() => setBookingType('shared')}
                  className={`inline-flex items-center gap-2 px-4 py-2 min-h-[40px] text-xs sm:text-sm font-semibold rounded-md transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4d835] ${
                    bookingType === 'shared'
                      ? 'bg-[#c4d835] text-[#0E1845]'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <Users className="w-4 h-4" />
                  <span>Shared</span>
                </button>
              </div>
            </div>

            {bookingType === 'shared' && (
              <SharedSplitPanel
                totalAmountPkr={totalPkr}
                participants={participants}
                additionalGuestsCount={additionalGuestsCount}
                onUpdateParticipant={updateParticipant}
                onChangeAdditionalGuests={setAdditionalGuestsCount}
              />
            )}
          </div>

          <div className="pt-2 border-t border-white/10">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-300 mb-3">
              <Lock className="w-3.5 h-3.5 text-[#c4d835]" aria-hidden="true" />
              <span>Protected Slot &amp; Rate Details (Auto-Populated)</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-[#09102E]/90 border border-white/10">
                <div className="text-[11px] text-slate-400">Booking Date</div>
                <div className="mt-0.5 font-mono-tabular text-xs font-semibold text-white">
                  {activeSelection.bookingDate}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-[#09102E]/90 border border-white/10">
                <div className="text-[11px] text-slate-400">Booking Time</div>
                <div className="mt-0.5 font-mono-tabular text-xs font-semibold text-white">
                  {activeSelection.slot.displayName}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-[#09102E]/90 border border-white/10">
                <div className="text-[11px] text-slate-400">Selected Ground</div>
                <div className="mt-0.5 text-xs font-semibold text-white">
                  {SINGLE_COURT.name}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-[#09102E]/90 border border-[#c4d835]/35">
                <div className="text-[11px] text-slate-400">Total / 50% Advance</div>
                <div className="mt-0.5 font-mono-tabular text-sm font-bold text-[#c4d835]">
                  PKR {totalPkr.toLocaleString()} / PKR {advancePkr.toLocaleString()}
                </div>
              </div>
            </div>
          </div>

          {/* Required Booking-Policy Acknowledgement */}
          <div className="pt-3 border-t border-white/10 space-y-3">
            <div
              className={`rounded-lg border p-4 transition-colors ${
                showPolicyError
                  ? 'border-rose-400/50 bg-rose-950/25'
                  : policiesAccepted
                  ? 'border-[#c4d835]/45 bg-[#0B1338]/90'
                  : 'border-white/15 bg-[#0B1338]/75'
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  ref={policyCheckboxRef}
                  id="bd-policy-checkbox"
                  type="checkbox"
                  required
                  checked={policiesAccepted}
                  aria-invalid={showPolicyError}
                  aria-describedby={
                    showPolicyError ? 'bd-policy-links bd-policy-error' : 'bd-policy-links'
                  }
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setPoliciesAccepted(checked);
                    if (!checked) {
                      setPolicyFeedbackRequested(true);
                    }
                  }}
                  onBlur={() => {
                    if (!policiesAccepted) setPolicyFeedbackRequested(true);
                  }}
                  className="mt-0.5 h-5 w-5 shrink-0 rounded border border-white/30 bg-[#070A14] accent-[#c4d835] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4d835]"
                />
                <div className="space-y-2">
                  <label
                    htmlFor="bd-policy-checkbox"
                    className="block text-xs sm:text-sm text-slate-200 leading-relaxed cursor-pointer"
                  >
                    I agree to the Terms &amp; Conditions, Privacy Policy, cancellation/refund
                    policy, and understand that my booking is confirmed only after the required{' '}
                    {PAYMENT_INFO.advancePercent}% advance payment is verified.{' '}
                    <span className="text-[#c4d835]">*</span>
                  </label>

                  <div
                    id="bd-policy-links"
                    className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs"
                  >
                    <button
                      type="button"
                      onClick={() => setLegalDoc('terms')}
                      className="text-[#c4d835] hover:text-white underline underline-offset-4 font-semibold cursor-pointer py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4d835] rounded"
                    >
                      Read Terms &amp; Conditions
                    </button>
                    <button
                      type="button"
                      onClick={() => setLegalDoc('privacy')}
                      className="text-[#c4d835] hover:text-white underline underline-offset-4 font-semibold cursor-pointer py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4d835] rounded"
                    >
                      Read Privacy Policy
                    </button>
                    <button
                      type="button"
                      onClick={() => setLegalDoc('cancellation')}
                      className="text-[#c4d835] hover:text-white underline underline-offset-4 font-semibold cursor-pointer py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4d835] rounded"
                    >
                      Read Cancellation &amp; Refund Policy
                    </button>
                  </div>
                </div>
              </div>

              {showPolicyError && (
                <p id="bd-policy-error" role="alert" className="mt-2.5 text-xs text-rose-300 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    Please check the box above to agree to the booking, cancellation/refund, and privacy policies before submitting.
                  </span>
                </p>
              )}
            </div>
          </div>

          {submitError && (
            <div
              role="alert"
              className="p-4 rounded-lg border border-rose-400/40 bg-rose-950/45 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="flex items-start gap-2.5 text-sm text-rose-200">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-300" />
                <span>{submitError}</span>
              </div>
              <button
                type="button"
                onClick={onBackToSlots}
                className="px-4 py-2 text-xs font-semibold text-white bg-white/10 hover:bg-white/20 rounded-md cursor-pointer self-start sm:self-auto"
              >
                Pick Another Slot
              </button>
            </div>
          )}

          <div
            onClick={() => {
              if (!canSubmit && !submitting) {
                revealValidationState();
              }
            }}
            className="space-y-2"
          >
            <button
              type="submit"
              disabled={!canSubmit}
              aria-disabled={!canSubmit}
              aria-describedby="bd-submit-status"
              className="w-full inline-flex items-center justify-center gap-2 px-6 py-4 min-h-[54px] text-sm sm:text-base font-bold uppercase tracking-wide text-[#0E1845] bg-[#c4d835] hover:bg-[#d4e157] disabled:bg-[#c4d835]/35 disabled:text-slate-200/75 disabled:cursor-not-allowed rounded-lg shadow-[0_12px_32px_rgba(196,216,53,0.28)] transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              {submitting ? 'Submitting Booking Request...' : 'SUBMIT BOOKING REQUEST'}
            </button>

            <p
              id="bd-submit-status"
              aria-live="polite"
              className="text-xs text-slate-300 text-center"
            >
              {!areCustomerFieldsValid
                ? 'Complete all required player fields above and acknowledge the booking policies to enable submission.'
                : !policiesAccepted
                ? 'Check the policy acknowledgement box above to enable booking request submission.'
                : 'Ready to submit your booking request. Submitting places a 30-minute hold awaiting 50% advance payment verification.'}
            </p>
          </div>
        </motion.form>
      </div>

      <LegalModal
        legalDoc={legalDoc}
        onClose={() => setLegalDoc(null)}
        onSwitchDoc={(doc) => setLegalDoc(doc)}
      />
    </div>
  );
}
