import { useState, type FormEvent } from 'react';
import { Phone, Mail, ArrowUpRight, CheckCircle2 } from 'lucide-react';
import { CONTACT } from '@/src/config/brand';
import { validateInquiryForm } from '@/src/utils/validation';
import { buildWhatsAppInquiryUrl } from '@/src/services/integrations/whatsapp';
import { FacebookIcon, InstagramIcon } from '@/src/components/common/SocialIcons';

export function ContactSection() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [topic, setTopic] = useState('Court Booking');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const validationError = validateInquiryForm(name, phone, message);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setSubmitted(true);
  };

  const whatsappPrefillUrl = buildWhatsAppInquiryUrl(name, phone, topic, message);

  return (
    <section id="contact" className="relative bg-[#070A14] py-20 sm:py-28 border-t border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-start">
          <div className="lg:col-span-5 space-y-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#c4d835]">
                05. Connect With THE GRID
              </p>
              <h2 className="mt-3 font-display font-bold uppercase tracking-tight text-white text-[clamp(2.25rem,4vw,3.5rem)] leading-[1.02] text-balance">
                Bookings, Academy &amp; Community
              </h2>
              <p className="mt-4 text-base text-slate-300 leading-relaxed">
                Reach our Malir Cantonment ground desk directly for hourly court reservations,
                FC Rovers Academy admissions, or tournament fixtures.
              </p>
            </div>

            <div className="space-y-3">
              <a
                href={CONTACT.whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-4 p-4 min-h-[64px] rounded-xl border border-white/10 bg-[#0E1428] hover:border-[#c4d835]/50 transition-colors group"
              >
                <div className="flex items-center gap-3.5">
                  <Phone className="w-5 h-5 text-[#c4d835] shrink-0" aria-hidden="true" />
                  <div>
                    <div className="text-xs text-slate-400">WhatsApp &amp; Phone</div>
                    <div className="font-mono-tabular text-sm sm:text-base font-semibold text-white">
                      {CONTACT.phoneDisplay}
                    </div>
                  </div>
                </div>
                <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-[#c4d835] transition-colors" aria-hidden="true" />
              </a>

              <a
                href={`mailto:${CONTACT.email}`}
                className="flex items-center justify-between gap-4 p-4 min-h-[64px] rounded-xl border border-white/10 bg-[#0E1428] hover:border-[#c4d835]/50 transition-colors group"
              >
                <div className="flex items-center gap-3.5">
                  <Mail className="w-5 h-5 text-[#c4d835] shrink-0" aria-hidden="true" />
                  <div>
                    <div className="text-xs text-slate-400">Booking Support Email</div>
                    <div className="text-sm sm:text-base font-semibold text-white">
                      {CONTACT.email}
                    </div>
                  </div>
                </div>
                <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-[#c4d835] transition-colors" aria-hidden="true" />
              </a>
            </div>

            <div className="pt-2">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 mb-3">
                Official Social Channels
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <a
                  href={CONTACT.instagramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-3 p-4 min-h-[64px] rounded-xl border border-white/10 bg-[#0E1428] hover:border-[#c4d835]/50 transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-[#c4d835]">
                      <InstagramIcon />
                    </span>
                    <div>
                      <div className="text-xs text-slate-400">Instagram</div>
                      <div className="text-sm font-semibold text-white">
                        {CONTACT.instagramHandle}
                      </div>
                    </div>
                  </div>
                  <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-[#c4d835]" aria-hidden="true" />
                </a>

                <a
                  href={CONTACT.facebookUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-3 p-4 min-h-[64px] rounded-xl border border-white/10 bg-[#0E1428] hover:border-[#c4d835]/50 transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-[#c4d835]">
                      <FacebookIcon />
                    </span>
                    <div>
                      <div className="text-xs text-slate-400">Facebook</div>
                      <div className="text-sm font-semibold text-white">
                        {CONTACT.facebookName}
                      </div>
                    </div>
                  </div>
                  <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-[#c4d835]" aria-hidden="true" />
                </a>
              </div>
            </div>
          </div>

          <div className="lg:col-span-7 rounded-xl border border-white/10 bg-[#0E1428] p-6 sm:p-8">
            <h3 className="font-display text-2xl font-bold uppercase text-white">
              Send an Arena Inquiry
            </h3>
            <p className="mt-1 text-sm text-slate-400">
              Questions about bulk slots, academy registration, or corporate fixtures? Compose
              your inquiry below.
            </p>

            {submitted ? (
              <div className="mt-6 p-6 rounded-lg border border-[#c4d835]/40 bg-[#070A14] space-y-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-[#c4d835] shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <div className="text-base font-semibold text-white">
                      Inquiry Prepared for {name}
                    </div>
                    <p className="mt-1 text-sm text-slate-300">
                      Open WhatsApp below and send this pre-filled inquiry directly to our ground
                      desk ({CONTACT.phoneDisplay}).
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <a
                    href={whatsappPrefillUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 px-5 py-2.5 min-h-[44px] text-sm font-bold text-[#070A14] bg-[#c4d835] hover:bg-[#d4e157] rounded-md transition-colors"
                  >
                    <span>Open in WhatsApp</span>
                    <ArrowUpRight className="w-4 h-4" />
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      setSubmitted(false);
                      setMessage('');
                    }}
                    className="inline-flex items-center justify-center px-4 py-2.5 min-h-[44px] text-sm font-medium text-slate-300 hover:text-white border border-white/15 rounded-md cursor-pointer"
                  >
                    Edit Message
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="inq-name" className="block text-xs font-medium text-slate-300 mb-1.5">
                      Your Name
                    </label>
                    <input
                      id="inq-name"
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Daniyal Hayyat"
                      className="w-full min-h-[44px] px-3.5 py-2 text-sm text-white bg-[#070A14] border border-white/15 rounded-md focus:outline-none focus:border-[#c4d835]"
                    />
                  </div>
                  <div>
                    <label htmlFor="inq-phone" className="block text-xs font-medium text-slate-300 mb-1.5">
                      Phone / WhatsApp Number
                    </label>
                    <input
                      id="inq-phone"
                      type="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+92 300 0000000"
                      className="w-full min-h-[44px] px-3.5 py-2 text-sm text-white bg-[#070A14] border border-white/15 rounded-md focus:outline-none focus:border-[#c4d835]"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="inq-topic" className="block text-xs font-medium text-slate-300 mb-1.5">
                    Inquiry Topic
                  </label>
                  <select
                    id="inq-topic"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    className="w-full min-h-[44px] px-3.5 py-2 text-sm text-white bg-[#070A14] border border-white/15 rounded-md focus:outline-none focus:border-[#c4d835]"
                  >
                    <option value="Court Booking">Court Booking</option>
                    <option value="FC Rovers Academy">FC Rovers Academy</option>
                    <option value="Tournaments & Bulk Slots">Tournaments &amp; Bulk Slots</option>
                    <option value="General Inquiry">General Inquiry</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="inq-message" className="block text-xs font-medium text-slate-300 mb-1.5">
                    Message
                  </label>
                  <textarea
                    id="inq-message"
                    rows={4}
                    required
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Preferred date, time slot, or academy age group..."
                    className="w-full px-3.5 py-2.5 text-sm text-white bg-[#070A14] border border-white/15 rounded-md focus:outline-none focus:border-[#c4d835]"
                  />
                </div>

                {error && (
                  <p role="alert" className="text-xs font-medium text-rose-400">
                    {error}
                  </p>
                )}

                <div className="pt-1 flex flex-wrap items-center justify-between gap-4">
                  <span className="text-xs text-slate-400">
                    Direct inquiries connect straight to our ground desk.
                  </span>
                  <button
                    type="submit"
                    className="inline-flex items-center justify-center px-6 py-3 min-h-[46px] text-sm font-bold text-[#070A14] bg-[#c4d835] hover:bg-[#d4e157] rounded-md transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    Prepare WhatsApp Inquiry
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
