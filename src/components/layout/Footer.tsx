import { useState } from 'react';
import { BRAND, CONTACT, LOCATION } from '@/src/config/brand';
import { FacebookIcon, InstagramIcon } from '@/src/components/common/SocialIcons';
import { LegalModal, type LegalDocType } from '@/src/components/modals/LegalModal';

interface FooterProps {
  onBookNow: () => void;
  onNavigateAdmin?: () => void;
}

export function Footer({ onBookNow, onNavigateAdmin }: FooterProps) {
  const [legalDoc, setLegalDoc] = useState<LegalDocType>(null);

  const scrollToSection = (href: string) => {
    const el = document.querySelector(href);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <>
      <footer className="bg-[#05070F] border-t border-white/10 py-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-10 pb-12 border-b border-white/10">
            <div className="md:col-span-5 space-y-4">
              <div className="flex items-center gap-3.5">
                <img
                  src={BRAND.logoUrl}
                  alt="THE GRID Official Logo"
                  className="w-12 h-12 rounded-lg object-contain border border-white/10"
                  referrerPolicy="no-referrer"
                />
                <div>
                  <div className="font-display text-2xl font-extrabold uppercase tracking-wider text-white">
                    {BRAND.name}
                  </div>
                  <div className="text-xs tracking-[0.14em] uppercase text-[#c4d835]">
                    {BRAND.subName} · {BRAND.motto}
                  </div>
                </div>
              </div>
              <p className="text-sm text-slate-400 max-w-sm leading-relaxed">
                {BRAND.tagline}. Karachi&apos;s floodlit futsal and sporting community venue in{' '}
                {LOCATION.district}.
              </p>
            </div>

            <div className="md:col-span-3 space-y-3">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                Navigation
              </div>
              <ul className="space-y-2 text-sm">
                {[
                  { label: 'Home', href: '#home' },
                  { label: 'Explore', href: '#explore' },
                  { label: 'About', href: '#about' },
                  { label: 'Location', href: '#location' },
                  { label: 'Contact', href: '#contact' },
                ].map((link) => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      onClick={(e) => {
                        e.preventDefault();
                        scrollToSection(link.href);
                      }}
                      className="text-slate-300 hover:text-[#c4d835] transition-colors"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    onClick={onBookNow}
                    className="text-[#c4d835] hover:text-[#d4e157] font-semibold transition-colors cursor-pointer"
                  >
                    Book Now
                  </button>
                </li>
              </ul>
            </div>

            <div className="md:col-span-4 space-y-3">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                Venue &amp; Contact
              </div>
              <p className="text-sm text-slate-300 leading-relaxed">{LOCATION.fullAddress}</p>
              <div className="space-y-1 text-sm text-slate-300">
                <div>
                  <a
                    href={CONTACT.whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono-tabular hover:text-[#c4d835] transition-colors"
                  >
                    {CONTACT.phoneDisplay}
                  </a>
                </div>
                <div>
                  <a
                    href={`mailto:${CONTACT.email}`}
                    className="hover:text-[#c4d835] transition-colors"
                  >
                    {CONTACT.email}
                  </a>
                </div>
              </div>
              <div className="pt-2 flex items-center gap-4 text-sm">
                <a
                  href={CONTACT.instagramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Follow THE GRID on Instagram"
                  className="inline-flex items-center gap-1.5 text-slate-300 hover:text-[#c4d835] transition-colors"
                >
                  <InstagramIcon />
                  <span>Instagram</span>
                </a>
                <a
                  href={CONTACT.facebookUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Follow THE GRID on Facebook"
                  className="inline-flex items-center gap-1.5 text-slate-300 hover:text-[#c4d835] transition-colors"
                >
                  <FacebookIcon />
                  <span>Facebook</span>
                </a>
              </div>
            </div>
          </div>

          <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400">
            <div>
              &copy; {new Date().getFullYear()} THE GRID by FC Rovers. All rights reserved.
            </div>
            <div className="flex items-center gap-5">
              <button
                type="button"
                onClick={() => setLegalDoc('privacy')}
                className="hover:text-white transition-colors cursor-pointer py-1"
              >
                Privacy Policy
              </button>
              <button
                type="button"
                onClick={() => setLegalDoc('terms')}
                className="hover:text-white transition-colors cursor-pointer py-1"
              >
                Terms &amp; Conditions
              </button>
              {onNavigateAdmin && (
                <button
                  type="button"
                  onClick={onNavigateAdmin}
                  className="hover:text-[#c4d835] transition-colors cursor-pointer py-1"
                >
                  Admin
                </button>
              )}
            </div>
          </div>
        </div>
      </footer>

      <LegalModal legalDoc={legalDoc} onClose={() => setLegalDoc(null)} />
    </>
  );
}
