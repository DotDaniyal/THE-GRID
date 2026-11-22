# THE GRID - Project History & Engineering Record

Date Recorded: 2026-11-22
Project Name: THE GRID (THE GRID by FC Rovers)
Reference Website: https://thegrid.pk/
Venue Location: Jinnah Avenue, Near Checkpost 2 (CP 2), Malir Cantonment, Karachi, Pakistan

---

## 1. Project Overview & Objectives
THE GRID is a full-stack futsal showcase and live court booking web platform built for **THE GRID by FC Rovers** in Malir Cantonment, Karachi. The application guides players across three streamlined customer-facing stages:
- **Page 01 (`/`)**: Immersive futsal arena homepage, central brand showcase, interactive football physics, single-court specs, matchday gallery, location access, and contact channels.
- **Page 02 (`/booking`)**: Interactive `Asia/Karachi` calendar and real-time hourly slot availability grid with PKR pricing and sticky booking summary.
- **Page 03 (`/booking/details`)**: Dedicated customer details, Individual/Shared booking mode, validated booking request submission, in-page confirmation, Bank Al Habib advance instruction, and pre-filled WhatsApp click-to-chat handoff.
- **Admin Desk (`/admin`)**: Protected single-court operations desk for managing booking statuses, notifications, operating hours, and PKR rates.

## 2. Workspace Provenance & Environment Baseline
- **Git History Check**: Running `git status -s` in `/app/applet` returned `fatal: not a git repository`. Because there is no `.git` history in this workspace, no synthetic commit hashes or pre-workspace timestamps are claimed.
- **Runtime Stack**: React 19, TypeScript, Vite 8, Tailwind CSS v4, Express 4, Lucide icons, Motion (`motion/react`), and Node.js `v22.23.2` native `node:sqlite` (`DatabaseSync`).
- **Template Baseline**: Started from `/index.html`, `/metadata.json`, `/package.json`, `/src/App.tsx`, `/src/index.css`, `/src/main.tsx`, `/tsconfig.json`, and `/vite.config.ts`.
- **Unused Template Dependency**: `@google/genai` (`^2.4.0`) and `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API` remain in `package.json`/`metadata.json` from the base applet template; no chatbots or LLM calls exist in the application UI or server routes.

## 3. Initial Live Reference Audit (`https://thegrid.pk/`)
Prior to design and implementation, the reference site (`https://thegrid.pk/`) and live endpoint (`https://thegrid.pk/api/bookings/available-slots`) were inspected:
- **Identity**: `THE GRID` / `BY FC ROVERS` (`Picture Perfect, Culture Driven`, `Game. Set. Grid.`).
- **Address**: `Jinnah Avenue, Near Checkpost 2 (CP 2), Malir Cantonment, Karachi, Pakistan` (Plus Code `W58X+5W7`, original CNIC required for cantonment entry checkpost clearance).
- **Direct Contact & Official Socials**:
  - Phone / WhatsApp: `+92 323 8148153` (`https://wa.me/923238148153`)
  - Booking Support Email: `booking@thegrid.pk`
  - Instagram: `@thegridbyrovers` (`https://instagram.com/thegridbyrovers`)
  - Facebook: `The Grid by Rovers` (`https://www.facebook.com/share/1Gd8Ujvwtp/`)
- **Sporting Partner**: FC Rovers (founded 2003, registered with District Football Association Malir in 2007; partner initiatives with Karachi United).
- **Verified Default Pricing Tiers**:
  - `04:00 AM - 05:00 PM`: `PKR 1,500` / hour
  - `05:00 PM - 07:00 PM`: `PKR 2,500` / hour
  - `07:00 PM - 02:00 AM`: `PKR 4,000` / hour
  - `02:00 AM - 04:00 AM`: `PKR 2,000` / hour

## 4. Authentic Brand Assets & Photography Inventory
All visual assets were sourced directly from THE GRID or purpose-rendered without generic stock photography:
- `/public/brand/thegrid-logo.png` (authentic logo emblem)
- `/public/brand/favicon-32x32.png` (official favicon)
- `/public/gallery/main-court.jpeg` (daylight striped pitch & bleachers)
- `/public/gallery/turf.jpeg` (floodlit night turf view)
- `/public/gallery/practice.jpeg` (close-control turf drills)
- `/public/gallery/DSC04684.jpg` (youth futsal match action)
- `/public/gallery/academy.jpeg` (FC Rovers & Karachi United partnership photo)
- `/src/assets/images/hero_futsal_arena_1795364505927.jpg` (16:9 atmospheric floodlit arena hero backdrop)

