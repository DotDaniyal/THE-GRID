# THE GRID - Official Futsal Platform

Official web platform and live hourly court booking system for **THE GRID by FC Rovers**, located on Jinnah Avenue near Checkpost 2 (CP 2), Malir Cantonment, Karachi, Pakistan.

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite 8 (route-level code splitting), Tailwind CSS v4, Lucide React
- **Backend**: Express 4, Node.js `v22+` native TypeScript (`node server.ts`), `node:sqlite` (`DatabaseSync` in WAL mode), SSE live slot updates
- **Security**: Argon2 password hashing (`argon2`), HTTP-only session cookies + Bearer tokens, TOTP MFA (`totp.ts`), `express-session`, `express-rate-limit`
- **Testing**: Node built-in `node:test` runner executed via `tsx`

## Project Architecture

```text
/
├── index.html                          # SEO metadata, OpenGraph, preloaded hero WebP, JSON-LD
├── server.ts                           # Express entry point, pending-hold sweeper, Vite/SPA hosting
├── api/index.ts                        # Vercel serverless Express handler wrapper
├── package.json                        # Scripts: dev, start, build, lint, test
├── public/
│   ├── brand/                          # Authentic THE GRID WebP & PNG emblem and favicon
│   ├── gallery/                        # Optimized arena & matchday photography (WebP & JPEG)
│   ├── robots.txt
│   └── sitemap.xml
├── src/
│   ├── main.tsx                        # React mount point
│   ├── app/
│   │   ├── App.tsx                     # Root router state, lazy route splitting & meta sync
│   │   └── routes.ts                   # Route definitions and SEO metadata lookup
│   ├── config/
│   │   ├── brand.ts                    # Official branding, WhatsApp, social links, location & legal copy
│   │   └── venue.ts                    # Single-court specs, view switcher, pricing tiers, gallery & academy
│   ├── types/
│   │   ├── booking.ts                  # Shared booking, slot, admin, drinks & operating hour contracts
│   │   └── venue.ts                    # Venue, court view, pricing & academy interfaces
│   ├── utils/
│   │   ├── date.ts                     # Asia/Karachi ISO date helpers
│   │   └── validation.ts               # Customer & inquiry form validation rules
│   ├── hooks/
│   │   ├── useBookingSelection.ts      # Session storage persistence for selected slot across checkout
│   │   ├── useSlotAvailability.ts      # Real-time slot fetcher with AbortController cancellation
│   │   └── useSlotStream.ts            # EventSource SSE live slot synchronization hook
│   ├── services/
│   │   ├── api/
│   │   │   ├── client.ts               # Typed JSON fetch helper
│   │   │   ├── bookingsApi.ts          # Public slot availability & booking submission endpoints
│   │   │   └── adminApi.ts             # Admin auth, dashboard data, bookings, schedule & drinks endpoints
│   │   └── integrations/
│   │       └── whatsapp.ts             # Pre-filled WhatsApp click-to-chat request & inquiry builders
│   ├── components/
│   │   ├── common/SocialIcons.tsx      # Official Instagram, Facebook & WhatsApp SVG icons
│   │   ├── layout/Navbar.tsx           # Single-court brand bar & responsive route navigation
│   │   ├── layout/Footer.tsx           # Footer navigation & legal modal trigger
│   │   └── modals/LegalModal.tsx       # Privacy Policy & Terms modal
│   ├── features/
│   │   ├── arena/                      # Lightweight homepage arena showcase, gallery & location sections
│   │   ├── booking/                    # Page 02 calendar, slot grid, summary & Page 03 confirmation cards
│   │   └── admin/                      # Admin login/setup, bookings, schedule, security & private drinks P&L
│   ├── pages/
│   │   ├── HomePage.tsx                # Page 01: Arena showcase (eagerly loaded)
│   │   ├── BookingSlotPage.tsx         # Page 02: Date & hourly slot selection (lazy-loaded)
│   │   ├── BookingDetailsPage.tsx      # Page 03: Customer details, split calculator & confirmation (lazy-loaded)
│   │   └── AdminPage.tsx               # Protected admin booking, schedule & drinks inventory desk (lazy-loaded)
│   ├── styles/index.css                # Tailwind v4 imports & base typography
│   └── server/
│       ├── app.ts                      # Express API app factory, security middleware & session config
│       ├── config/constants.ts         # Single-court identity, port & runtime environment flags
│       ├── db/sqlite.ts                # SQLite schema initialization & default hourly tier seeding
│       ├── events/bookingEvents.ts     # In-process SSE broadcaster for real-time slot updates
│       ├── middleware/
│       │   ├── auth.ts                 # Argon2 verification, session tokens & TOTP MFA verification
│       │   ├── rateLimit.ts            # IP rate limiters & progressive lockouts
│       │   └── securityHeaders.ts      # Defensive HTTP response headers
│       ├── routes/
│       │   ├── publicBookingRoutes.ts  # /api/health, /api/slots, /api/slots/stream, /api/bookings
│       │   └── adminRoutes.ts          # /api/admin/* endpoints (bookings, hours, accounts, MFA, drinks)
│       ├── services/
│       │   ├── bookingService.ts       # Single-court slot queries & transactional booking insertion
│       │   ├── adminService.ts         # Admin queries, status conflict validation & hours management
│       │   └── drinkService.ts         # Private admin drinks inventory, sales & P&L analytics service
│       └── utils/
│           ├── phone.ts                # Pakistani (+92) and international phone normalization
│           ├── time.ts                 # Pakistan Standard Time (Asia/Karachi) slot cutoff checks
│           └── totp.ts                 # RFC 6238 TOTP authenticator helper
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
- `SESSION_SECRET` (recommended 16+ characters in production for admin session signing)
- `SQLITE_DB_PATH` (optional custom writable path; defaults to `./data/thegrid.db`, automatically falling back to `/tmp/thegrid-data/thegrid.db` on Vercel)
- `NODE_ENV` (`development` or `production`)

## Vercel Deployment Architecture

- `vercel.json`: Routes `/api/*` to the Express Serverless Function (`api/index.ts`) and rewrites SPA client routes (`/`, `/booking`, `/booking/details`, `/admin`) to `/index.html` while preserving static assets.
- `api/index.ts`: Exports the shared Express API app (`src/server/app.ts`) for Vercel Node `22.x` (`engines.node` in `package.json`).
- **Important Serverless Storage Note**: When running on stateless Vercel Serverless Functions without an external database, SQLite automatically writes to `/tmp/thegrid-data/thegrid.db`, which is ephemeral across cold starts. For permanent multi-instance persistence across serverless cold starts, host `npm start` on a Node 22 server with persistent volume storage at `./data/thegrid.db` or attach a persistent external database.

## Single-Court Booking & Operations

1. **Single Court Enforcement**: SQLite enforces `court_number = 1` (`THE GRID - Main Futsal Court`) with a partial unique index `idx_active_court_slot` over `(court_number, booking_date, start_time) WHERE status IN ('PENDING', 'CONFIRMED')`.
2. **Real-Time Synchronization**: Public booking views subscribe to `GET /api/slots/stream` (Server-Sent Events) alongside immediate central SQLite validation.
3. **Pakistan Standard Time (`Asia/Karachi`)**: All hourly slots, calendar defaults, and expired-slot checks execute explicitly in `Asia/Karachi`.
4. **WhatsApp Handoff**: After saving a `PENDING` booking request in SQLite, customers review a pre-filled WhatsApp summary and confirm delivery directly in WhatsApp (`+92 323 8148153`).
5. **Admin Desk (`/admin`)**: Protected via Argon2 + HTTP-only session cookie / Bearer auth with optional TOTP MFA. Supports booking confirmations, notifications, operating hours/PKR rates, and private Drinks & Inventory sales/P&L tracking.
