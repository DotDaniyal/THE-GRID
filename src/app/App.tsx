import { Component, type ErrorInfo, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
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

interface ErrorBoundaryState {
  hasError: boolean;
}

class RouteErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Route render error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen pt-28 pb-20 bg-[#0C153B] flex items-center justify-center px-4">
          <div className="max-w-md w-full rounded-xl border border-white/15 bg-[#121D52] p-6 text-center space-y-4">
            <h1 className="font-display text-2xl font-bold uppercase text-white">
              Unable to Open Page
            </h1>
            <p className="text-xs text-slate-300">
              A temporary loading error occurred. Reload the page to continue.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-[#0E1845] bg-[#c4d835] hover:bg-[#d4e157] rounded-md cursor-pointer"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
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

      <RouteErrorBoundary>
        {currentPath === '/' && (
          <HomePage
            onBookNow={handleBookNow}
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
      </RouteErrorBoundary>
    </div>
  );
}