## 5. Page 01: Homepage Architecture & Sections (`Home`)
Implemented inside `/` via modular React components:
- `HeroSection.tsx`: Full-viewport arena hero placing `/brand/thegrid-logo.png` in the exact center lockup with balanced 1:1 proportions, floodlight scrim, court center-circle SVG markings, reduced-motion aware intro sequence with `Skip Intro`, `Book Your Court` CTA, and `Explore Arena` anchor.
- `ExploreSection.tsx`: Arena editorial intro, FC Rovers Malir Cantt heritage summary, court photograph, and 4 verified metrics (`01 Championship Court`, `60 Min Hourly Slot Blocks`, `2003 FC Rovers Heritage`, `PKR 1,500 Starting Hourly Rate`).
- `GroundsSection.tsx`: Dedicated showcase for THE GRID Main Futsal Court with interactive 3-angle photo tabs (`Daylight View`, `Floodlit Night`, `Turf & Drills`), technical court specs, and hourly rate cards.
- `ExperienceSection.tsx`: 5-photo authentic matchday gallery with keyboard-accessible lightbox (`Escape`, `ArrowLeft`, `ArrowRight`) and FC Rovers Academy pathways (`Kids Academy`, `Youth Development`, `Adult Training`, `Elite Program`).
- `LocationSection.tsx`: Verified Malir Cantonment address, CNIC checkpost notice, Google Maps `Get Directions` link, `Share Location` / copy button, and interactive embedded map iframe.
- `ContactAndFooter.tsx`: Direct WhatsApp/email/social cards, client-validated WhatsApp inquiry form, quiet footer with Privacy Policy and Terms & Conditions modal, and discrete `Admin` route link.

## 6. Interactive Football Drag/Flick Canvas Engineering
Built `InteractiveFootballCanvas.tsx`:
- Renders a shaded 3D-projected match ball with indigo and volt-lime panels, dynamic contact turf shadow, lift elevation, and velocity-reactive trail at 60fps.
- Supports pointer grab, drag, and flick physics with turf friction while leaving page scrolling uninterrupted outside the ball's hit radius.
- Enforces an elliptical protection boundary (`enforceLogoBoundary`) around the central hero logo lockup so the ball rebounds smoothly and never obscures branding.
- Includes an accessible `Drag or Kick Ball` trigger button for keyboard users.

## 7. Single-Court Architecture Consolidation (`court_number = 1`)
Resolved the prior multi-court discrepancy so the entire application strictly models **ONE single football court**:
- Replaced multiple-court listings with `SINGLE_COURT` (`courtNumber: 1`, `THE GRID - Main Futsal Court`) in `/src/data/gridData.ts`.
- Enforced `court_number INTEGER NOT NULL DEFAULT 1 CHECK (court_number = 1)` in SQLite `bookings` table and `WHERE court_number = 1` across `/api/slots`, `/api/bookings`, and `/api/admin/bookings/:id/status`.
- Replaced multi-court selection UI with a multi-angle view switcher (`COURT_VIEWS`) for the single court.

## 8. Page 02: Date & Time Slot Selection (`Book Court`)
Built `BookingSlotPage.tsx` and `BookingDateCalendar.tsx` on `/booking`:
- Preserves deep royal-blue (`#0C153B` / `#16235C`) and bright lime-yellow (`#c4d835`) identity over `/gallery/turf.jpeg`.
- **Step 01 (`Select Your Booking Date`)**: Monthly calendar displaying current PKT date, month navigation, `Today` / `Tomorrow` quick selectors, highlighted selected date, and disabled past dates.
- **Step 02 (`Choose an Available Time Slot`)**: Fetches real-time 60-minute slots from `GET /api/slots?date=YYYY-MM-DD`, clearly rendering `OPEN` (Available), `SELECTED`, `BOOKED`, and `TIME PASSED` states, with live error/retry handling and refresh control.
- **Sticky Booking Summary**: Displays selected ground, formatted date, time slot, duration (`60 Minutes`), PKR total, and `CONTINUE TO BOOKING` navigation to `/booking/details`.

