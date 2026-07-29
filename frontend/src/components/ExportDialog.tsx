import { useI18n } from '../i18n/LocaleContext';

type ExportDialogProps = {
  open: boolean;
  defaultPath: string;
  onClose: () => void;
  onConfirm: (path: string) => void;
};

export function ExportDialog({ open, defaultPath, onClose, onConfirm }: ExportDialogProps) {
  const { t } = useI18n();
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 p-4 animate-fade-in">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-pop animate-pop-in text-stone-800">
        <h2 className="mb-2 text-base font-semibold text-stone-900">{t('export.title')}</h2>
        <p className="mb-4 text-xs leading-relaxed text-stone-500">
          {t('export.hint')}{' '}
          <code className="rounded bg-stone-100 px-1.5 py-0.5 text-stone-700 font-mono">{defaultPath}</code>
          {t('export.hintClose')}
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            const path = String(data.get('path') ?? '').trim();
            if (path) onConfirm(path);
          }}
        >
          <input
            name="path"
            defaultValue={defaultPath}
            className="mb-5 w-full rounded-lg border border-stone-200 bg-white px-3.5 py-2.5 text-sm font-mono text-stone-800 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 transition-all"
            placeholder="/path/to/export-folder"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-xs font-medium text-stone-600 hover:bg-stone-100 transition-colors"
            >
              {t('export.cancel')}
            </button>
            <button
              type="submit"
              className="rounded-lg bg-teal-600 px-4 py-2 text-xs font-medium text-white hover:bg-teal-700 transition-colors active:bg-teal-800"
            >
              {t('export.confirm')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
