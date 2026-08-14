import { useEffect, useMemo, useState } from 'react';
import type { Contact } from '../api/client';
import { patchSession } from '../api/client';
import { useI18n } from '../i18n/LocaleContext';

type AddMembersModalProps = {
  sessionId: string;
  currentMemberIds: string[];
  contacts: Contact[];
  open: boolean;
  onClose: () => void;
  onUpdated: () => void;
  onError: (message: string) => void;
};

export function AddMembersModal({
  sessionId,
  currentMemberIds,
  contacts,
  open,
  onClose,
  onUpdated,
  onError,
}: AddMembersModalProps) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<Set<string>>(new Set(currentMemberIds));
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (open) {
      setSelected(new Set(currentMemberIds));
      setQuery('');
      setSaving(false);
    }
  }, [open, currentMemberIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) => c.name.toLowerCase().includes(q));
  }, [contacts, query]);

  if (!open) return null;

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSave(): Promise<void> {
    if (selected.size < 1 || saving) return;
    setSaving(true);
    try {
      await patchSession(sessionId, { memberContactIds: [...selected] });
      onUpdated();
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : t('app.createSessionFailed'));
    } finally {
      setSaving(false);
    }
  }

  const changed =
    selected.size !== currentMemberIds.length ||
    currentMemberIds.some((id) => !selected.has(id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 p-4 animate-fade-in">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-pop animate-pop-in text-stone-800">
        <h2 className="mb-1 text-base font-semibold text-stone-900">{t('room.addMembersTitle')}</h2>
        <p className="mb-4 text-xs text-stone-500">{t('room.addMembersHint')}</p>

        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('room.searchMembers')}
          className="mb-3 w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15"
        />

        <ul className="mb-4 max-h-64 space-y-1 overflow-y-auto">
          {filtered.map((contact) => {
            const checked = selected.has(contact.id);
            return (
              <li key={contact.id}>
                <label
                  className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm ${
                    checked ? 'bg-teal-50 text-teal-900' : 'hover:bg-stone-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(contact.id)}
                    className="h-3.5 w-3.5 rounded border-stone-300 text-teal-600"
                  />
                  <span className="truncate font-medium">{contact.name}</span>
                </label>
              </li>
            );
          })}
        </ul>

        {selected.size < 1 ? (
          <p className="mb-3 text-xs text-amber-700">{t('room.needOne')}</p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-xs text-stone-600 hover:bg-stone-100">
            {t('room.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || selected.size < 1 || !changed}
            className="rounded-lg bg-teal-600 px-4 py-2 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-40"
          >
            {t('room.saveMembers')}
          </button>
        </div>
      </div>
    </div>
  );
}
