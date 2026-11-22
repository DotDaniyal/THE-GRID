import type {
  AcademyProgram,
  CourtSpec,
  CourtView,
  GalleryItem,
  PricingTier,
} from '@/src/types/venue';
import type { CountryCodeOption } from '@/src/types/booking';

export const SINGLE_COURT: CourtSpec = {
  id: 'the-grid-court',
  courtNumber: 1,
  name: 'THE GRID - Main Futsal Court',
  subtitle: 'Championship Pro Turf Pitch',
  format: '5-a-Side / 6-a-Side Futsal',
  surface: 'Two-Tone Striped Pro Artificial Turf',
  lighting: 'High-Bay Stadium LED Floodlights',
  description:
    'Our championship pitch in Malir Cantonment features shock-absorbing two-tone striped artificial turf, full-perimeter ball-retention netting, stepped team bleachers, and glare-controlled stadium LED floodlighting for day and night fixtures.',
  highlights: [
    'Stepped team and spectator bleachers',
    'Full-perimeter high-tension ball-retention netting',
    'Hourly floodlit slot scheduling in Pakistan Standard Time',
  ],
};

export const COURT_VIEWS: CourtView[] = [
  {
    id: 'daylight',
    label: 'Daylight View',
    image: '/gallery/main-court.jpeg',
    imageAlt:
      'THE GRID championship artificial turf court with stepped bleachers and floodlight towers in Malir Cantt',
    caption: 'Daylight match pitch with stepped bleachers and perimeter netting',
  },
  {
    id: 'floodlit',
    label: 'Floodlit Night',
    image: '/gallery/turf.jpeg',
    imageAlt:
      'Night futsal match under stadium floodlights on THE GRID striped green turf in Karachi',
    caption: 'Evening and late-night sessions under stadium LED floodlights',
  },
  {
    id: 'surface',
    label: 'Turf & Drills',
    image: '/gallery/practice.jpeg',
    imageAlt: 'Player practicing close ball control on THE GRID artificial futsal turf',
    caption: 'High-density striped synthetic turf built for true ball speed',
  },
];

export const PRICING_TIERS: PricingTier[] = [
  {
    window: '04:00 AM - 05:00 PM',
    label: 'Daytime Sessions',
    ratePkr: 1500,
    note: 'Off-peak morning and afternoon hourly rate',
  },
  {
    window: '05:00 PM - 07:00 PM',
    label: 'Twilight Hours',
    ratePkr: 2500,
    note: 'Evening transition and early after-work slots',
  },
  {
    window: '07:00 PM - 02:00 AM',
    label: 'Prime Floodlit Night',
    ratePkr: 4000,
    note: 'Peak night match hours under full stadium lights',
  },
  {
    window: '02:00 AM - 04:00 AM',
    label: 'Late Night Grid',
    ratePkr: 2000,
    note: 'After-midnight floodlit hourly sessions',
  },
];

export const GALLERY_ITEMS: GalleryItem[] = [
  {
    id: 1,
    src: '/gallery/turf.jpeg',
    alt: 'Night futsal match under bright stadium floodlights at THE GRID Karachi',
    title: 'Night Game',
    caption: 'Floodlit evening and late-night matches across two-tone artificial turf.',
  },
  {
    id: 2,
    src: '/gallery/DSC04684.jpg',
    alt: 'Competitive youth futsal match action at THE GRID by FC Rovers',
    title: 'Team Action',
    caption: 'High-tempo fixtures, local leagues, and FC Rovers matchdays.',
  },
  {
    id: 3,
    src: '/gallery/main-court.jpeg',
    alt: 'Main Court view showing striped turf and painted team bleachers at THE GRID',
    title: 'Main Court',
    caption: 'Dedicated floodlit court with stepped bleachers and full-perimeter netting.',
  },
  {
    id: 4,
    src: '/gallery/practice.jpeg',
    alt: 'Player training ball skills on THE GRID turf pitch',
    title: 'The Grid Scnz',
    caption: 'Individual technical drills, first-touch sessions, and open squad runs.',
  },
  {
    id: 5,
    src: '/gallery/academy.jpeg',
    alt: 'FC Rovers and Karachi United leadership partnership at THE GRID',
    title: 'Academy Setup',
    caption: 'Sporting partnership uniting FC Rovers Malir Cantt and Karachi United.',
  },
];

export const ACADEMY_PROGRAMS: AcademyProgram[] = [
  {
    title: 'Kids Academy',
    ages: 'Ages 6-12',
    schedule: '2 sessions / week · 1 hr each',
    description: 'Fun-based ball mastery, coordination, and team fundamentals.',
  },
  {
    title: 'Youth Development',
    ages: 'Ages 13-17',
    schedule: '3 sessions / week · 1.5 hrs each',
    description: 'Technical progression, tactical awareness, and competitive play.',
  },
  {
    title: 'Adult Training',
    ages: 'Ages 18+',
    schedule: '2-3 sessions / week · 2 hrs each',
    description: 'Match fitness, sharp execution, and structured squad preparation.',
  },
  {
    title: 'Elite Program',
    ages: 'Advanced',
    schedule: 'Daily training · 2-3 hrs each',
    description: 'High-performance pathway built for competitive league athletes.',
  },
];

export const COUNTRY_CODES: CountryCodeOption[] = [
  { code: '+92', label: 'Pakistan (+92)', placeholder: '300 1234567' },
  { code: '+971', label: 'UAE (+971)', placeholder: '50 1234567' },
  { code: '+966', label: 'Saudi Arabia (+966)', placeholder: '50 1234567' },
  { code: '+44', label: 'United Kingdom (+44)', placeholder: '7700 900077' },
  { code: '+1', label: 'USA / Canada (+1)', placeholder: '202 555 0143' },
  { code: '+61', label: 'Australia (+61)', placeholder: '412 345 678' },
];
