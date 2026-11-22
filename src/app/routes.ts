export type AppRoute = '/' | '/booking' | '/booking/details' | '/admin';

export interface RouteMeta {
  title: string;
  description: string;
  canonicalPath: string;
}

export function parseRoute(pathname: string): AppRoute {
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (clean === '/booking') return '/booking';
  if (clean === '/booking/details') return '/booking/details';
  if (clean === '/admin') return '/admin';
  return '/';
}

export const ROUTE_META: Record<AppRoute, RouteMeta> = {
  '/': {
    title: 'THE GRID | Premier Futsal Arena in Malir Cantt, Karachi',
    description:
      'Experience THE GRID by FC Rovers in Malir Cantonment, Karachi. Floodlit pro-turf futsal court, coaching academy, and seamless court booking.',
    canonicalPath: '/',
  },
  '/booking': {
    title: 'Book Court | Select Date & Time Slot | THE GRID',
    description:
      'Check live hourly slot availability and PKR rates for THE GRID Main Futsal Court in Malir Cantonment, Karachi.',
    canonicalPath: '/booking',
  },
  '/booking/details': {
    title: 'Booking Details | Submit Court Request | THE GRID',
    description:
      'Complete your player details and submit your court reservation request for THE GRID in Malir Cantonment, Karachi.',
    canonicalPath: '/booking/details',
  },
  '/admin': {
    title: 'Admin Booking Desk | THE GRID',
    description: 'Authorized booking request management desk for THE GRID.',
    canonicalPath: '/admin',
  },
};

export function syncDocumentRouteMeta(path: AppRoute): void {
  const meta = ROUTE_META[path];
  document.title = meta.title;

  const descEl = document.querySelector('meta[name="description"]');
  if (descEl) descEl.setAttribute('content', meta.description);

  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) ogTitle.setAttribute('content', meta.title);

  const ogDesc = document.querySelector('meta[property="og:description"]');
  if (ogDesc) ogDesc.setAttribute('content', meta.description);

  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) {
    canonical.setAttribute('href', `${window.location.origin}${meta.canonicalPath}`);
  }
}