## 9. Page 03: Customer Booking Details & Confirmation
Built `BookingDetailsPage.tsx` on `/booking/details`:
- Reads preserved `BookingSelection` from `sessionStorage` (`thegrid_booking_selection_v1`) so page refreshes retain selected date/slot; provides a clean fallback CTA if accessed without a slot.
- **Protected Summary Fields**: Auto-populates and locks Booking Date, Booking Time, Selected Ground, and Total Amount (PKR).
- **Customer Form Validation**: Validates full name (min 2 chars), email syntax, country code selector, and Pakistani (`+92` / `03XX`) or international mobile numbers.
- **Booking Type Toggle**: Supports `Individual` and `Shared` booking types; `Shared` includes a live per-person fee splitter (`6 + additionalGuestsCount`) and optional player name fields.
- **Submission & Confirmation**: Calls `POST /api/bookings`, transitions to an in-page confirmation view displaying *"Your booking request has been received. Your booking is awaiting confirmation."*, unique reference ID (`GRD-YYYYMMDD-XXXX`), and `PENDING` status.

## 10. WhatsApp & Advance Payment Integration
- **Bank Al Habib Advance Note**: Displays official 50% advance confirmation instructions (`PK44BAHL5037008100157501`) on both Page 02 summary and Page 03 confirmation.
- **WhatsApp Request Builder (`buildWhatsAppBookingMessage`)**: Generates a clean, pre-filled summary containing Booking ID, Customer Name, Phone, Email, Venue, Date, Time, Booking Type, Total Amount (PKR), and Status (`Pending Confirmation`), with both `Copy Message` and direct `https://wa.me/923238148153?text=...` handoff.

## 11. Admin Booking Management Desk (`/admin`)
Built `AdminPage.tsx` on `/admin`:
- Authenticates via `GET /api/admin/auth-status`, `POST /api/admin/setup` (first-run setup when `ADMIN_PASSCODE` env is unset), and `POST /api/admin/login`.
- Holds HMAC-SHA256 Bearer token strictly in React state memory (never `localStorage` or `sessionStorage`).
- Displays unread booking alerts (`admin_notifications`) with `Mark All Read`, filter tabs (`ALL`, `PENDING`, `CONFIRMED`, `REJECTED`, `CANCELLED`), search across Booking ID/name/phone/date, direct customer WhatsApp link, status actions (`Approve`, `Reject`, `Cancel`), and an interactive `Operating Hours & Pricing` schedule editor.

## 12. Backend API & Server Routing (`server.ts`)
Implemented unified Express server on port `3000` (`0.0.0.0`):
- Public endpoints: `GET /api/health`, `GET /api/slots`, `POST /api/bookings`.
- Admin endpoints: `GET /api/admin/auth-status`, `POST /api/admin/setup`, `POST /api/admin/login`, `GET /api/admin/bookings`, `PATCH /api/admin/bookings/:id/status`, `POST /api/admin/notifications/mark-read`, `GET /api/admin/operating-hours`, `PUT /api/admin/operating-hours`.
- Serves Vite dev middleware in development (`"dev": "tsx server.ts"`) and `/dist` static files + SPA fallback in production (`"start": "node server.ts"`).

## 13. SQLite Database Schema & Concurrency Controls
Implemented `/src/server/db.ts` writing `/data/thegrid.db` (`WAL` mode + `PRAGMA foreign_keys = ON`):
- `operating_hours`: Stores 24 hourly blocks (`start_time`, `end_time`, `display_name`, `price_pkr`, `is_active`) seeded with verified tier rates.
- `bookings`: Stores single-court requests with `CHECK (court_number = 1)`, `CHECK (booking_type IN ('individual', 'shared'))`, `CHECK (status IN ('PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED'))`.
- `idx_active_court_slot`: Partial unique index on `(court_number, booking_date, start_time) WHERE status IN ('PENDING', 'CONFIRMED')` preventing double bookings alongside `BEGIN IMMEDIATE` transactions.
- `admin_credentials` & `admin_notifications`: Single-row passcode hash store and booking alert feed.

## 14. Pakistan Standard Time (`Asia/Karachi`) Slot Cutoff Logic
Implemented `/src/server/time.ts`:
- `getKarachiNow()` computes current date (`YYYY-MM-DD`) and `minutesFromMidnight` explicitly in `Asia/Karachi`.
- `isSlotPassedInKarachi()` marks any date prior to Karachi today as passed, future dates as open, and today's slots as `PAST` once their ending hour (`endMins`) has elapsed, rejecting expired bookings server-side on `POST /api/bookings`.

