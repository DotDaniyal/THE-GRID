export interface CourtSpec {
  id: string;
  courtNumber: 1;
  name: string;
  subtitle: string;
  format: string;
  surface: string;
  lighting: string;
  description: string;
  highlights: string[];
}

export interface CourtView {
  id: string;
  label: string;
  image: string;
  imageAlt: string;
  caption: string;
}

export interface PricingTier {
  window: string;
  label: string;
  ratePkr: number;
  note: string;
}

export interface GalleryItem {
  id: number;
  src: string;
  alt: string;
  title: string;
  caption: string;
}

export interface AcademyProgram {
  title: string;
  ages: string;
  schedule: string;
  description: string;
}
