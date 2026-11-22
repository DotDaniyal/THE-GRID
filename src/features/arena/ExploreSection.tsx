import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { LOCATION } from '@/src/config/brand';

const METRICS = [
  {
    value: '01',
    label: 'Championship Court',
    detail: '5v5 / 6v6 Pro Futsal Court',
  },
  {
    value: '60 Min',
    label: 'Hourly Slot Blocks',
    detail: 'Daylight & floodlit schedule',
  },
  {
    value: '2003',
    label: 'FC Rovers Heritage',
    detail: 'Registered with DFA Malir in 2007',
  },
  {
    value: 'PKR 1,500',
    label: 'Starting Hourly Rate',
    detail: 'Up to PKR 4,000 prime night slots',
  },
] as const;

export function ExploreSection() {
  const [imgError, setImgError] = useState(false);

  return (
    <section id="explore" className="relative bg-[#070A14] py-20 sm:py-28 border-t border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div id="about" className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
          <div className="lg:col-span-6 flex flex-col justify-between space-y-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#c4d835]">
                01. Explore THE GRID
              </p>
              <h2 className="mt-3 font-display font-bold uppercase tracking-tight text-white text-[clamp(2.25rem,4vw,3.5rem)] leading-[1.02] text-balance">
                Built for Karachi&apos;s Fastest Footwork
              </h2>
              <p className="mt-5 text-base sm:text-lg text-slate-300 leading-relaxed">
                THE GRID is Karachi&apos;s destination for competitive futsal and football
                culture in {LOCATION.district}. Designed around two-tone striped artificial
                turf, high-bay stadium floodlighting, and clean matchday amenities, our court is
                built to deliver true ball speed and reliable footing from afternoon kickoffs
                through late-night fixtures.
              </p>
            </div>

            <div className="pt-7 border-t border-white/10 space-y-3">
              <div className="flex items-center gap-2.5 text-sm font-semibold text-white">
                <ShieldCheck className="w-4 h-4 text-[#c4d835] shrink-0" aria-hidden="true" />
                <span>Sporting Partner: FC Rovers Karachi Malir Cantt</span>
              </div>
              <p className="text-sm text-slate-400 leading-relaxed">
                Founded in 2003 and officially registered with the District Football Association
                (DFA) Malir in 2007, FC Rovers anchors THE GRID&apos;s coaching culture, creating
                structured pathways for youth development, local leagues, and community tournaments
                alongside partner initiatives with Karachi United.
              </p>
              <div className="pt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                <span>5v5 &amp; 6v6 Futsal</span>
                <span aria-hidden="true">·</span>
                <span>Floodlit Turf Pitch</span>
                <span aria-hidden="true">·</span>
                <span>FC Rovers Academy</span>
              </div>
            </div>
          </div>

          <div className="lg:col-span-6">
            <div className="relative h-full min-h-[320px] lg:min-h-[460px] rounded-xl overflow-hidden border border-white/10 bg-[#0E1428]">
              {!imgError ? (
                <img
                  src="/gallery/main-court.jpeg"
                  alt="THE GRID Main Court two-tone striped turf and stepped bleachers in Malir Cantonment, Karachi"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onError={() => setImgError(true)}
                  className="w-full h-full lg:h-full object-cover object-center"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center bg-gradient-to-br from-[#131B3A] to-[#070A14]">
                  <span className="font-display text-2xl font-bold text-[#c4d835]">THE GRID</span>
                  <span className="mt-1 text-sm text-slate-300">Main Court · Malir Cantonment</span>
                </div>
              )}
              <div
                aria-hidden="true"
                className="absolute inset-0 bg-gradient-to-t from-[#070A14]/85 via-[#070A14]/15 to-transparent"
              />
              <div className="absolute bottom-0 inset-x-0 p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#c4d835]">
                  Main Court · Malir Cantonment
                </p>
                <p className="mt-1 text-sm text-slate-200">
                  Stepped team bleachers, full-perimeter netting, and striped pro turf.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-14 pt-10 border-t border-white/10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {METRICS.map((item) => (
            <div key={item.label} className="space-y-1.5">
              <div className="font-mono-tabular text-2xl sm:text-3xl font-semibold text-white">
                {item.value}
              </div>
              <div className="text-sm font-semibold text-[#c4d835]">{item.label}</div>
              <div className="text-xs text-slate-400">{item.detail}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
