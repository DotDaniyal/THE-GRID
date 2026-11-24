import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  parseRoute,
  syncDocumentRouteMeta,
  type AppRoute,
} from '@/src/app/routes';
import { Navbar } from '@/src/components/layout/Navbar';
import { useBookingSelection } from '@/src/hooks/useBookingSelection';
import { HomePage } from '@/src/pages/HomePage';
import { getKarachiTodayStr } from '@/src/utils/date';

const BookingSlotPage = lazy(() =>
  import('@/src/pages/BookingSlotPage').then((m) => ({ default: m.BookingSlotPage }))
);
const BookingDetailsPage = lazy(() =>
  import('@/src/pages/BookingDetailsPage').then((m) => ({ default: m.BookingDetailsPage }))
);
const AdminPage = lazy(() =>
  import('@/src/pages/AdminPage').then((m) => ({ default: m.AdminPage }))
);

function RouteLoadingShell() {
  return (
    <div className="min-h-screen pt-28 bg-[#0C153B] flex items-center justify-center text-sm text-slate-300">
      Loading...
    </div>
  );
}

export default function App() {
  const [currentPath, setCurrentPath] = useState<AppRoute>(() =>
    typeof window !== 'undefined' ? parseRoute(window.location.pathname) : '/'
  );

  const karachiToday = useMemo(() => getKarachiTodayStr(), []);
  const { bookingSelection, updateBookingSelection } = useBookingSelection();

  useEffect(() => {
    const onPopState = () => {
      setCurrentPath(parseRoute(window.location.pathname));
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

    if (hash) {
      window.requestAnimationFrame(() => {
        window.setTimeout(() => {
          const el = document.querySelector(hash);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 50);
      });
    } else {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }, []);

  const handleBookNow = useCallback(() => {
    navigate('/booking');
  }, [navigate]);

  return (
    <div className="min-h-screen bg-[#070A14] text-[#F4F6FA] overflow-x-clip">
      <Navbar currentPath={currentPath} onNavigate={navigate} onBookNow={handleBookNow} />

      {currentPath === '/' && (
        <HomePage
          onBookNow={handleBookNow}
          onNavigateAdmin={() => navigate('/admin')}
        />
      )}

      {currentPath === '/booking' && (
        <main>
          <Suspense fallback={<RouteLoadingShell />}>
            <BookingSlotPage
              karachiToday={karachiToday}
              selection={bookingSelection}
              onSelectionChange={updateBookingSelection}
              onContinueToDetails={() => navigate('/booking/details')}
            />
          </Suspense>
        </main>
      )}

      {currentPath === '/booking/details' && (
        <main>
          <Suspense fallback={<RouteLoadingShell />}>
            <BookingDetailsPage
              selection={bookingSelection}
              onBackToSlots={() => navigate('/booking')}
              onBookingSubmitted={() => updateBookingSelection(null)}
            />
          </Suspense>
        </main>
      )}

      {currentPath === '/admin' && (
        <main>
          <Suspense fallback={<RouteLoadingShell />}>
            <AdminPage />
          </Suspense>
        </main>
      )}
    </div>
  );
}
