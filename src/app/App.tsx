import { useState, useCallback, useEffect, useMemo } from 'react';
import { MotionConfig } from 'motion/react';
import {
  parseRoute,
  syncDocumentRouteMeta,
  type AppRoute,
} from '@/src/app/routes';
import { Navbar } from '@/src/components/layout/Navbar';
import { useBookingSelection } from '@/src/hooks/useBookingSelection';
import { AdminPage } from '@/src/pages/AdminPage';
import { BookingDetailsPage } from '@/src/pages/BookingDetailsPage';
import { BookingSlotPage } from '@/src/pages/BookingSlotPage';
import { HomePage } from '@/src/pages/HomePage';
import { getKarachiTodayStr } from '@/src/utils/date';

function prefersReducedMotionSync(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function hasSeenIntroInSession(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.sessionStorage.getItem('thegrid_intro_seen') === '1';
  } catch {
    return false;
  }
}

export default function App() {
  const [currentPath, setCurrentPath] = useState<AppRoute>(() =>
    typeof window !== 'undefined' ? parseRoute(window.location.pathname) : '/'
  );
  const [navVisible, setNavVisible] = useState(
    () => currentPath !== '/' || prefersReducedMotionSync() || hasSeenIntroInSession()
  );

  const karachiToday = useMemo(() => getKarachiTodayStr(), []);
  const { bookingSelection, updateBookingSelection } = useBookingSelection();

  useEffect(() => {
    const onPopState = () => {
      const next = parseRoute(window.location.pathname);
      setCurrentPath(next);
      if (next !== '/' || prefersReducedMotionSync() || hasSeenIntroInSession()) {
        setNavVisible(true);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    syncDocumentRouteMeta(currentPath);
  }, [currentPath]);

  const navigate = useCallback((path: AppRoute, hash?: string) => {
    const targetUrl = hash ? `${path}${hash}` : path;
    if (window.location.pathname !== path || hash) {
      window.history.pushState({}, '', targetUrl);
    }
    setCurrentPath(path);
    if (path !== '/' || prefersReducedMotionSync() || hasSeenIntroInSession()) {
      setNavVisible(true);
    }

    const scrollBehavior: ScrollBehavior = prefersReducedMotionSync() ? 'auto' : 'smooth';

    if (hash) {
      window.requestAnimationFrame(() => {
        window.setTimeout(() => {
          const el = document.querySelector(hash);
          if (el) {
            el.scrollIntoView({ behavior: scrollBehavior, block: 'start' });
          }
        }, 60);
      });
    } else {
      window.scrollTo({ top: 0, behavior: scrollBehavior });
    }
  }, []);

  const handleIntroStart = useCallback(() => {
    setNavVisible(false);
  }, []);

  const handleIntroComplete = useCallback(() => {
    setNavVisible(true);
  }, []);

  const handleBookNow = useCallback(() => {
    setNavVisible(true);
    navigate('/booking');
  }, [navigate]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-[#070A14] text-[#F4F6FA] overflow-x-clip">
        <Navbar
          currentPath={currentPath}
          onNavigate={navigate}
          onBookNow={handleBookNow}
          visible={navVisible}
          onFocusReveal={handleIntroComplete}
        />

        {currentPath === '/' && (
          <HomePage
            onBookNow={handleBookNow}
            onIntroStart={handleIntroStart}
            onIntroComplete={handleIntroComplete}
            onNavigateAdmin={() => navigate('/admin')}
          />
        )}

        {currentPath === '/booking' && (
          <main>
            <BookingSlotPage
              karachiToday={karachiToday}
              selection={bookingSelection}
              onSelectionChange={updateBookingSelection}
              onContinueToDetails={() => navigate('/booking/details')}
            />
          </main>
        )}

        {currentPath === '/booking/details' && (
          <main>
            <BookingDetailsPage
              selection={bookingSelection}
              onBackToSlots={() => navigate('/booking')}
              onBookingSubmitted={() => updateBookingSelection(null)}
            />
          </main>
        )}

        {currentPath === '/admin' && (
          <main>
            <AdminPage />
          </main>
        )}
      </div>
    </MotionConfig>
  );
}