## 15. Design System & Anti-Slop Cleanup Audit
Completed full visual and code-hygiene cleanup across all components and server files:
- Removed cursor-following `mouseTilt` parallax animation from `HeroSection.tsx`.
- Removed `backdrop-blur-*` glassmorphism utilities from `Navbar.tsx`, `InteractiveFootballCanvas.tsx`, `ExperienceSection.tsx`, `ContactAndFooter.tsx`, `BookingDateCalendar.tsx`, `BookingSlotPage.tsx`, and `BookingDetailsPage.tsx`.
- Removed `whileInView` scroll triggers from `ExploreSection.tsx` and `ExperienceSection.tsx`.
- Replaced `rounded-full` UI shapes in `HeroSection.tsx` and `BookingDateCalendar.tsx`; maintained clean rectangular buttons throughout (zero pill buttons).
- Removed all em dashes across UI copy, titles, metadata, code comments, and server defaults.
- Updated `ExploreSection.tsx` metric from `'24/7' Hourly Slot Schedule` to `'60 Min' / 'Hourly Slot Blocks'` so copy aligns accurately with admin-configurable operating hours.

## 16. Navigation & Customer-Flow Consolidation
Unified `Navbar.tsx` across customer routes (`/`, `/booking`, `/booking/details`) to display THE GRID wordmark/icon alongside `Home`, `Book Court`, `About Us`, `Location`, `Contact Us`, and the primary booking CTA button, keeping `Book Court` actively highlighted on booking stages and maintaining 44px+ mobile touch targets.

## 17. Removed & Replaced Components
- **Deleted**: `/src/components/BookingHandoffModal.tsx` (replaced by live Page 02 `/booking` and Page 03 `/booking/details` backend booking workflow).
- **Restored**: `/src/data/gridData.ts` and `/src/data/bookingTypes.ts` were recreated cleanly after being deleted during workspace maintenance, preserving single-court types and verified arena data.

## 18. Security Hardening & Validation Controls
- Server calculates `duration_minutes` (`60`) and `total_amount_pkr` strictly from database configuration, ignoring client price tampering.
- Parameterized all SQLite queries (`?` placeholders) to prevent SQL injection.
- Admin passwords hashed with `crypto.scryptSync` + 16-byte random salt and verified with `crypto.timingSafeEqual`; Bearer tokens signed with HMAC-SHA256.
- Added per-IP rate limiting in `server.ts`: `bookingRateLimit` (15 requests / 10 min) and `authRateLimit` (10 attempts / 15 min).
- Disabled `x-powered-by` header and added `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Permissions-Policy: camera=(), microphone=()`.

## 19. SEO, OpenGraph, Structured Data & Crawl Files
- Configured `/index.html` with primary SEO title, meta description, keywords, canonical link, OpenGraph tags, Twitter card meta, and Schema.org `SportsActivityLocation` JSON-LD block.
- Implemented dynamic route metadata updates in `src/App.tsx` for `document.title`, `meta[name="description"]`, `og:title`, `og:description`, and `link[rel="canonical"]`.
- Added `/public/robots.txt` and `/public/sitemap.xml`.

## 20. Build, Syntax & End-to-End Runtime QA Results (2026-11-22)
All automated checks ran and passed on 2026-11-22 after final code edits:
- `npm run lint` (`tsc --noEmit`): Passed with 0 errors.
- `npm run build` (`vite build`): Passed, bundling clean assets to `/dist`.
- `node --check server.ts`: Passed with 0 errors.
- Grep Cleanup Audit (`grep -rnE "—|backdrop-blur|rounded-full|mouseTilt|whileInView|@google/genai" src server.ts index.html metadata.json public`): Returned 0 matches.
- Live Express Server Verification (`http://localhost:3000`):
  - `GET /`, `/booking`, `/booking/details`, `/admin`: Returned HTTP `200`, valid SEO `<title>` and JSON-LD, plus security headers (`x-content-type-options: nosniff`, `referrer-policy: strict-origin-when-cross-origin`, no `x-powered-by` or `x-frame-options`).
  - `GET /robots.txt`, `/sitemap.xml`, `/brand/thegrid-logo.png`, `/brand/favicon-32x32.png`, `/gallery/main-court.jpeg`: Returned HTTP `200`.
  - `GET /api/health`: Returned `200` (`courtNumber: 1`, `THE GRID - Main Futsal Court`, live `Asia/Karachi` time).
  - `GET /api/slots`: Returned `400` on invalid date; `200` with 24 single-court slots (`courtNumber: 1`) on valid future date.
  - `POST /api/bookings`: Rejected past dates (`400`) and invalid Pakistani numbers (`400`); created valid shared booking (`201`, `PENDING`, `totalAmountPkr: 4000`, normalized `+92 321 1234567`); rejected duplicate slot submission (`409 Conflict`); reflected `BOOKED` in subsequent slot queries.
  - `GET /api/admin/bookings` (unauthenticated): Returned `401 Unauthorized`.
  - `GET /api/admin/auth-status`: Returned `{ hasEnvPasscode: true, hasClaimedPasscode: false, setupRequired: false }` reflecting runtime `ADMIN_PASSCODE` protection.
  - Synthetic QA test booking and notification rows were removed from `/data/thegrid.db` immediately after verification.

