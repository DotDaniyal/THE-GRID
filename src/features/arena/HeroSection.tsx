import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowDown, ArrowRight } from 'lucide-react';
import heroArenaImg from '@/src/assets/images/hero_futsal_arena_1795364505927.jpg';
import { BRAND } from '@/src/config/brand';
import {
  InteractiveFootballCanvas,
  type IntroPhase,
} from '@/src/features/arena/InteractiveFootballCanvas';

interface HeroSectionProps {
  onBookNow: () => void;
  onIntroComplete: () => void;
}

let introPlayedThisLoad = false;

function isReducedMotionPreferred(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function HeroSection({ onBookNow, onIntroComplete }: HeroSectionProps) {
  const motionHookReduced = Boolean(useReducedMotion());
  const [mediaReducedMotion, setMediaReducedMotion] = useState<boolean>(() =>
    isReducedMotionPreferred()
  );
  const prefersReducedMotion = motionHookReduced || mediaReducedMotion;

  const containerRef = useRef<HTMLElement | null>(null);
  const logoZoneRef = useRef<HTMLDivElement | null>(null);
  const onIntroCompleteRef = useRef(onIntroComplete);
  onIntroCompleteRef.current = onIntroComplete;
  const timersRef = useRef<number[]>([]);
  const [skippedInstant, setSkippedInstant] = useState(false);

  const [introPhase, setIntroPhase] = useState<IntroPhase>(() => {
    if (typeof window === 'undefined') return 'ready';
    return isReducedMotionPreferred() || introPlayedThisLoad ? 'ready' : 'dark';
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (event: MediaQueryListEvent) => {
      setMediaReducedMotion(event.matches);
    };
    setMediaReducedMotion(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  const clearAllTimers = useCallback(() => {
    for (const id of timersRef.current) {
      window.clearTimeout(id);
    }
    timersRef.current = [];
  }, []);

  const completeIntroImmediately = useCallback(
    (instant = false) => {
      clearAllTimers();
      introPlayedThisLoad = true;
      if (instant) {
        setSkippedInstant(true);
      }
      setIntroPhase('ready');
      onIntroCompleteRef.current();
    },
    [clearAllTimers]
  );

  useEffect(() => {
    if (prefersReducedMotion || introPlayedThisLoad) {
      completeIntroImmediately(true);
      return;
    }

    timersRef.current = [
      window.setTimeout(() => setIntroPhase('lights'), 160),
      window.setTimeout(() => setIntroPhase('ball'), 480),
      window.setTimeout(() => setIntroPhase('logo'), 820),
      window.setTimeout(() => {
        introPlayedThisLoad = true;
        setIntroPhase('ready');
        onIntroCompleteRef.current();
      }, 1550),
    ];

    return clearAllTimers;
  }, [prefersReducedMotion, clearAllTimers, completeIntroImmediately]);

  useEffect(() => {
    if (introPhase === 'ready') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        completeIntroImmediately(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [introPhase, completeIntroImmediately]);

  const handleSkipIntro = () => {
    completeIntroImmediately(true);
  };

  const lightsOn = introPhase !== 'dark' || prefersReducedMotion;
  const logoVisible = introPhase === 'logo' || introPhase === 'ready' || prefersReducedMotion;
  const uiVisible = introPhase === 'ready' || prefersReducedMotion;
  const instant = prefersReducedMotion || skippedInstant;

  return (
    <section
      id="home"
      ref={containerRef}
      onClick={() => {
        if (introPhase !== 'ready') {
          handleSkipIntro();
        }
      }}
      className="relative min-h-[100svh] w-full overflow-hidden bg-[#070A14] flex items-center justify-center select-none"
    >
      {/* Persistent, immediately visible Skip Intro control (first in focus order during animation) */}
      {introPhase !== 'ready' && !prefersReducedMotion && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleSkipIntro();
          }}
          aria-label="Skip intro animation and show landing page immediately"
          className="fixed bottom-6 right-6 z-50 px-4 py-2.5 min-h-[44px] text-xs font-bold uppercase tracking-wider text-white bg-[#0E1428] hover:bg-[#c4d835] hover:text-[#070A14] border border-[#c4d835]/70 rounded-md shadow-[0_12px_30px_rgba(4,8,24,0.75)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          Skip Intro
        </button>
      )}

      {/* Layer 1: Futsal Arena Photography Backdrop */}
      <div
        className={`absolute inset-0 ${instant ? 'transition-none' : 'transition-opacity duration-700'}`}
        style={{
          opacity: lightsOn ? 1 : 0.18,
        }}
      >
        <img
          src={heroArenaImg}
          alt="THE GRID indoor floodlit futsal arena turf and stadium architecture"
          className="w-full h-full object-cover object-center"
          referrerPolicy="no-referrer"
        />
      </div>

      {/* Layer 2: Atmospheric Stadium Scrim & Volumetric Floodlight Illumination */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-b from-[#070A14]/80 via-[#0A1024]/45 to-[#070A14]"
      />

      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 ${
          instant ? 'transition-none' : 'transition-opacity duration-1000'
        } ${lightsOn ? 'opacity-100' : 'opacity-0'}`}
      >
        <div
          className="absolute -top-24 left-1/2 -translate-x-1/2 w-[min(92vw,900px)] h-[65vh]"
          style={{
            background:
              'radial-gradient(ellipse at center, rgba(63, 81, 181, 0.24) 0%, rgba(196, 216, 53, 0.08) 38%, rgba(7, 10, 20, 0) 72%)',
          }}
        />
      </div>

      {/* Crisp Subtle Center Circle Pitch Marking Behind Logo */}
      <svg
        aria-hidden="true"
        viewBox="0 0 1200 720"
        preserveAspectRatio="xMidYMid slice"
        className={`pointer-events-none absolute inset-0 w-full h-full ${
          instant ? 'transition-none' : 'transition-opacity duration-1000'
        } ${lightsOn ? 'opacity-30' : 'opacity-0'}`}
      >
        <line x1="600" y1="0" x2="600" y2="720" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" />
        <circle cx="600" cy="360" r="148" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1.5" />
        <circle cx="600" cy="360" r="185" fill="none" stroke="rgba(196,216,53,0.18)" strokeWidth="1" strokeDasharray="6 8" />
      </svg>

      {/* Layer 3: Exact Center Logo, Headline & Primary CTAs (always accessible & focusable) */}
      <div className="relative z-10 w-full max-w-4xl mx-auto px-6 flex flex-col items-center justify-center text-center pointer-events-none">
        <motion.div
          ref={logoZoneRef}
          initial={instant ? false : { opacity: 0, scale: 0.9, y: 12 }}
          animate={
            logoVisible
              ? { opacity: 1, scale: 1, y: 0 }
              : { opacity: 0.15, scale: 0.96, y: 8 }
          }
          transition={instant ? { duration: 0 } : { duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col items-center"
        >
          <div className="relative mb-5 sm:mb-6">
            <div
              aria-hidden="true"
              className="absolute -inset-4 rounded-3xl blur-2xl opacity-55"
              style={{
                background:
                  'radial-gradient(circle, rgba(196, 216, 53, 0.35) 0%, rgba(44, 56, 126, 0.45) 55%, transparent 75%)',
              }}
            />
            <div className="relative w-32 h-32 sm:w-40 sm:h-40 md:w-44 md:h-44 rounded-2xl overflow-hidden border border-[#c4d835]/35 shadow-[0_24px_60px_rgba(7,10,20,0.85)] bg-[#22308F]">
              <img
                src={BRAND.logoUrl}
                alt="THE GRID by FC Rovers Official Logo - Game. Set. Grid."
                className="w-full h-full object-contain"
                referrerPolicy="no-referrer"
              />
            </div>
          </div>

          <h1 className="font-display font-extrabold uppercase tracking-[0.06em] text-white text-[clamp(2.75rem,6vw,4.75rem)] leading-[0.95] drop-shadow-[0_6px_28px_rgba(0,0,0,0.65)]">
            {BRAND.name}
          </h1>

          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs sm:text-sm tracking-[0.16em] uppercase text-slate-200/90">
            <span className="font-semibold text-[#c4d835]">{BRAND.subName}</span>
            <span aria-hidden="true" className="text-slate-400">
              ·
            </span>
            <span>{BRAND.tagline}</span>
          </div>

          <p className="mt-3 max-w-lg text-sm sm:text-base text-slate-300/90 leading-relaxed text-balance">
            Floodlit pro-turf futsal court in Malir Cantonment, Karachi.
          </p>
        </motion.div>

        <motion.div
          onFocusCapture={() => {
            if (introPhase !== 'ready') {
              handleSkipIntro();
            }
          }}
          initial={instant ? false : { opacity: 0.7, y: 8 }}
          animate={uiVisible ? { opacity: 1, y: 0 } : { opacity: 0.85, y: 4 }}
          transition={instant ? { duration: 0 } : { duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="mt-7 flex flex-wrap items-center justify-center gap-4 pointer-events-auto"
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleSkipIntro();
              onBookNow();
            }}
            className="inline-flex items-center gap-2.5 px-7 py-3.5 min-h-[48px] text-sm sm:text-base font-bold text-[#070A14] bg-[#c4d835] hover:bg-[#d4e157] active:scale-[0.98] rounded-md shadow-[0_12px_32px_rgba(196,216,53,0.28)] transition-all duration-150 whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#070A14]"
          >
            <span>Book Your Court</span>
            <ArrowRight className="w-4 h-4" />
          </button>

          <a
            href="#explore"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleSkipIntro();
              document
                .querySelector('#explore')
                ?.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth' });
            }}
            className="inline-flex items-center gap-2 px-6 py-3.5 min-h-[48px] text-sm sm:text-base font-medium text-white bg-white/5 hover:bg-white/10 border border-white/15 rounded-md transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4d835]"
          >
            <span>Explore Arena</span>
            <ArrowDown className="w-4 h-4 text-[#c4d835]" />
          </a>
        </motion.div>
      </div>

      {/* Layer 4: Interactive Drag & Flick Physics Football */}
      <InteractiveFootballCanvas
        containerRef={containerRef}
        logoZoneRef={logoZoneRef}
        introPhase={introPhase}
        reducedMotion={prefersReducedMotion}
      />
    </section>
  );
}
