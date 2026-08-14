import { useEffect, useMemo, useState } from 'react';
import type { Contact } from '../api/client';
import { createSession } from '../api/client';
import { useI18n } from '../i18n/LocaleContext';

type CreateRoomModalProps = {
  contacts: Contact[];
  open: boolean;
  onClose: () => void;
  onCreated: (sessionId: string) => void;
  onError: (message: string) => void;
};

export function CreateRoomModal({
  contacts,
  open,
  onClose,
  onCreated,
  onError,
}: CreateRoomModalProps) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [title, setTitle] = useState('');

  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setCreating(false);
      setQuery('');
      setTitle('');
    }
  }, [open]);

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

  async function handleCreate(): Promise<void> {
    if (selected.size < 2 || creating) return;
    setCreating(true);
    try {
      const session = await createSession({
        kind: 'room',
        title: title.trim() || undefined,
        memberContactIds: [...selected],
      });
      onCreated(session.id);
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : t('app.createSessionFailed'));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 p-4 animate-fade-in">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-pop animate-pop-in text-stone-800">
        <h2 className="mb-1 text-base font-semibold text-stone-900">{t('room.createTitle')}</h2>
        <p className="mb-4 text-xs text-stone-500">{t('room.pickMembers')}</p>
        <label className="mb-3 block text-xs font-medium text-stone-600">
          {t('room.name')}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('room.namePlaceholder')}
            className="mt-1 w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-800 outline-none placeholder:text-stone-400 focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/15"
          />
        </label>

        {contacts.length === 0 ? (
          <p className="mb-5 rounded-lg border border-stone-100 bg-stone-50 px-3 py-6 text-center text-xs text-stone-400">
            {t('contacts.empty')}
          </p>
        ) : (
          <>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('room.searchMembers')}
              className="mb-3 w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-800 outline-none placeholder:text-stone-400 focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/15"
              autoFocus
            />
            <ul className="mb-4 max-h-64 space-y-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <li className="px-3 py-4 text-center text-xs text-stone-400">{t('room.noSearchResults')}</li>
              ) : (
                filtered.map((contact) => {
                  const checked = selected.has(contact.id);
                  return (
                    <li key={contact.id}>
                      <label
                        className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                          checked ? 'bg-teal-50 text-teal-900' : 'hover:bg-stone-50 text-stone-700'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(contact.id)}
                          className="h-3.5 w-3.5 rounded border-stone-300 text-teal-600 focus:ring-teal-500"
                        />
                        <span className="truncate font-medium">{contact.name}</span>
                      </label>
                    </li>
                  );
                })
              )}
            </ul>
          </>
        )}

        {selected.size > 0 && selected.size < 2 ? (
          <p className="mb-3 text-xs text-amber-700">{t('room.needTwo')}</p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-xs font-medium text-stone-600 hover:bg-stone-100 transition-colors"
          >
            {t('room.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={creating || selected.size < 2}
            className="rounded-lg bg-teal-600 px-4 py-2 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-40 transition-colors active:bg-teal-800"
          >
            {t('room.create')}
          </button>
        </div>
      </div>
    </div>
  );
}
