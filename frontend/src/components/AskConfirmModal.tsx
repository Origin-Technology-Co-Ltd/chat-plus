import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/LocaleContext';

export type AskConfirmInput = {
  title: string;
  prompt: string;
  options: Array<{ label: string }>;
  allowRating: boolean;
};

type AskConfirmModalProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: AskConfirmInput) => void;
};

export function AskConfirmModal({ open, onClose, onSubmit }: AskConfirmModalProps) {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [allowRating, setAllowRating] = useState(true);

  useEffect(() => {
    if (open) {
      setTitle('');
      setPrompt('');
      setOptions(['', '']);
      setAllowRating(true);
    }
  }, [open]);

  if (!open) return null;

  const labels = options.map((item) => item.trim()).filter(Boolean);
  const canSubmit = title.trim() && prompt.trim() && labels.length >= 2;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-pop">
        <h2 className="mb-4 text-base font-semibold">{t('meeting.askConfirm')}</h2>
        <label className="mb-3 block text-xs font-medium text-stone-600">
          {t('meeting.askConfirmTitle')}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm outline-none focus:border-teal-500"
          />
        </label>
        <label className="mb-3 block text-xs font-medium text-stone-600">
          {t('meeting.askConfirmPrompt')}
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm outline-none focus:border-teal-500"
          />
        </label>
        <div className="mb-3">
          <div className="mb-1 text-xs font-medium text-stone-600">{t('meeting.askConfirmOptions')}</div>
          <div className="space-y-2">
            {options.map((opt, index) => (
              <input
                key={index}
                value={opt}
                onChange={(e) => {
                  const next = [...options];
                  next[index] = e.target.value;
                  setOptions(next);
                }}
                placeholder={`${index + 1}`}
                className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm outline-none focus:border-teal-500"
              />
            ))}
          </div>
          {options.length < 6 ? (
            <button
              type="button"
              onClick={() => setOptions((prev) => [...prev, ''])}
              className="mt-2 text-xs font-medium text-teal-700 hover:underline"
            >
              {t('meeting.askConfirmAddOption')}
            </button>
          ) : null}
        </div>
        <label className="mb-4 flex items-center gap-2 text-sm text-stone-700">
          <input
            type="checkbox"
            checked={allowRating}
            onChange={(e) => setAllowRating(e.target.checked)}
          />
          {t('meeting.askConfirmAllowRating')}
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-xs text-stone-600 hover:bg-stone-100">
            {t('room.cancel')}
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => {
              onSubmit({
                title: title.trim(),
                prompt: prompt.trim(),
                options: labels.map((label) => ({ label })),
                allowRating,
              });
              onClose();
            }}
            className="rounded-lg bg-teal-600 px-4 py-2 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-40"
          >
            {t('meeting.askConfirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
