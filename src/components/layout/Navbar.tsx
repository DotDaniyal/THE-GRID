import { useState, useEffect } from 'react';
import { Menu, X } from 'lucide-react';
import { BRAND } from '@/src/config/brand';
import type { AppRoute } from '@/src/app/routes';

interface NavbarProps {
  currentPath: AppRoute;
  onNavigate: (path: AppRoute, hash?: string) => void;
  onBookNow: () => void;
}

export function Navbar({
  currentPath,
  onNavigate,
  onBookNow,
}: NavbarProps) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const isBookingRoute = currentPath === '/booking' || currentPath === '/booking/details';

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 36);
    };
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navItems: Array<{ label: string; path: AppRoute; hash?: string; active: boolean }> = [
    { label: 'Home', path: '/', hash: '#home', active: currentPath === '/' },
    { label: 'Book Court', path: '/booking', active: isBookingRoute },
    { label: 'About Us', path: '/', hash: '#about', active: false },
    { label: 'Location', path: '/', hash: '#location', active: false },
    { label: 'Contact Us', path: '/', hash: '#contact', active: false },
  ];

  const handleLinkClick = (path: AppRoute, hash?: string) => {
    setMobileOpen(false);
    onNavigate(path, hash);
  };

  return (
    <header
      className={`fixed top-0 inset-x-0 z-40 transition-colors duration-200 ${
        scrolled || isBookingRoute || currentPath === '/admin'
          ? 'bg-[#0C153B]/95 border-b border-[#c4d835]/20'
          : 'bg-gradient-to-b from-[#070A14]/85 to-transparent border-b border-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            handleLinkClick('/', '#home');
          }}
          className="inline-flex items-center gap-2.5 font-display text-xl sm:text-2xl font-extrabold tracking-wider text-white hover:text-[#c4d835] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4d835] rounded"
        >
          <img
            src={BRAND.faviconUrl}
            alt=""
            aria-hidden="true"
            className="w-6 h-6 rounded object-contain"
          />
          <span>{BRAND.name}</span>
        </a>

        <nav aria-label="Primary Navigation" className="hidden md:flex items-center gap-7">
          {navItems.map((item) => (
            <a
              key={item.label}
              href={item.hash ? `${item.path}${item.hash}` : item.path}
              onClick={(e) => {
                e.preventDefault();
                handleLinkClick(item.path, item.hash);
              }}
              aria-current={item.active ? 'page' : undefined}
              className={`relative py-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4d835] rounded ${
                item.active ? 'text-[#c4d835]' : 'text-slate-200 hover:text-white'
              }`}
            >
              <span>{item.label}</span>
              <span
                className={`absolute left-0 right-0 -bottom-0.5 h-[2px] bg-[#c4d835] transition-transform duration-200 origin-left ${
                  item.active ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100'
                }`}
              />
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => {
              setMobileOpen(false);
              onBookNow();
            }}
            className="hidden sm:inline-flex items-center justify-center px-5 py-2 min-h-[40px] text-sm font-semibold text-[#070A14] bg-[#c4d835] hover:bg-[#d4e157] active:scale-[0.98] rounded-md transition-all duration-150 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#0C153B]"
          >
            {isBookingRoute ? 'Book Court' : 'Book Now'}
          </button>

          <button
            type="button"
            aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((prev) => !prev)}
            className="md:hidden inline-flex items-center justify-center w-11 h-11 rounded-md text-slate-200 hover:text-[#c4d835] hover:bg-white/5 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4d835]"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <nav
          aria-label="Mobile Navigation"
          className="md:hidden bg-[#0C153B] border-b border-white/10 px-4 py-4 space-y-1"
        >
          {navItems.map((item) => (
            <a
              key={item.label}
              href={item.hash ? `${item.path}${item.hash}` : item.path}
              onClick={(e) => {
                e.preventDefault();
                handleLinkClick(item.path, item.hash);
              }}
              className={`flex items-center min-h-[44px] px-3 rounded-md text-base font-medium transition-colors ${
                item.active
                  ? 'text-[#c4d835] bg-white/5'
                  : 'text-slate-200 hover:text-[#c4d835] hover:bg-white/5'
              }`}
            >
              {item.label}
            </a>
          ))}
          <div className="pt-2">
            <button
              type="button"
              onClick={() => {
                setMobileOpen(false);
                onBookNow();
              }}
              className="w-full min-h-[44px] px-5 py-2.5 text-sm font-semibold text-[#070A14] bg-[#c4d835] hover:bg-[#d4e157] rounded-md transition-colors cursor-pointer"
            >
              {isBookingRoute ? 'Book Court' : 'Book Now'}
            </button>
          </div>
        </nav>
      )}
    </header>
  );
}
