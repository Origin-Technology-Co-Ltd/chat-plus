import { useMemo, useState } from 'react';
import type { MeetingPendingConfirm } from '../api/client';
import { useI18n } from '../i18n/LocaleContext';

type MeetingConfirmCardProps = {
  confirm: MeetingPendingConfirm;
  submitting?: boolean;
  onSubmit: (input: {
    selectedIds: string[];
    ratings?: Record<string, number>;
    comment?: string;
  }) => void;
};

export function MeetingConfirmCard({ confirm, submitting = false, onSubmit }: MeetingConfirmCardProps) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [comment, setComment] = useState('');

  const canSubmit = selected.size > 0 && !submitting;

  const ratingValues = useMemo(() => [1, 2, 3, 4, 5], []);

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-3">
      <div className="mx-auto max-w-3xl">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-800">
          {t('meeting.confirmAskBadge')}
        </div>
        <h3 className="text-sm font-semibold text-stone-900">{confirm.title}</h3>
        <p className="mt-1 text-xs text-stone-700">{confirm.prompt}</p>
        <p className="mt-2 text-[11px] text-stone-500">{t('meeting.confirmSelectHint')}</p>
        <ul className="mt-2 space-y-2">
          {confirm.options.map((opt) => {
            const checked = selected.has(opt.id);
            return (
              <li key={opt.id} className="rounded-lg bg-white px-3 py-2 ring-1 ring-amber-200">
                <label className="flex cursor-pointer items-start gap-2 text-sm text-stone-800">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(opt.id)}
                    className="mt-0.5"
                  />
                  <span className="flex-1">{opt.label}</span>
                </label>
                {confirm.allowRating && checked ? (
                  <div className="mt-2 flex items-center gap-2 pl-6 text-[11px] text-stone-500">
                    <span>{t('meeting.confirmRating')}</span>
                    {ratingValues.map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setRatings((prev) => ({ ...prev, [opt.id]: n }))}
                        className={`rounded px-1.5 py-0.5 ${
                          ratings[opt.id] === n ? 'bg-amber-600 text-white' : 'bg-stone-100 text-stone-600 hover:bg-amber-100'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        <label className="mt-3 block text-xs font-medium text-stone-600">
          {t('meeting.confirmComment')}
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-500"
          />
        </label>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() =>
              onSubmit({
                selectedIds: [...selected],
                ratings: confirm.allowRating ? ratings : undefined,
                comment: comment.trim() || undefined,
              })
            }
            className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-800 disabled:opacity-40"
          >
            {t('meeting.confirmSubmit')}
          </button>
        </div>
      </div>
    </div>
  );
}
