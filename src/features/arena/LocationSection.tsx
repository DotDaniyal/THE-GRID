import { useState } from 'react';
import { MapPin, Navigation, Share2, Check, Info } from 'lucide-react';
import { LOCATION } from '@/src/config/brand';

export function LocationSection() {
  const [shareStatus, setShareStatus] = useState<'idle' | 'shared' | 'copied'>('idle');
  const [mapLoaded, setMapLoaded] = useState(false);

  const handleShareLocation = async () => {
    const shareData = {
      title: LOCATION.venueName,
      text: `${LOCATION.venueName} - ${LOCATION.fullAddress}`,
      url: LOCATION.directionsUrl,
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
        setShareStatus('shared');
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(
          `${LOCATION.venueName}\n${LOCATION.fullAddress}\n${LOCATION.directionsUrl}`
        );
        setShareStatus('copied');
      }
      window.setTimeout(() => setShareStatus('idle'), 2800);
    } catch {
      // User cancelled share sheet
    }
  };

  return (
    <section id="location" className="relative bg-[#0B1020] py-20 sm:py-28 border-t border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          <div className="lg:col-span-5 flex flex-col justify-between space-y-8">
            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#c4d835]">
                04. Location &amp; Access
              </p>
              <h2 className="font-display font-bold uppercase tracking-tight text-white text-[clamp(2.25rem,4vw,3.5rem)] leading-[1.02] text-balance">
                Find Us in Malir Cantonment
              </h2>
              <p className="text-base text-slate-300 leading-relaxed">
                Conveniently positioned off Jinnah Avenue near Checkpost 2 (CP 2) inside Malir
                Cantonment, Karachi.
              </p>
            </div>

            <div className="rounded-xl border border-white/10 bg-[#0E1428] p-6 space-y-5">
              <div className="flex items-start gap-3.5">
                <MapPin className="w-5 h-5 text-[#c4d835] shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <div className="text-base font-semibold text-white">{LOCATION.venueName}</div>
                  <address className="not-italic mt-1 text-sm text-slate-300 leading-relaxed">
                    {LOCATION.street}
                    <br />
                    {LOCATION.district}, {LOCATION.city}
                  </address>
                  <div className="mt-2 text-xs text-slate-400">
                    <span>Map Plus Code: </span>
                    <span className="font-mono-tabular text-slate-200">{LOCATION.plusCode}</span>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-white/10 flex items-start gap-3">
                <Info className="w-4 h-4 text-[#c4d835] shrink-0 mt-0.5" aria-hidden="true" />
                <p className="text-xs text-slate-300 leading-relaxed">{LOCATION.accessNote}</p>
              </div>

              <div className="pt-2 flex flex-wrap gap-3">
                <a
                  href={LOCATION.directionsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 min-w-[160px] inline-flex items-center justify-center gap-2 px-5 py-3 min-h-[46px] text-sm font-bold text-[#070A14] bg-[#c4d835] hover:bg-[#d4e157] rounded-md transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  <Navigation className="w-4 h-4" aria-hidden="true" />
                  <span>Get Directions</span>
                </a>

                <button
                  type="button"
                  onClick={handleShareLocation}
                  className="inline-flex items-center justify-center gap-2 px-5 py-3 min-h-[46px] text-sm font-semibold text-white bg-white/5 hover:bg-white/10 border border-white/15 rounded-md transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4d835]"
                >
                  {shareStatus === 'idle' ? (
                    <>
                      <Share2 className="w-4 h-4 text-[#c4d835]" aria-hidden="true" />
                      <span>Share Location</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4 text-[#c4d835]" aria-hidden="true" />
                      <span>
                        {shareStatus === 'shared' ? 'Location Shared' : 'Link Copied'}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="lg:col-span-7 relative min-h-[340px] lg:min-h-[460px] rounded-xl overflow-hidden border border-white/10 bg-[#070A14]">
            {!mapLoaded && (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-[#0E1428]">
                <MapPin className="w-7 h-7 text-[#c4d835] mb-2" aria-hidden="true" />
                <p className="text-sm font-medium text-white">{LOCATION.venueName}</p>
                <p className="text-xs text-slate-400 mt-1">{LOCATION.fullAddress}</p>
              </div>
            )}
            <iframe
              title="Map showing The Grid by FC Rovers in Malir Cantonment, Karachi"
              src={LOCATION.embedUrl}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              onLoad={() => setMapLoaded(true)}
              className="relative z-10 w-full h-full min-h-[340px] lg:min-h-[460px] border-0 grayscale-[25%] contrast-[1.08]"
              allowFullScreen
            />
          </div>
        </div>
      </div>
    </section>
  );
}
