import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowDown, ArrowRight, RotateCcw } from 'lucide-react';
import heroArenaImg from '@/src/assets/images/hero_futsal_arena_1795364505927.jpg';
import { BRAND } from '@/src/config/brand';
import {
  CinematicStadiumIntro,
  type CinematicIntroPhase,
} from '@/src/features/arena/intro3d/CinematicStadiumIntro';

interface HeroSectionProps {
  onBookNow: () => void;
  onIntroStart?: () => void;
  onIntroComplete: () => void;
}

const SESSION_INTRO_KEY = 'thegrid_intro_seen';

function isReducedMotionPreferred(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function getInitialIntroActive(): boolean {
  if (typeof window === 'undefined') return false;
  if (isReducedMotionPreferred()) return false;
  try {
    return window.sessionStorage.getItem(SESSION_INTRO_KEY) !== '1';
  } catch {
    return true;
  }
}

function markIntroSeenInSession(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SESSION_INTRO_KEY, '1');
  } catch {
    // Ignore private browsing storage restrictions
  }
}

export function HeroSection({
  onBookNow,
  onIntroStart,
  onIntroComplete,
}: HeroSectionProps) {
  const motionHookReduced = Boolean(useReducedMotion());
  const [mediaReducedMotion, setMediaReducedMotion] = useState<boolean>(() =>
    isReducedMotionPreferred()
  );
  const prefersReducedMotion = motionHookReduced || mediaReducedMotion;

  const [introActive, setIntroActive] = useState<boolean>(() => getInitialIntroActive());
  const [introPhase, setIntroPhase] = useState<CinematicIntroPhase>(() =>
    getInitialIntroActive() ? 'dark' : 'ready'
  );
  const [domHeroBlend, setDomHeroBlend] = useState<number>(() =>
    getInitialIntroActive() ? 0 : 1
  );
  const [replayNonce, setReplayNonce] = useState(0);
  const [audioEnabled, setAudioEnabled] = useState(false);

  const onIntroStartRef = useRef(onIntroStart);
  onIntroStartRef.current = onIntroStart;
  const onIntroCompleteRef = useRef(onIntroComplete);
  onIntroCompleteRef.current = onIntroComplete;

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

  const finishIntro = useCallback(() => {
    markIntroSeenInSession();
    setIntroActive(false);
    setIntroPhase('ready');
    setDomHeroBlend(1);
    onIntroCompleteRef.current();
  }, []);

  // Ensure users with reduced-motion or repeat visits unlock Navbar immediately
  useEffect(() => {
    if (prefersReducedMotion || !introActive) {
      finishIntro();
    }
  }, [prefersReducedMotion, introActive, finishIntro]);

  // Allow Escape key to skip intro cleanly at any moment
  useEffect(() => {
    if (!introActive || introPhase === 'ready' || prefersReducedMotion) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        finishIntro();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [introActive, introPhase, prefersReducedMotion, finishIntro]);

  const handleReplayIntro = useCallback(() => {
    if (prefersReducedMotion) return;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setIntroActive(true);
    setIntroPhase('dark');
    setDomHeroBlend(0);
    setReplayNonce((n) => n + 1);
    onIntroStartRef.current?.();
  }, [prefersReducedMotion]);

  const isHeroInteractive = !introActive || introPhase === 'ready' || domHeroBlend > 0.65 || prefersReducedMotion;

  return (
    <section
      id="home"
      className="relative min-h-[100svh] w-full overflow-hidden bg-[#070A14] flex items-center justify-center select-none"
    >
      {/* Fallback Stadium Backdrop (used for reduced motion or non-WebGL devices) */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ opacity: prefersReducedMotion ? 1 : 0 }}
      >
        <img
          src={heroArenaImg}
          alt="THE GRID indoor floodlit futsal arena turf and stadium architecture"
          className="w-full h-full object-cover object-center"
          referrerPolicy="no-referrer"
        />
      </div>

      {/* Live 3D Floodlit Futsal Stadium & 8-Scene Cinematic Director */}
      {!prefersReducedMotion && (
        <CinematicStadiumIntro
          active={introActive}
          replayNonce={replayNonce}
          reducedMotion={prefersReducedMotion}
          audioEnabled={audioEnabled}
          onToggleAudio={setAudioEnabled}
          onPhaseChange={setIntroPhase}
          onDomHeroBlendChange={setDomHeroBlend}
          onComplete={finishIntro}
          onSkip={finishIntro}
        />
      )}

      {/* Atmospheric Vignette Scrim (scales smoothly so dark scenes & pitch highlights pop) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[6] transition-opacity duration-700 motion-reduce:transition-none"
        style={{
          opacity: isHeroInteractive ? 0.92 : 0.25,
          background:
            'radial-gradient(circle at 50% 44%, rgba(7,10,20,0.28) 0%, rgba(7,10,20,0.68) 62%, rgba(7,10,20,0.94) 100%)',
        }}
      />

      {/* Exact Center Official Logo, Headline & Primary CTAs (cross-dissolves in Scene 07 -> 08) */}
      <div
        className={`relative z-20 w-full max-w-4xl mx-auto px-6 flex flex-col items-center justify-center text-center transition-all duration-500 motion-reduce:transition-none ${
          isHeroInteractive ? 'pointer-events-auto' : 'pointer-events-none'
        }`}
        style={{
          opacity: prefersReducedMotion ? 1 : domHeroBlend,
          transform: prefersReducedMotion
            ? 'none'
            : `translateY(${((1 - domHeroBlend) * 14).toFixed(1)}px) scale(${(
                0.96 +
                domHeroBlend * 0.04
              ).toFixed(3)})`,
        }}
      >
        <motion.div
          initial={false}
          className="flex flex-col items-center"
        >
          <div className="relative mb-5 sm:mb-6">
            <div
              aria-hidden="true"
              className="absolute -inset-5 rounded-3xl opacity-60 pointer-events-none"
              style={{
                background:
                  'radial-gradient(circle, rgba(196, 216, 53, 0.34) 0%, rgba(34, 48, 143, 0.48) 55%, transparent 74%)',
              }}
            />
            <div className="relative w-32 h-32 sm:w-40 sm:h-40 md:w-44 md:h-44 rounded-2xl overflow-hidden border border-[#c4d835]/40 shadow-[0_24px_60px_rgba(7,10,20,0.88)] bg-[#22308F]">
              <img
                src={BRAND.logoUrl}
                alt="THE GRID by FC Rovers Official Logo - Game. Set. Grid."
                className="w-full h-full object-contain"
                referrerPolicy="no-referrer"
              />
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
        </motion.div>

        <div
          onFocusCapture={() => {
            if (!isHeroInteractive) {
              finishIntro();
            }
          }}
          className="mt-7 flex flex-wrap items-center justify-center gap-3.5 sm:gap-4"
        >
          <button
            type="button"
            tabIndex={isHeroInteractive ? 0 : -1}
            onClick={() => {
              finishIntro();
              onBookNow();
            }}
            className="inline-flex items-center gap-2.5 px-7 py-3.5 min-h-[48px] text-sm sm:text-base font-bold text-[#070A14] bg-[#c4d835] hover:bg-[#d4e157] active:scale-[0.98] rounded-md shadow-[0_12px_32px_rgba(196,216,53,0.3)] transition-all duration-150 whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#070A14]"
          >
            <span>Book Your Court</span>
            <ArrowRight className="w-4 h-4" />
          </button>

          <a
            href="#explore"
            tabIndex={isHeroInteractive ? 0 : -1}
            onClick={(e) => {
              e.preventDefault();
              finishIntro();
              document
                .querySelector('#explore')
                ?.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth' });
            }}
            className="inline-flex items-center gap-2 px-6 py-3.5 min-h-[48px] text-sm sm:text-base font-medium text-white bg-[#0E1428]/85 hover:bg-[#182246] border border-white/20 rounded-md transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4d835]"
          >
            <span>Explore Arena</span>
            <ArrowDown className="w-4 h-4 text-[#c4d835]" />
          </a>
        </div>

        {/* Replay Intro Trigger visible cleanly once homepage hero is active */}
        {!prefersReducedMotion && introPhase === 'ready' && (
          <button
            type="button"
            onClick={handleReplayIntro}
            className="mt-5 inline-flex items-center gap-2 px-4 py-2 min-h-[44px] text-xs font-semibold uppercase tracking-[0.14em] text-slate-300 hover:text-[#c4d835] transition-colors cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4d835]"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Replay 3D Stadium Intro</span>
          </button>
        )}
      </div>
    </section>
  );
}
