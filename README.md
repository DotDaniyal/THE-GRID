# THE GRID - Official Futsal Platform

Official web platform and live hourly court booking system for **THE GRID by FC Rovers**, located on Jinnah Avenue near Checkpost 2 (CP 2), Malir Cantonment, Karachi, Pakistan.

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite 8, Tailwind CSS v4, Lucide React, Motion (`motion/react`)
- **Backend**: Express 4, Node.js `v22+` native TypeScript (`node server.ts`), `node:sqlite` (`DatabaseSync` in WAL mode)
- **Testing**: Node built-in `node:test` runner executed via `tsx`

## Project Architecture

```text
/
├── index.html                          # SEO metadata, OpenGraph, SportsActivityLocation JSON-LD
├── server.ts                           # Express entry point, security headers, API routers, Vite/SPA hosting
├── package.json                        # Scripts: dev, start, build, lint, test
├── public/
│   ├── brand/                          # Authentic THE GRID emblem and favicon
│   ├── gallery/                        # Verified arena & matchday photography
│   ├── robots.txt
│   └── sitemap.xml
├── src/
│   ├── main.tsx                        # React mount point
│   ├── app/
│   │   ├── App.tsx                     # Root router state & dynamic document meta sync
│   │   └── routes.ts                   # Route definitions and SEO metadata lookup
│   ├── config/
│   │   ├── brand.ts                    # Official branding, WhatsApp, social links, location & legal copy
│   │   └── venue.ts                    # Single-court specs, view switcher, pricing tiers, gallery & academy
│   ├── types/
│   │   ├── booking.ts                  # Shared booking, slot, admin & operating hour contracts
│   │   └── venue.ts                    # Venue, court view, pricing & academy interfaces
│   ├── utils/
│   │   ├── date.ts                     # Asia/Karachi ISO date helpers
│   │   └── validation.ts               # Customer & inquiry form validation rules
│   ├── hooks/
│   │   ├── useBookingSelection.ts      # Session storage persistence for selected slot across checkout
│   │   └── useSlotAvailability.ts      # Real-time slot fetcher with AbortController cancellation
│   ├── services/
│   │   ├── api/
│   │   │   ├── client.ts               # Typed JSON fetch helper
│   │   │   ├── bookingsApi.ts          # Public slot availability & booking submission endpoints
│   │   │   └── adminApi.ts             # Admin auth, dashboard data, status & schedule endpoints
│   │   └── integrations/
│   │       └── whatsapp.ts             # Pre-filled WhatsApp click-to-chat request & inquiry builders
│   ├── components/
│   │   ├── common/SocialIcons.tsx      # Official Instagram, Facebook & WhatsApp SVG icons
│   │   ├── layout/Navbar.tsx           # Single-court brand bar & responsive route navigation
│   │   ├── layout/Footer.tsx           # Footer navigation & legal modal trigger
│   │   └── modals/LegalModal.tsx       # Privacy Policy & Terms modal
│   ├── features/
│   │   ├── arena/                      # Homepage sections & interactive physics football canvas
│   │   ├── booking/                    # Page 02 calendar, slot grid, summary & Page 03 confirmation cards
│   │   └── admin/                      # Admin login/setup, request management & pricing schedule editor
│   ├── pages/
│   │   ├── HomePage.tsx                # Page 01: Arena showcase
│   │   ├── BookingSlotPage.tsx         # Page 02: Date & hourly slot selection
│   │   ├── BookingDetailsPage.tsx      # Page 03: Customer details, split calculator & confirmation
│   │   └── AdminPage.tsx               # Protected admin booking & schedule desk
│   ├── styles/index.css                # Tailwind v4 imports & base typography
│   └── server/
│       ├── config/constants.ts         # Single-court identity, port & runtime environment flags
│       ├── db/sqlite.ts                # SQLite schema initialization & default hourly tier seeding
│       ├── middleware/
│       │   ├── auth.ts                 # scrypt password verification & HMAC-SHA256 Bearer sessions
│       │   ├── rateLimit.ts            # IP rate limiters for public booking & admin login routes
│       │   └── securityHeaders.ts      # Defensive HTTP response headers
│       ├── routes/
│       │   ├── publicBookingRoutes.ts  # /api/health, /api/slots, /api/bookings
│       │   └── adminRoutes.ts          # /api/admin/* endpoints
│       ├── services/
│       │   ├── bookingService.ts       # Single-court slot queries & transactional booking insertion
│       │   └── adminService.ts         # Admin queries, status conflict validation & hours management
│       └── utils/
│           ├── phone.ts                # Pakistani (+92) and international phone normalization
│           └── time.ts                 # Pakistan Standard Time (Asia/Karachi) slot cutoff checks
└── tests/
    ├── unit/bookingDomain.test.ts      # Domain unit tests (dates, PKT cutoffs, phone, auth, WhatsApp)
    └── integration/apiBookingFlow.test.ts # Live HTTP API & SQLite conflict protection tests
```

## Available Commands

- `npm run dev` - Run Express + Vite middleware development server on port `3000`
- `npm run lint` - Run strict TypeScript typechecking (`tsc --noEmit`)
- `npm run test` - Run domain unit tests (`tsx --test tests/unit/*.test.ts`)
- `npm run build` - Build optimized frontend bundle into `/dist`
- `npm start` - Run production Express server on Node 22 (`node server.ts`)

## Environment Variables

Configure secrets via environment variables or hosting secrets panel (see `/.env.example`):

- `PORT` (optional, defaults to `3000`)
- `ADMIN_PASSCODE` (recommended preset passcode for `/admin` across Vercel / serverless deployments; if omitted on persistent Node servers, first visit prompts one-time setup)
- `SESSION_SECRET` (recommended 16+ characters in production for admin Bearer token signing)
- `SQLITE_DB_PATH` (optional custom writable path; defaults to `./data/thegrid.db`, automatically falling back to `/tmp/thegrid-data/thegrid.db` on Vercel)
- `NODE_ENV` (`development` or `production`)

## Vercel Deployment Architecture

- `vercel.json`: Routes `/api/*` to the Express Serverless Function (`api/index.ts`) and rewrites SPA client routes (`/`, `/booking`, `/booking/details`, `/admin`) to `/index.html` while preserving static assets.
- `api/index.ts`: Exports the shared Express API app (`src/server/app.ts`) for Vercel Node `22.x` (`engines.node` in `package.json`).
- **Important Serverless Storage Note**: When running on stateless Vercel Serverless Functions without an external database, SQLite automatically writes to `/tmp/thegrid-data/thegrid.db`, which is ephemeral across cold starts. For permanent multi-instance persistence across serverless cold starts, host `npm start` on a Node 22 server with persistent volume storage at `./data/thegrid.db` or attach a persistent external database.

## Single-Court Booking & Operations

1. **Single Court Enforcement**: SQLite enforces `court_number = 1` (`THE GRID - Main Futsal Court`) with a partial unique index `idx_active_court_slot` over `(court_number, booking_date, start_time) WHERE status IN ('PENDING', 'CONFIRMED')`.
2. **Pakistan Standard Time (`Asia/Karachi`)**: All hourly slots, calendar defaults, and expired-slot checks execute explicitly in `Asia/Karachi`.
3. **WhatsApp Handoff**: After saving a `PENDING` booking request in SQLite, customers review a pre-filled WhatsApp summary and confirm delivery directly in WhatsApp (`+92 323 8148153`).
4. **Admin Desk (`/admin`)**: Authenticated via Bearer HMAC token stored solely in React state memory. Supports approving/rejecting/canceling requests, marking notifications read, and editing hourly PKR rates.
