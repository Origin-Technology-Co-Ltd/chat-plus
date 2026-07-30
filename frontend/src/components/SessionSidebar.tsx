import type { Session } from '../api/client';
import { useI18n } from '../i18n/LocaleContext';

type SessionSidebarProps = {
  sessions: Session[];
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onCreate: () => void;
  onCreateRoom: () => void;
  onOpenContacts: () => void;
  onDelete: (sessionId: string) => void;
  onOpenSettings: () => void;
};

export function SessionSidebar({
  sessions,
  activeSessionId,
  onSelect,
  onCreate,
  onCreateRoom,
  onOpenContacts,
  onDelete,
  onOpenSettings,
}: SessionSidebarProps) {
  const { t, locale } = useI18n();

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-stone-200 bg-stone-50">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-600 text-sm font-bold text-white">
          C
        </span>
        <h1 className="text-[15px] font-semibold tracking-tight text-stone-900">ChatPlus</h1>
      </div>

      {/* New chat / room / contacts */}
      <div className="space-y-1.5 px-3 pb-3">
        <button
          type="button"
          onClick={onCreate}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-teal-700 active:bg-teal-800"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          {t('sidebar.newChat')}
        </button>
        <button
          type="button"
          onClick={onCreateRoom}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-medium text-teal-800 transition-colors duration-150 hover:bg-teal-100"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          {t('sidebar.newRoom')}
        </button>
        <button
          type="button"
          onClick={onOpenContacts}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-stone-700 transition-colors duration-150 hover:bg-stone-100"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
            />
          </svg>
          {t('sidebar.contacts')}
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-3 pb-2">
        {sessions.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs text-stone-400">{t('sidebar.empty')}</p>
        ) : (
          <ul className="space-y-0.5">
            {sessions.map((session) => {
              const active = session.id === activeSessionId;
              return (
                <li key={session.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => onSelect(session.id)}
                    className={`w-full rounded-lg px-3 py-2 text-left transition-colors duration-150 ${
                      active ? 'bg-teal-50' : 'hover:bg-stone-100'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 pr-6">
                      <div
                        className={`min-w-0 flex-1 truncate text-sm leading-snug ${
                          active ? 'font-medium text-teal-900' : 'text-stone-700'
                        }`}
                      >
                        {session.title}
                      </div>
                      {session.kind === 'room' ? (
                        <span
                          className={`shrink-0 rounded px-1 py-px text-[9px] font-bold leading-none ${
                            active
                              ? 'bg-teal-200/80 text-teal-900'
                              : 'bg-stone-200 text-stone-600'
                          }`}
                        >
                          {t('sidebar.roomBadge')}
                        </span>
                      ) : null}
                    </div>
                    <div className={`mt-0.5 text-[11px] ${active ? 'text-teal-600/70' : 'text-stone-400'}`}>
                      {new Date(session.updated_at).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en', {
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(session.id);
                    }}
                    className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md text-stone-400 opacity-0 transition-all duration-150 hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100"
                    title={t('sidebar.deleteSession')}
                    aria-label={t('sidebar.deleteSession')}
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Settings entry pinned at bottom */}
      <div className="border-t border-stone-200 p-3">
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-stone-600 transition-colors duration-150 hover:bg-stone-100 hover:text-stone-900"
        >
          <svg className="h-4 w-4 text-stone-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          {t('sidebar.settings')}
        </button>
      </div>
    </aside>
  );
}
