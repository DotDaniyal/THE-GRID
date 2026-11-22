import { Minus, Plus } from 'lucide-react';
import type { SharedParticipant } from '@/src/types/booking';

interface SharedSplitPanelProps {
  totalAmountPkr: number;
  participants: SharedParticipant[];
  additionalGuestsCount: number;
  onUpdateParticipant: (idx: number, field: keyof SharedParticipant, value: string) => void;
  onChangeAdditionalGuests: (nextCount: number) => void;
}

export function SharedSplitPanel({
  totalAmountPkr,
  participants,
  additionalGuestsCount,
  onUpdateParticipant,
  onChangeAdditionalGuests,
}: SharedSplitPanelProps) {
  const totalSplitPeople = Math.max(6 + additionalGuestsCount, 1);
  const perPersonShare = Math.round((totalAmountPkr / totalSplitPeople) * 100) / 100;

  return (
    <div className="rounded-lg border border-[#c4d835]/25 bg-[#0B1338]/75 p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/10">
        <span className="text-sm font-semibold text-white">
          Splitting between {totalSplitPeople} players
        </span>
        <span className="font-mono-tabular text-sm font-bold text-[#c4d835]">
          PKR {perPersonShare.toLocaleString()} / person
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {participants.map((p, idx) => (
          <div
            key={idx}
            className="flex items-center gap-2 bg-[#121D52]/65 border border-white/10 rounded-lg p-2.5"
          >
            <span className="font-mono-tabular w-6 h-6 rounded bg-[#c4d835]/20 text-[#c4d835] text-xs font-bold flex items-center justify-center shrink-0">
              {idx + 1}
            </span>
            <input
              type="text"
              value={p.name}
              onChange={(e) => onUpdateParticipant(idx, 'name', e.target.value)}
              placeholder={`Player ${idx + 1} name (optional)`}
              className="w-full min-w-0 bg-transparent text-xs text-white placeholder:text-slate-400 focus:outline-none"
            />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-4 pt-1">
        <span className="text-xs text-slate-300">Additional players in split</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Decrease additional guests"
            onClick={() => onChangeAdditionalGuests(Math.max(0, additionalGuestsCount - 1))}
            className="w-8 h-8 rounded border border-white/20 text-white hover:border-[#c4d835] flex items-center justify-center cursor-pointer"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <span className="font-mono-tabular text-sm font-bold text-[#c4d835] w-6 text-center">
            {additionalGuestsCount}
          </span>
          <button
            type="button"
            aria-label="Increase additional guests"
            onClick={() => onChangeAdditionalGuests(Math.min(18, additionalGuestsCount + 1))}
            className="w-8 h-8 rounded border border-white/20 text-white hover:border-[#c4d835] flex items-center justify-center cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
