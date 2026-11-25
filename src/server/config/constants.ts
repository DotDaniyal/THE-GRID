export const VENUE_NAME = 'THE GRID - Main Futsal Court';
export const COURT_NUMBER = 1 as const;
export const SLOT_DURATION_MINUTES = 60;
export const PENDING_HOLD_MINUTES = 30;
export const SERVER_PORT =
  process.env.PORT && process.env.PORT !== '8080' ? Number(process.env.PORT) : 3000;
export const IS_PRODUCTION = process.env.NODE_ENV === 'production';
