import { useEffect, useState } from 'react';
import type { ProfileInput, Settings } from '../api/client';
import { fetchSettings, updateSettings } from '../api/client';
import type { Locale } from '../i18n';
import { translate } from '../i18n';
import { useI18n } from '../i18n/LocaleContext';

type SettingsPanelProps = {
  open: boolean;
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  onClose: () => void;
  onSaved?: (settings: Settings) => void;
};

type DraftProfile = {
  /** Stable React key; may be a temp id for brand-new rows. */
  key: string;
  id?: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  apiKeyMasked: string;
  hasApiKey: boolean;
};

type SettingsTab = 'models' | 'general';

const inputClass =
  'w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 disabled:opacity-40 transition-all';

function blankProfile(): DraftProfile {
  const id = crypto.randomUUID();
  return {
    key: id,
    id,
    name: '',
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: '',
    apiKeyMasked: '',
    hasApiKey: false,
  };
}

export function SettingsPanel({
  open,
  locale,
  onLocaleChange,
  onClose,
  onSaved,
}: SettingsPanelProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<SettingsTab>('models');
  const [profiles, setProfiles] = useState<DraftProfile[]>([]);
  const [defaultProfileKey, setDefaultProfileKey] = useState('');
  const [selectedKey, setSelectedKey] = useState('');
  const [exportDir, setExportDir] = useState('');
  const [exportAskEachTime, setExportAskEachTime] = useState(false);
  const [contextWindow, setContextWindow] = useState(128000);
  const [contextAutoTrim, setContextAutoTrim] = useState(true);
  const [contextKeepRounds, setContextKeepRounds] = useState(20);
  const [contextTargetRatio, setContextTargetRatio] = useState(0.7);
  const [draftLocale, setDraftLocale] = useState<Locale>(locale);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTab('models');
    fetchSettings()
      .then((data) => {
        const drafts: DraftProfile[] = data.profiles.map((p) => ({
          key: p.id,
          id: p.id,
          name: p.name,
          apiKey: '',
          baseUrl: p.baseUrl,
          model: p.model,
          apiKeyMasked: p.apiKeyMasked,
          hasApiKey: p.hasApiKey,
        }));
        const nextProfiles = drafts.length > 0 ? drafts : [blankProfile()];
        setProfiles(nextProfiles);
        const defaultKey =
          nextProfiles.find((p) => p.id === data.defaultProfileId)?.key ??
          nextProfiles[0]?.key ??
          '';
        setDefaultProfileKey(defaultKey);
        setSelectedKey(defaultKey || nextProfiles[0]?.key || '');
        setExportDir(data.exportDir);
        setExportAskEachTime(data.exportAskEachTime);
        setContextWindow(data.contextWindow);
        setContextAutoTrim(data.contextAutoTrim);
        setContextKeepRounds(data.contextKeepRounds);
        setContextTargetRatio(data.contextTargetRatio);
        setDraftLocale(data.locale === 'zh' || data.locale === 'en' ? data.locale : locale);
        setMessage(null);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : t('settings.loadFailed')));
    // Only reload when the panel opens — do not re-fetch on locale change after save
    // (that would clear the success toast and reset unsaved draft fields).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const selectedProfile =
    profiles.find((p) => p.key === selectedKey) ?? profiles[0] ?? null;

  function updateProfile(key: string, patch: Partial<DraftProfile>): void {
    setProfiles((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }

  function addProfile(): void {
    const next = blankProfile();
    setProfiles((prev) => [...prev, next]);
    if (!defaultProfileKey) setDefaultProfileKey(next.key);
    setSelectedKey(next.key);
  }

  function removeProfile(key: string): void {
    setProfiles((prev) => {
      if (prev.length <= 1) return prev;
      const index = prev.findIndex((p) => p.key === key);
      const next = prev.filter((p) => p.key !== key);
      if (defaultProfileKey === key) {
        setDefaultProfileKey(next[0]?.key ?? '');
      }
      if (selectedKey === key) {
        const fallback = next[Math.min(index, next.length - 1)] ?? next[0];
        setSelectedKey(fallback?.key ?? '');
      }
      return next;
    });
  }

  async function handleSave(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      for (const profile of profiles) {
        if (!profile.name.trim() || !profile.model.trim() || !profile.baseUrl.trim()) {
          throw new Error(t('settings.profileFieldsRequired'));
        }
        if (!profile.hasApiKey && !profile.apiKey.trim()) {
          throw new Error(
            t('settings.profileApiKeyRequired', {
              name: profile.name || t('settings.unnamed'),
            }),
          );
        }
      }

      const payloadProfiles: ProfileInput[] = profiles.map((p) => {
        const item: ProfileInput = {
          name: p.name.trim(),
          baseUrl: p.baseUrl.trim(),
          model: p.model.trim(),
        };
        if (p.id) item.id = p.id;
        if (p.apiKey.trim()) item.apiKey = p.apiKey.trim();
        return item;
      });

      const defaultProfile =
        profiles.find((p) => p.key === defaultProfileKey) ?? profiles[0];
      const defaultProfileId = defaultProfile?.id;

      const updated = await updateSettings({
        profiles: payloadProfiles,
        defaultProfileId,
        exportDir,
        exportAskEachTime,
        contextWindow,
        contextAutoTrim,
        contextKeepRounds,
        contextTargetRatio,
        locale: draftLocale,
      });

      const drafts: DraftProfile[] = updated.profiles.map((p) => ({
        key: p.id,
        id: p.id,
        name: p.name,
        apiKey: '',
        baseUrl: p.baseUrl,
        model: p.model,
        apiKeyMasked: p.apiKeyMasked,
        hasApiKey: p.hasApiKey,
      }));
      setProfiles(drafts);
      const nextDefault =
        drafts.find((p) => p.id === updated.defaultProfileId)?.key ?? drafts[0]?.key ?? '';
      setDefaultProfileKey(nextDefault);
      setSelectedKey((prev) =>
        drafts.some((p) => p.key === prev) ? prev : nextDefault,
      );
      onLocaleChange(draftLocale);
      setMessage(translate(draftLocale, 'settings.saved'));
      onSaved?.(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  const tabBtn = (id: SettingsTab, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setTab(id)}
      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
        tab === id
          ? 'bg-teal-600 text-white'
          : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 p-4 animate-fade-in">
      <div className="flex h-[min(640px,85vh)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white p-6 shadow-pop animate-pop-in text-stone-800">
        <div className="mb-4 flex shrink-0 items-center justify-between border-b border-stone-100 pb-3">
          <h2 className="text-base font-semibold text-stone-900">{t('settings.title')}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700 transition-colors"
            aria-label={t('settings.close')}
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mb-4 flex shrink-0 gap-1 rounded-xl bg-stone-100 p-1">
          {tabBtn('models', t('settings.tabModels'))}
          {tabBtn('general', t('settings.tabGeneral'))}
        </div>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => void handleSave(e)}
        >
          <div className="min-h-0 flex-1 overflow-hidden pr-0">
            {tab === 'models' ? (
              <div className="flex h-full min-h-0 gap-3">
                <div className="flex w-[11.5rem] shrink-0 flex-col rounded-xl border border-stone-200 bg-stone-50/80">
                  <div className="flex items-center justify-between gap-1 border-b border-stone-200 px-2 py-2">
                    <span className="text-[11px] font-medium text-stone-500">{t('settings.profiles')}</span>
                    <button
                      type="button"
                      onClick={addProfile}
                      className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-teal-700 hover:bg-teal-50 transition-colors"
                    >
                      {t('settings.add')}
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5">
                    {profiles.map((profile) => {
                      const title = profile.name.trim() || t('settings.unnamed');
                      const active = profile.key === (selectedProfile?.key ?? '');
                      return (
                        <button
                          key={profile.key}
                          type="button"
                          onClick={() => setSelectedKey(profile.key)}
                          className={`flex w-full items-center gap-1.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                            active
                              ? 'bg-white text-stone-900 shadow-sm ring-1 ring-stone-200'
                              : 'text-stone-600 hover:bg-white/70 hover:text-stone-900'
                          }`}
                        >
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">
                            {title}
                          </span>
                          {defaultProfileKey === profile.key ? (
                            <span className="shrink-0 rounded bg-teal-50 px-1 py-0.5 text-[9px] font-medium text-teal-700">
                              {t('settings.defaultBadge')}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="min-h-0 min-w-0 flex-1 overflow-y-auto rounded-xl border border-stone-200 bg-white p-4">
                  {selectedProfile ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="truncate text-sm font-semibold text-stone-900">
                          {selectedProfile.name.trim() || t('settings.unnamed')}
                        </h3>
                        <div className="flex shrink-0 items-center gap-2">
                          <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-stone-600 cursor-pointer">
                            <input
                              type="radio"
                              name="default-profile"
                              checked={defaultProfileKey === selectedProfile.key}
                              onChange={() => setDefaultProfileKey(selectedProfile.key)}
                              className="h-3.5 w-3.5 border-stone-300 text-teal-600 focus:ring-teal-500"
                            />
                            {t('settings.setDefault')}
                          </label>
                          <button
                            type="button"
                            disabled={profiles.length <= 1}
                            onClick={() => removeProfile(selectedProfile.key)}
                            className="rounded-md px-1.5 py-0.5 text-[11px] text-rose-600 hover:bg-rose-50 disabled:opacity-30 transition-colors"
                          >
                            {t('settings.delete')}
                          </button>
                        </div>
                      </div>

                      <label className="block text-xs font-medium text-stone-700">
                        <span className="mb-1 block text-stone-500">{t('settings.displayName')}</span>
                        <input
                          value={selectedProfile.name}
                          onChange={(event) =>
                            updateProfile(selectedProfile.key, { name: event.target.value })
                          }
                          className={inputClass}
                          placeholder={t('settings.displayNamePlaceholder')}
                        />
                      </label>

                      <label className="block text-xs font-medium text-stone-700">
                        <span className="mb-1 block text-stone-500">{t('settings.apiKey')}</span>
                        <input
                          type="password"
                          value={selectedProfile.apiKey}
                          onChange={(event) =>
                            updateProfile(selectedProfile.key, { apiKey: event.target.value })
                          }
                          placeholder={
                            selectedProfile.hasApiKey
                              ? t('settings.apiKeySaved', { masked: selectedProfile.apiKeyMasked })
                              : 'sk-...'
                          }
                          className={inputClass}
                        />
                      </label>

                      <label className="block text-xs font-medium text-stone-700">
                        <span className="mb-1 block text-stone-500">Base URL</span>
                        <input
                          value={selectedProfile.baseUrl}
                          onChange={(event) =>
                            updateProfile(selectedProfile.key, { baseUrl: event.target.value })
                          }
                          className={inputClass}
                        />
                      </label>

                      <label className="block text-xs font-medium text-stone-700">
                        <span className="mb-1 block text-stone-500">{t('settings.modelName')}</span>
                        <input
                          value={selectedProfile.model}
                          onChange={(event) =>
                            updateProfile(selectedProfile.key, { model: event.target.value })
                          }
                          className={inputClass}
                          placeholder="gpt-4o-mini"
                        />
                      </label>
                    </div>
                  ) : (
                    <p className="text-sm text-stone-400">{t('settings.selectOrAddProfile')}</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="h-full space-y-4 overflow-y-auto pr-1">
                <label className="block text-xs font-medium text-stone-700">
                  <span className="mb-1 block text-stone-500">{t('settings.language')}</span>
                  <select
                    value={draftLocale}
                    onChange={(event) => setDraftLocale(event.target.value as Locale)}
                    className={inputClass}
                  >
                    <option value="en">{t('settings.languageEn')}</option>
                    <option value="zh">{t('settings.languageZh')}</option>
                  </select>
                </label>

                <label className="block text-xs font-medium text-stone-700">
                  <span className="mb-1 block text-stone-500">{t('settings.exportDir')}</span>
                  <input
                    value={exportDir}
                    onChange={(event) => setExportDir(event.target.value)}
                    className={inputClass}
                  />
                </label>

                <label className="flex items-center gap-2 text-xs font-medium text-stone-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={exportAskEachTime}
                    onChange={(event) => setExportAskEachTime(event.target.checked)}
                    className="h-3.5 w-3.5 rounded border-stone-300 text-teal-600 focus:ring-teal-500"
                  />
                  {t('settings.exportAskEachTime')}
                </label>

                <div className="border-t border-stone-100 pt-4">
                  <h3 className="mb-3 text-xs font-semibold text-stone-900">{t('settings.contextStrategy')}</h3>
                  <p className="mb-3 text-[11px] text-stone-500">{t('settings.contextStrategyHint')}</p>

                  <label className="mb-3 block text-xs font-medium text-stone-700">
                    <span className="mb-1 block text-stone-500">{t('settings.contextWindow')}</span>
                    <input
                      type="number"
                      min={1024}
                      value={contextWindow}
                      onChange={(event) => setContextWindow(Number(event.target.value))}
                      className={inputClass}
                    />
                  </label>

                  <label className="mb-3 flex items-center gap-2 text-xs font-medium text-stone-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={contextAutoTrim}
                      onChange={(event) => setContextAutoTrim(event.target.checked)}
                      className="h-3.5 w-3.5 rounded border-stone-300 text-teal-600 focus:ring-teal-500"
                    />
                    {t('settings.autoTrim')}
                  </label>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-xs font-medium text-stone-700">
                      <span className="mb-1 block text-stone-500">{t('settings.keepRounds')}</span>
                      <input
                        type="number"
                        min={1}
                        value={contextKeepRounds}
                        onChange={(event) => setContextKeepRounds(Number(event.target.value))}
                        disabled={!contextAutoTrim}
                        className={inputClass}
                      />
                    </label>

                    <label className="block text-xs font-medium text-stone-700">
                      <span className="mb-1 block text-stone-500">{t('settings.targetRatio')}</span>
                      <input
                        type="number"
                        min={0.1}
                        max={1}
                        step={0.05}
                        value={contextTargetRatio}
                        onChange={(event) => setContextTargetRatio(Number(event.target.value))}
                        disabled={!contextAutoTrim}
                        className={inputClass}
                      />
                    </label>
                  </div>
                </div>
              </div>
            )}
          </div>

          {error ? <p className="mt-3 shrink-0 text-xs text-rose-600 font-medium">{error}</p> : null}
          {message ? <p className="mt-3 shrink-0 text-xs text-teal-700 font-medium">{message}</p> : null}

          <div className="mt-3 flex shrink-0 justify-end gap-2 border-t border-stone-100 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-xs font-medium text-stone-600 hover:bg-stone-100 transition-colors"
            >
              {t('settings.cancel')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-teal-600 px-4 py-2 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-50 transition-colors active:bg-teal-800"
            >
              {saving ? t('settings.saving') : t('settings.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