## 21. Deployment Readiness & Known Operational Notes
- **Environment Variables**: Documented in `/.env.example` (`ADMIN_PASSCODE` optional for first-run claim or preset via Secrets; `GEMINI_API_KEY` and `APP_URL` template entries). Set `ADMIN_PASSCODE` and `SESSION_SECRET` (>= 16 characters) in production secrets for persistent admin sessions across restarts.
- **Database Persistence**: `/data/` is ignored in `/.gitignore` and holds live SQLite state (`thegrid.db`). Ensure persistent volume storage on container deployments if preserving SQLite bookings across deploys.
- **Verification Scope**: API, HTML, routing, headers, build, and TypeScript checks were executed live against port `3000`; headless browser screenshot rendering was not available in this CLI environment, so layout/responsiveness was audited across Tailwind breakpoint classes and DOM markup.

---

## 22. Complete Codebase Reorganization & Feature Cleanup (2026-11-22)
Reorganized the flat codebase into a clean, domain-driven modular architecture without altering approved design aesthetics or breaking database compatibility:
- **Frontend Layering (`src/`)**:
  - `src/app/`: `App.tsx`, `routes.ts`
  - `src/config/`: `brand.ts`, `venue.ts`
  - `src/types/`: `booking.ts`, `venue.ts`
  - `src/utils/`: `date.ts`, `validation.ts`
  - `src/hooks/`: `useBookingSelection.ts`, `useSlotAvailability.ts` (added `AbortController` cancellation for rapid date switching)
  - `src/services/api/`: `client.ts`, `bookingsApi.ts`, `adminApi.ts`
  - `src/services/integrations/`: `whatsapp.ts`
  - `src/components/`: `common/SocialIcons.tsx`, `layout/Navbar.tsx`, `layout/Footer.tsx`, `modals/LegalModal.tsx`
  - `src/features/arena/`: `HeroSection.tsx`, `InteractiveFootballCanvas.tsx`, `ExploreSection.tsx`, `GroundsSection.tsx`, `ExperienceSection.tsx`, `LocationSection.tsx`, `ContactSection.tsx`
  - `src/features/booking/`: `BookingDateCalendar.tsx`, `TimeSlotGrid.tsx`, `BookingSummaryCard.tsx`, `BookingConfirmationCard.tsx`, `SharedSplitPanel.tsx`
  - `src/features/admin/`: `AdminLoginCard.tsx`, `AdminBookingsList.tsx`, `OperatingHoursEditor.tsx`
  - `src/pages/`: `HomePage.tsx`, `BookingSlotPage.tsx`, `BookingDetailsPage.tsx`, `AdminPage.tsx`
  - `src/styles/`: `index.css`
- **Backend Layering (`src/server/` + `server.ts`)**:
  - Split monolithic `server.ts` routes into `src/server/config/constants.ts`, `src/server/db/sqlite.ts`, `src/server/middleware/{auth,rateLimit,securityHeaders}.ts`, `src/server/services/{bookingService,adminService}.ts`, `src/server/routes/{publicBookingRoutes,adminRoutes}.ts`, and `src/server/utils/{phone,time}.ts`.
  - Preserved full Node 22 native TypeScript (`node server.ts`) erasable-TS and explicit `.ts` relative import compatibility.
- **Sport Scope Consolidation (100% Futsal / Football)**:
  - Audited the entire repository and removed residual non-futsal copy and metadata from `src/config/venue.ts`, `src/features/arena/ExploreSection.tsx`, and `index.html` Schema.org tags so THE GRID presents an exclusively futsal and football platform.
- **Removed Superseded Legacy Files**:
  - Deleted `src/App.tsx`, `src/index.css`, `src/data/bookingTypes.ts`, `src/data/gridData.ts`, flat `src/components/{BookingDateCalendar,ContactAndFooter,ExperienceSection,ExploreSection,GroundsSection,HeroSection,InteractiveFootballCanvas,LocationSection,Navbar}.tsx`, and flat `src/server/{auth,db,time}.ts`.
- **Automated Test Suite & Documentation**:
  - Added `/tests/unit/bookingDomain.test.ts` and `/tests/integration/apiBookingFlow.test.ts`, wired `"test": "tsx --test tests/unit/*.test.ts"` in `package.json`, and created `/README.md`.

