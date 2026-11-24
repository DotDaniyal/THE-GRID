import { ArrowDown, ArrowRight } from 'lucide-react';
import { BRAND } from '@/src/config/brand';

interface HeroSectionProps {
  onBookNow: () => void;
}

export function HeroSection({ onBookNow }: HeroSectionProps) {
  return (
    <section
      id="home"
      className="relative min-h-[100svh] w-full overflow-hidden bg-[#070A14] flex items-center justify-center"
    >
      {/* Optimized Floodlit Stadium Backdrop */}
      <div className="absolute inset-0 pointer-events-none">
        <img
          src="/gallery/hero-arena.webp"
          alt="THE GRID indoor floodlit futsal arena turf and stadium architecture"
          width={1376}
          height={768}
          fetchPriority="high"
          decoding="async"
          className="w-full h-full object-cover object-center"
          referrerPolicy="no-referrer"
        />
      </div>

      {/* Atmospheric Vignette Scrim */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[6]"
        style={{
          background:
            'radial-gradient(circle at 50% 44%, rgba(7,10,20,0.42) 0%, rgba(7,10,20,0.74) 64%, rgba(7,10,20,0.95) 100%)',
        }}
      />

      {/* Official Logo, Headline & Primary CTAs rendered immediately */}
      <div className="relative z-20 w-full max-w-4xl mx-auto px-6 flex flex-col items-center justify-center text-center">
        <div className="flex flex-col items-center">
          <div className="relative mb-5 sm:mb-6">
            <div className="relative w-32 h-32 sm:w-40 sm:h-40 md:w-44 md:h-44 rounded-2xl overflow-hidden border border-[#c4d835]/40 shadow-[0_24px_60px_rgba(7,10,20,0.88)] bg-[#22308F]">
              <picture>
                <source srcSet={BRAND.logoWebpUrl} type="image/webp" />
                <img
                  src={BRAND.logoUrl}
                  alt="THE GRID by FC Rovers Official Logo - Game. Set. Grid."
                  width={176}
                  height={176}
                  fetchPriority="high"
                  decoding="async"
                  className="w-full h-full object-contain"
                  referrerPolicy="no-referrer"
                />
              </picture>
            </div>
          </div>

          <h1 className="font-display font-extrabold uppercase tracking-[0.06em] text-white text-[clamp(2.75rem,6vw,4.75rem)] leading-[0.95] drop-shadow-[0_6px_28px_rgba(0,0,0,0.75)]">
            {BRAND.name}
          </h1>

          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs sm:text-sm tracking-[0.16em] uppercase text-slate-200/95">
            <span className="font-semibold text-[#c4d835]">{BRAND.subName}</span>
            <span aria-hidden="true" className="text-slate-400">
              ·
            </span>
            <span>{BRAND.motto}</span>
          </div>

          <p className="mt-3 max-w-lg text-sm sm:text-base text-slate-200/90 leading-relaxed text-balance">
            Floodlit pro-turf futsal court in Malir Cantonment, Karachi.
          </p>
        </div>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-3.5 sm:gap-4">
          <button
            type="button"
            onClick={onBookNow}
            className="inline-flex items-center gap-2.5 px-7 py-3.5 min-h-[48px] text-sm sm:text-base font-bold text-[#070A14] bg-[#c4d835] hover:bg-[#d4e157] active:scale-[0.98] rounded-md shadow-[0_12px_32px_rgba(196,216,53,0.3)] transition-colors duration-150 whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#070A14]"
          >
            <span>Book Your Court</span>
            <ArrowRight className="w-4 h-4" />
          </button>

          <a
            href="#explore"
            onClick={(e) => {
              e.preventDefault();
              document.querySelector('#explore')?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="inline-flex items-center gap-2 px-6 py-3.5 min-h-[48px] text-sm sm:text-base font-medium text-white bg-[#0E1428]/85 hover:bg-[#182246] border border-white/20 rounded-md transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4d835]"
          >
            <span>Explore Arena</span>
            <ArrowDown className="w-4 h-4 text-[#c4d835]" />
          </a>
        </div>
      </div>
    </section>
  );
}
