import { HeroSection } from '@/src/features/arena/HeroSection';
import { ExploreSection } from '@/src/features/arena/ExploreSection';
import { GroundsSection } from '@/src/features/arena/GroundsSection';
import { ExperienceSection } from '@/src/features/arena/ExperienceSection';
import { LocationSection } from '@/src/features/arena/LocationSection';
import { ContactSection } from '@/src/features/arena/ContactSection';
import { Footer } from '@/src/components/layout/Footer';

interface HomePageProps {
  onBookNow: () => void;
  onNavigateAdmin: () => void;
}

export function HomePage({ onBookNow, onNavigateAdmin }: HomePageProps) {
  return (
    <>
      <main>
        <HeroSection onBookNow={onBookNow} />
        <ExploreSection />
        <GroundsSection onBookNow={onBookNow} />
        <ExperienceSection />
        <LocationSection />
        <ContactSection />
      </main>
      <Footer onBookNow={onBookNow} onNavigateAdmin={onNavigateAdmin} />
    </>
  );
}
