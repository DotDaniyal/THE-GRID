import { useState } from 'react';
import { ArrowRight, Check, MapPin } from 'lucide-react';
import { LOCATION } from '@/src/config/brand';
import { COURT_VIEWS, PRICING_TIERS, SINGLE_COURT } from '@/src/config/venue';

interface GroundsSectionProps {
  onBookNow: () => void;
}

export function GroundsSection({ onBookNow }: GroundsSectionProps) {
  const [activeViewId, setActiveViewId] = useState(COURT_VIEWS[0].id);
  const [imgErrorMap, setImgErrorMap] = useState<Record<string, boolean>>({});

  const activeView = COURT_VIEWS.find((v) => v.id === activeViewId) ?? COURT_VIEWS[0];

  return (
    <section id="grounds" className="relative bg-[#0B1020] py-20 sm:py-28 border-t border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#c4d835]">
              02. Our Football Ground
            </p>
            <h2 className="mt-3 font-display font-bold uppercase tracking-tight text-white text-[clamp(2.25rem,4vw,3.5rem)] leading-[1.02] text-balance">
              One Court, Championship Standard
            </h2>
          </div>

          <div
            role="tablist"
            aria-label="Switch court photo view"
            className="inline-flex flex-wrap items-center gap-1.5 p-1.5 rounded-lg bg-[#070A14] border border-white/10"
          >
            {COURT_VIEWS.map((view) => {
              const selected = view.id === activeView.id;
              return (
                <button
                  key={view.id}
                  role="tab"
                  type="button"
                  aria-selected={selected}
                  onClick={() => setActiveViewId(view.id)}
                  className={`px-4 py-2 min-h-[40px] text-xs sm:text-sm font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4d835] ${
                    selected
                      ? 'bg-[#c4d835] text-[#070A14]'
                      : 'text-slate-300 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {view.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          <div className="lg:col-span-7 relative min-h-[300px] sm:min-h-[380px] rounded-xl overflow-hidden border border-white/10 bg-[#070A14]">
            {!imgErrorMap[activeView.id] ? (
              <img
                src={activeView.image}
                alt={activeView.imageAlt}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                onError={() =>
                  setImgErrorMap((prev) => ({ ...prev, [activeView.id]: true }))
                }
                className="w-full h-full lg:h-full object-cover object-center"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center bg-gradient-to-br from-[#131B3A] to-[#070A14]">
                <span className="font-display text-2xl font-bold text-[#c4d835]">
                  {SINGLE_COURT.name}
                </span>
                <span className="mt-1 text-sm text-slate-300">{SINGLE_COURT.surface}</span>
              </div>
            )}
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-gradient-to-t from-[#070A14]/85 via-transparent to-transparent"
            />
            <div className="absolute bottom-0 inset-x-0 p-6 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#c4d835]">
                  {SINGLE_COURT.subtitle}
                </p>
                <h3 className="mt-1 font-display text-2xl sm:text-3xl font-bold uppercase text-white">
                  {SINGLE_COURT.name}
                </h3>
                <p className="mt-1 text-xs text-slate-300">{activeView.caption}</p>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-200">
                <MapPin className="w-3.5 h-3.5 text-[#c4d835]" aria-hidden="true" />
                <span>{LOCATION.district}, Karachi</span>
              </div>
            </div>
          </div>

          <div className="lg:col-span-5 rounded-xl border border-white/10 bg-[#0E1428] p-6 sm:p-8 flex flex-col justify-between space-y-6">
            <div className="space-y-5">
              <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
                {SINGLE_COURT.description}
              </p>

              <dl className="pt-4 border-t border-white/10 space-y-3 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-400">Match Format</dt>
                  <dd className="text-right font-medium text-white">{SINGLE_COURT.format}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-400">Playing Surface</dt>
                  <dd className="text-right font-medium text-white">{SINGLE_COURT.surface}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-400">Lighting</dt>
                  <dd className="text-right font-medium text-white">{SINGLE_COURT.lighting}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-400">Location</dt>
                  <dd className="text-right font-medium text-white">
                    {LOCATION.street}, {LOCATION.district}
                  </dd>
                </div>
              </dl>

              <ul className="pt-4 border-t border-white/10 space-y-2.5">
                {SINGLE_COURT.highlights.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-slate-200">
                    <Check className="w-4 h-4 text-[#c4d835] shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <button
              type="button"
              onClick={onBookNow}
              className="w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 min-h-[48px] text-sm font-bold text-[#070A14] bg-[#c4d835] hover:bg-[#d4e157] active:scale-[0.99] rounded-md transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <span>Book Your Court</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="mt-14 rounded-xl border border-white/10 bg-[#070A14] p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-white/10">
            <div>
              <h3 className="font-display text-2xl font-bold uppercase text-white">
                Hourly Slot Rates (PKR)
              </h3>
              <p className="mt-1 text-sm text-slate-400">
                Standard 60-minute hourly pricing for THE GRID Futsal Court.
              </p>
            </div>
            <button
              type="button"
              onClick={onBookNow}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 min-h-[44px] text-sm font-semibold text-[#c4d835] border border-[#c4d835]/40 hover:bg-[#c4d835] hover:text-[#070A14] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4d835]"
            >
              <span>Reserve a Slot</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {PRICING_TIERS.map((tier) => (
              <div
                key={tier.window}
                className="p-5 rounded-lg bg-[#0E1428] border border-white/10 flex flex-col justify-between"
              >
                <div>
                  <div className="font-mono-tabular text-xs text-[#c4d835]">{tier.window}</div>
                  <div className="mt-1.5 text-base font-semibold text-white">{tier.label}</div>
                  <p className="mt-1 text-xs text-slate-400 leading-relaxed">{tier.note}</p>
                </div>
                <div className="mt-5 pt-4 border-t border-white/10 flex items-baseline justify-between">
                  <span className="font-mono-tabular text-2xl font-semibold text-white">
                    PKR {tier.ratePkr.toLocaleString()}
                  </span>
                  <span className="text-xs text-slate-400">/ hour</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
