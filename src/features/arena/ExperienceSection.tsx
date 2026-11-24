import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { ACADEMY_PROGRAMS, GALLERY_ITEMS } from '@/src/config/venue';

export function ExperienceSection() {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [imgErrors, setImgErrors] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (selectedIndex === null) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedIndex(null);
      if (e.key === 'ArrowRight') {
        setSelectedIndex((prev) =>
          prev === null ? 0 : (prev + 1) % GALLERY_ITEMS.length
        );
      }
      if (e.key === 'ArrowLeft') {
        setSelectedIndex((prev) =>
          prev === null ? 0 : (prev - 1 + GALLERY_ITEMS.length) % GALLERY_ITEMS.length
        );
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIndex]);

  const activeItem = selectedIndex !== null ? GALLERY_ITEMS[selectedIndex] : null;

  return (
    <section id="experience" className="relative bg-[#070A14] py-20 sm:py-28 border-t border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#c4d835]">
            03. The Experience
          </p>
          <h2 className="mt-3 font-display font-bold uppercase tracking-tight text-white text-[clamp(2.25rem,4vw,3.5rem)] leading-[1.02] text-balance">
            Inside THE GRID Matchday Culture
          </h2>
          <p className="mt-4 text-base text-slate-300 leading-relaxed">
            Real moments from our Malir Cantonment pitches: late-night floodlit runs, local
            tournaments, and FC Rovers Academy training blocks.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 md:grid-cols-12 gap-5">
          {GALLERY_ITEMS.map((item, index) => {
            const colSpan =
              index === 0
                ? 'md:col-span-7 md:row-span-2 min-h-[340px] md:min-h-[480px]'
                : index === 1
                ? 'md:col-span-5 min-h-[230px]'
                : index === 2
                ? 'md:col-span-5 min-h-[230px]'
                : 'md:col-span-6 min-h-[260px]';

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedIndex(index)}
                className={`${colSpan} group relative rounded-xl overflow-hidden border border-white/10 bg-[#0E1428] text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4d835]`}
              >
                {!imgErrors[item.id] ? (
                  <img
                    src={item.src}
                    alt={item.alt}
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    onError={() =>
                      setImgErrors((prev) => ({ ...prev, [item.id]: true }))
                    }
                    className="w-full h-full object-cover object-center"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#131B3A] to-[#070A14] p-6">
                    <span className="font-display text-xl font-bold text-[#c4d835]">
                      {item.title}
                    </span>
                  </div>
                )}
                <div
                  aria-hidden="true"
                  className="absolute inset-0 bg-gradient-to-t from-[#070A14]/90 via-[#070A14]/25 to-transparent"
                />
                <div className="absolute bottom-0 inset-x-0 p-5">
                  <div className="font-display text-xl font-bold uppercase text-white group-hover:text-[#c4d835] transition-colors">
                    {item.title}
                  </div>
                  <p className="mt-1 text-xs sm:text-sm text-slate-300 line-clamp-2">
                    {item.caption}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-16 pt-14 border-t border-white/10">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#c4d835]">
                FC Rovers Academy
              </p>
              <h3 className="mt-2 font-display text-2xl sm:text-3xl font-bold uppercase text-white">
                Structured Coaching Pathways
              </h3>
            </div>
            <div className="text-sm text-slate-300">
              <span>Academy Hours: </span>
              <span className="font-mono-tabular font-semibold text-white">
                Daily 4:00 PM - 10:00 PM
              </span>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {ACADEMY_PROGRAMS.map((program) => (
              <div
                key={program.title}
                className="p-5 rounded-xl border border-white/10 bg-[#0E1428] flex flex-col justify-between space-y-4"
              >
                <div>
                  <div className="text-xs font-medium text-[#c4d835]">{program.ages}</div>
                  <h4 className="mt-1 font-display text-xl font-bold uppercase text-white">
                    {program.title}
                  </h4>
                  <p className="mt-2 text-sm text-slate-300 leading-relaxed">
                    {program.description}
                  </p>
                </div>
                <div className="pt-3 border-t border-white/10 text-xs text-slate-400">
                  {program.schedule}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {activeItem && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={activeItem.title}
          className="fixed inset-0 z-50 bg-[#070A14]/95 flex items-center justify-center p-4"
          onClick={() => setSelectedIndex(null)}
        >
          <div
            className="relative max-w-4xl w-full rounded-xl overflow-hidden border border-white/15 bg-[#0E1428]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              aria-label="Close gallery preview"
              onClick={() => setSelectedIndex(null)}
              className="absolute top-3 right-3 z-10 w-11 h-11 rounded-md bg-[#070A14]/80 hover:bg-[#c4d835] text-white hover:text-[#070A14] flex items-center justify-center transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="relative aspect-[16/10] bg-black">
              <img
                src={activeItem.src}
                alt={activeItem.alt}
                decoding="async"
                referrerPolicy="no-referrer"
                className="w-full h-full object-contain"
              />
            </div>

            <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-t border-white/10">
              <div>
                <h4 className="font-display text-xl font-bold uppercase text-white">
                  {activeItem.title}
                </h4>
                <p className="mt-0.5 text-sm text-slate-300">{activeItem.caption}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  aria-label="Previous photo"
                  onClick={() =>
                    setSelectedIndex((prev) =>
                      prev === null
                        ? 0
                        : (prev - 1 + GALLERY_ITEMS.length) % GALLERY_ITEMS.length
                    )
                  }
                  className="w-11 h-11 rounded-md border border-white/15 text-white hover:border-[#c4d835] hover:text-[#c4d835] flex items-center justify-center transition-colors cursor-pointer"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  aria-label="Next photo"
                  onClick={() =>
                    setSelectedIndex((prev) =>
                      prev === null ? 0 : (prev + 1) % GALLERY_ITEMS.length
                    )
                  }
                  className="w-11 h-11 rounded-md border border-white/15 text-white hover:border-[#c4d835] hover:text-[#c4d835] flex items-center justify-center transition-colors cursor-pointer"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
