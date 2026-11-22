import { Clock } from 'lucide-react';
import type { OperatingHourConfig } from '@/src/types/booking';

interface OperatingHoursEditorProps {
  hours: OperatingHourConfig[];
  saving: boolean;
  message: string | null;
  onChangeHours: (next: OperatingHourConfig[]) => void;
  onSave: () => Promise<void>;
}

export function OperatingHoursEditor({
  hours,
  saving,
  message,
  onChangeHours,
  onSave,
}: OperatingHoursEditorProps) {
  return (
    <div className="rounded-xl border border-white/12 bg-[#121D52]/80 p-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/10">
        <div>
          <h2 className="font-display text-2xl font-bold uppercase text-white flex items-center gap-2">
            <Clock className="w-5 h-5 text-[#c4d835]" />
            <span>Configured Operating Hours &amp; PKR Rates</span>
          </h2>
          <p className="text-xs text-slate-300 mt-1">
            Toggle which hourly slots are open on Page 02 and adjust hourly pricing.
          </p>
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={() => void onSave()}
          className="px-5 py-2.5 min-h-[42px] text-xs font-bold uppercase text-[#0E1845] bg-[#c4d835] hover:bg-[#d4e157] rounded-md cursor-pointer disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Schedule'}
        </button>
      </div>

      {message && <p className="text-xs font-semibold text-[#c4d835]">{message}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {hours.map((h, idx) => (
          <div
            key={h.start_time}
            className="p-3.5 rounded-lg border border-white/10 bg-[#0B1338]/85 flex items-center justify-between gap-3"
          >
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(h.is_active)}
                onChange={(e) => {
                  const checked = e.target.checked ? 1 : 0;
                  onChangeHours(
                    hours.map((item, i) =>
                      i === idx ? { ...item, is_active: checked } : item
                    )
                  );
                }}
                className="w-4 h-4 accent-[#c4d835]"
              />
              <span className="font-mono-tabular text-xs font-semibold text-white">
                {h.display_name}
              </span>
            </label>

            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-400">PKR</span>
              <input
                type="number"
                min={0}
                step={100}
                value={h.price_pkr}
                onChange={(e) => {
                  const val = Math.max(0, Number(e.target.value) || 0);
                  onChangeHours(
                    hours.map((item, i) =>
                      i === idx ? { ...item, price_pkr: val } : item
                    )
                  );
                }}
                className="w-20 px-2 py-1 text-right font-mono-tabular text-xs font-semibold text-[#c4d835] bg-[#121D52] border border-white/15 rounded"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
