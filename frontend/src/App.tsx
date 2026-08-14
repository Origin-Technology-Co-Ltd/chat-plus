import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createSession,
  deleteSession,
  fetchContacts,
  fetchSessions,
  fetchSettings,
  updateSettings,
  type Contact,
  type Session,
  type Settings,
} from './api/client';
import { ChatView } from './components/ChatView';
import { ContactsPage } from './components/ContactsPage';
import { CreateRoomModal } from './components/CreateRoomModal';
import { RoomChatView } from './components/RoomChatView';
import { SessionSidebar } from './components/SessionSidebar';
import { SettingsPanel } from './components/SettingsPanel';
import { isLocale, resolveFromEnv, type Locale } from './i18n';
import { LocaleProvider, useI18n } from './i18n/LocaleContext';

type ViewMode = 'chat' | 'contacts';

function AppShell() {
  const { t, locale, setLocale } = useI18n();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('chat');
  const [createRoomOpen, setCreateRoomOpen] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsEpoch, setSettingsEpoch] = useState(0);
  const [toast, setToast] = useState<{ type: 'error' | 'info'; message: string } | null>(null);
  const [ready, setReady] = useState(false);

  const bumpSettingsEpoch = useCallback(() => {
    setSettingsEpoch((value) => value + 1);
  }, []);

  const refreshSessions = useCallback(async () => {
    const list = await fetchSessions();
    setSessions(list);
    return list;
  }, []);

  const refreshContacts = useCallback(async () => {
    const list = await fetchContacts();
    setContacts(list);
    return list;
  }, []);

  const applySettings = useCallback(
    (data: Settings) => {
      setSettings(data);
      if (isLocale(data.locale)) {
        setLocale(data.locale);
      }
      return data;
    },
    [setLocale],
  );

  const loadSettings = useCallback(async () => {
    const data = await fetchSettings();
    return applySettings(data);
  }, [applySettings]);

  useEffect(() => {
    void (async () => {
      try {
        const [list, data] = await Promise.all([refreshSessions(), fetchSettings()]);
        let next = data;
        if (data.locale == null) {
          const detected = resolveFromEnv(navigator.languages ?? [navigator.language]);
          next = await updateSettings({ locale: detected });
        }
        applySettings(next);
        if (list.length > 0) {
          setActiveSessionId(list[0].id);
        }
      } catch (error) {
        setToast({
          type: 'error',
          message: error instanceof Error ? error.message : t('app.initFailed'),
        });
      } finally {
        setReady(true);
      }
    })();
    // Bootstrap once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );
  const isRoom = activeSession?.kind === 'room';

  async function handleStartContactChat(contactId: string): Promise<void> {
    try {
      const session = await createSession({
        kind: 'room',
        memberContactIds: [contactId],
      });
      await refreshSessions();
      setViewMode('chat');
      setActiveSessionId(session.id);
    } catch (error) {
      setToast({
        type: 'error',
        message: error instanceof Error ? error.message : t('app.createSessionFailed'),
      });
    }
  }

  async function handleCreateSession(): Promise<void> {
    try {
      const session = await createSession();
      await refreshSessions();
      setViewMode('chat');
      setActiveSessionId(session.id);
    } catch (error) {
      setToast({
        type: 'error',
        message: error instanceof Error ? error.message : t('app.createSessionFailed'),
      });
    }
  }

  async function handleOpenCreateRoom(): Promise<void> {
    try {
      await refreshContacts();
      setCreateRoomOpen(true);
    } catch (error) {
      setToast({
        type: 'error',
        message: error instanceof Error ? error.message : t('contacts.loadFailed'),
      });
    }
  }

  async function handleOpenContacts(): Promise<void> {
    setViewMode('contacts');
    try {
      await refreshContacts();
    } catch (error) {
      setToast({
        type: 'error',
        message: error instanceof Error ? error.message : t('contacts.loadFailed'),
      });
    }
  }

  async function handleDeleteSession(sessionId: string): Promise<void> {
    if (!window.confirm(t('app.deleteSessionConfirm'))) return;

    try {
      await deleteSession(sessionId);
      const list = await refreshSessions();
      if (activeSessionId === sessionId) {
        setActiveSessionId(list[0]?.id ?? null);
      }
    } catch (error) {
      setToast({
        type: 'error',
        message: error instanceof Error ? error.message : t('app.deleteFailed'),
      });
    }
  }

  if (!ready) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-stone-50 text-sm text-stone-500">
        {t('chat.loading')}
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-stone-50 font-sans text-stone-800 antialiased">
      <SessionSidebar
        sessions={sessions}
        activeSessionId={viewMode === 'chat' ? activeSessionId : null}
        onSelect={(id) => {
          setViewMode('chat');
          setActiveSessionId(id);
        }}
        onCreate={() => void handleCreateSession()}
        onCreateRoom={() => void handleOpenCreateRoom()}
        onOpenContacts={() => void handleOpenContacts()}
        onDelete={(id) => void handleDeleteSession(id)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {viewMode === 'contacts' ? (
        <ContactsPage
          profiles={settings?.profiles ?? []}
          onBack={() => setViewMode('chat')}
          onStartChat={(id) => void handleStartContactChat(id)}
          onError={(message) => setToast({ type: 'error', message })}
          onInfo={(message) => setToast({ type: 'info', message })}
        />
      ) : isRoom ? (
        <RoomChatView
          sessionId={activeSessionId}
          contacts={contacts}
          settingsEpoch={settingsEpoch}
          exportAskEachTime={settings?.exportAskEachTime ?? false}
          exportDir={settings?.exportDir ?? '~/Documents/chatplus/exports'}
          onSessionUpdated={() => void refreshSessions()}
          onError={(message) => setToast({ type: 'error', message })}
          onInfo={(message) => setToast({ type: 'info', message })}
        />
      ) : (
        <ChatView
          sessionId={activeSessionId}
          settingsEpoch={settingsEpoch}
          exportAskEachTime={settings?.exportAskEachTime ?? false}
          exportDir={settings?.exportDir ?? '~/Documents/chatplus/exports'}
          profiles={settings?.profiles ?? []}
          defaultProfileId={settings?.defaultProfileId ?? null}
          onSessionUpdated={() => void refreshSessions()}
          onError={(message) => setToast({ type: 'error', message })}
          onInfo={(message) => setToast({ type: 'info', message })}
        />
      )}

      <CreateRoomModal
        contacts={contacts}
        open={createRoomOpen}
        onClose={() => setCreateRoomOpen(false)}
        onCreated={(sessionId) => {
          setViewMode('chat');
          setActiveSessionId(sessionId);
          void refreshSessions();
        }}
        onError={(message) => setToast({ type: 'error', message })}
      />

      <SettingsPanel
        open={settingsOpen}
        locale={locale}
        onLocaleChange={setLocale}
        onClose={() => {
          setSettingsOpen(false);
          void loadSettings().then(bumpSettingsEpoch);
        }}
        onSaved={(next) => {
          applySettings(next);
          bumpSettingsEpoch();
        }}
      />

      {toast ? (
        <div
          className={`fixed bottom-5 right-5 z-50 flex items-center gap-2.5 rounded-xl border bg-white px-4 py-3 text-xs font-medium shadow-pop animate-slide-up ${
            toast.type === 'error' ? 'border-rose-200 text-rose-700' : 'border-teal-200 text-teal-700'
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${toast.type === 'error' ? 'bg-rose-500' : 'bg-teal-500'}`} />
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}

export default function App() {
  const [locale, setLocale] = useState<Locale>(() =>
    resolveFromEnv(
      typeof navigator !== 'undefined'
        ? (navigator.languages ?? [navigator.language])
        : ['en'],
    ),
  );

  return (
    <LocaleProvider locale={locale} setLocale={setLocale}>
      <AppShell />
    </LocaleProvider>
  );
}
