import { useCallback, useEffect, useState } from 'react';
import type { Contact, ModelProfilePublic } from '../api/client';
import {
  createContact,
  deleteContact,
  fetchContacts,
  updateContact,
} from '../api/client';
import { useI18n } from '../i18n/LocaleContext';

type ContactsPageProps = {
  profiles: ModelProfilePublic[];
  onBack: () => void;
  onStartChat: (contactId: string) => void;
  onError: (message: string) => void;
  onInfo: (message: string) => void;
};

type Draft = {
  id: string | null;
  name: string;
  modelProfileId: string;
  personalityPrompt: string;
};

const inputClass =
  'w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 disabled:opacity-40 transition-all';

function blankDraft(profiles: ModelProfilePublic[]): Draft {
  return {
    id: null,
    name: '',
    modelProfileId: profiles[0]?.id ?? '',
    personalityPrompt: '',
  };
}

export function ContactsPage({ profiles, onBack, onStartChat, onError, onInfo: _onInfo }: ContactsPageProps) {
  const { t } = useI18n();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => blankDraft(profiles));
  const [editing, setEditing] = useState(false);

  const reload = useCallback(async () => {
    const list = await fetchContacts();
    setContacts(list);
    return list;
  }, []);

  useEffect(() => {
    setLoading(true);
    reload()
      .catch((err) => onError(err instanceof Error ? err.message : t('contacts.loadFailed')))
      .finally(() => setLoading(false));
  }, [onError, reload, t]);

  function startCreate(): void {
    setDraft(blankDraft(profiles));
    setEditing(true);
  }

  function startEdit(contact: Contact): void {
    setDraft({
      id: contact.id,
      name: contact.name,
      modelProfileId: contact.model_profile_id,
      personalityPrompt: contact.personality_prompt,
    });
    setEditing(true);
  }

  function cancelEdit(): void {
    setEditing(false);
    setDraft(blankDraft(profiles));
  }

  async function handleSave(): Promise<void> {
    const name = draft.name.trim();
    if (!name || !draft.modelProfileId || saving) return;

    setSaving(true);
    try {
      if (draft.id) {
        await updateContact(draft.id, {
          name,
          modelProfileId: draft.modelProfileId,
          personalityPrompt: draft.personalityPrompt,
        });
      } else {
        await createContact({
          name,
          modelProfileId: draft.modelProfileId,
          personalityPrompt: draft.personalityPrompt,
        });
      }
      await reload();
      setEditing(false);
      setDraft(blankDraft(profiles));
    } catch (err) {
      onError(err instanceof Error ? err.message : t('contacts.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(contact: Contact): Promise<void> {
    if (!window.confirm(t('contacts.deleteConfirm'))) return;
    try {
      await deleteContact(contact.id);
      await reload();
      if (draft.id === contact.id) cancelEdit();
    } catch (err) {
      onError(err instanceof Error ? err.message : t('contacts.deleteFailed'));
    }
  }

  const profileName = (id: string) =>
    profiles.find((p) => p.id === id)?.name?.trim() || t('chat.unnamed');

  return (
    <main className="relative flex flex-1 flex-col bg-white">
      <header className="flex shrink-0 items-center justify-between border-b border-stone-200 bg-white px-6 py-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight text-stone-900">
            {t('contacts.title')}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={startCreate}
            className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 transition-colors"
          >
            {t('contacts.add')}
          </button>
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50 transition-colors"
          >
            {t('contacts.back')}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <p className="text-sm text-stone-400">{t('chat.loading')}</p>
          ) : contacts.length === 0 && !editing ? (
            <p className="py-12 text-center text-sm text-stone-400">{t('contacts.empty')}</p>
          ) : (
            <ul className="space-y-2">
              {contacts.map((contact) => (
                <li
                  key={contact.id}
                  className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 transition-colors ${
                    draft.id === contact.id
                      ? 'border-teal-200 bg-teal-50/50'
                      : 'border-stone-200 bg-stone-50/50 hover:bg-stone-50'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => startEdit(contact)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="truncate text-sm font-medium text-stone-800">{contact.name}</div>
                    <div className="mt-0.5 truncate text-xs text-stone-500">
                      {profileName(contact.model_profile_id)}
                    </div>
                    {contact.personality_prompt.trim() ? (
                      <p className="mt-1 line-clamp-2 text-xs text-stone-400">
                        {contact.personality_prompt}
                      </p>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    onClick={() => onStartChat(contact.id)}
                    className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 transition-colors"
                  >
                    {t('contacts.chat')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(contact)}
                    className="shrink-0 rounded-md px-2 py-1 text-xs text-stone-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                  >
                    {t('contacts.delete')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {editing ? (
          <aside className="w-80 shrink-0 overflow-y-auto border-l border-stone-200 bg-stone-50/80 p-5">
            <h3 className="mb-4 text-sm font-semibold text-stone-800">
              {draft.id ? t('contacts.save') : t('contacts.add')}
            </h3>
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-stone-600">
                  {t('contacts.name')}
                </span>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  className={inputClass}
                  autoFocus
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-stone-600">
                  {t('contacts.profile')}
                </span>
                <select
                  value={draft.modelProfileId}
                  onChange={(e) => setDraft((d) => ({ ...d, modelProfileId: e.target.value }))}
                  className={inputClass}
                  disabled={profiles.length === 0}
                >
                  {profiles.length === 0 ? (
                    <option value="">{t('settings.selectOrAddProfile')}</option>
                  ) : (
                    profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name.trim() || t('chat.unnamed')}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-stone-600">
                  {t('contacts.personality')}
                </span>
                <textarea
                  value={draft.personalityPrompt}
                  onChange={(e) => setDraft((d) => ({ ...d, personalityPrompt: e.target.value }))}
                  rows={6}
                  className={`${inputClass} resize-y`}
                />
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-100 transition-colors"
                >
                  {t('room.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving || !draft.name.trim() || !draft.modelProfileId}
                  className="rounded-lg bg-teal-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-40 transition-colors"
                >
                  {t('contacts.save')}
                </button>
              </div>
            </div>
          </aside>
        ) : null}
      </div>
    </main>
  );
}
