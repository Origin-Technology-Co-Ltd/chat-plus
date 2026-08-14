import { useEffect, useState } from 'react';
import type { Contact, HostType } from '../api/client';
import { useI18n } from '../i18n/LocaleContext';

export type MeetingLimitKind = 'rounds' | 'minutes';

export type StartMeetingInput = {
  goal: string;
  hostType: HostType;
  hostContactId?: string;
  maxRounds: number;
  maxMinutes: number;
  speakGapSec: number;
  continueHistory: boolean;
};

type StartMeetingModalProps = {
  members: Contact[];
  open: boolean;
  onClose: () => void;
  onStart: (input: StartMeetingInput) => void;
};

const GAP_OPTIONS = [3, 5, 8, 15, 30];

export function StartMeetingModal({
  members,
  open,
  onClose,
  onStart,
}: StartMeetingModalProps) {
  const { t } = useI18n();
  const [goal, setGoal] = useState('');
  const [hostType, setHostType] = useState<HostType>('user');
  const [hostContactId, setHostContactId] = useState(members[0]?.id ?? '');
  const [limitKind, setLimitKind] = useState<MeetingLimitKind>('rounds');
  const [maxRounds, setMaxRounds] = useState(20);
  const [maxMinutes, setMaxMinutes] = useState(15);
  const [speakGapSec, setSpeakGapSec] = useState(8);
  const [continueHistory, setContinueHistory] = useState(true);

  useEffect(() => {
    if (open) {
      setGoal('');
      setHostType('user');
      setHostContactId(members[0]?.id ?? '');
      setLimitKind('rounds');
      setMaxRounds(20);
      setMaxMinutes(15);
      setSpeakGapSec(8);
      setContinueHistory(true);
    }
  }, [open, members]);

  if (!open) return null;

  const canStart =
    goal.trim().length > 0 &&
    members.length >= 2 &&
    (hostType === 'user' || (hostType === 'ai' && hostContactId));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/30 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-pop">
        <h2 className="mb-4 text-base font-semibold">{t('meeting.startTitle')}</h2>
        <label className="mb-3 block text-xs font-medium text-stone-600">
          {t('meeting.goal')}
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15"
          />
        </label>
        <fieldset className="mb-3">
          <legend className="mb-1 text-xs font-medium text-stone-600">{t('meeting.host')}</legend>
          <label className="mr-4 text-sm">
            <input
              type="radio"
              checked={hostType === 'user'}
              onChange={() => setHostType('user')}
              className="mr-1"
            />
            {t('meeting.hostUser')}
          </label>
          <label className="text-sm">
            <input
              type="radio"
              checked={hostType === 'ai'}
              onChange={() => setHostType('ai')}
              className="mr-1"
            />
            {t('meeting.hostAiOption')}
          </label>
        </fieldset>
        {hostType === 'ai' ? (
          <select
            value={hostContactId}
            onChange={(e) => setHostContactId(e.target.value)}
            className="mb-3 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm"
          >
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        ) : null}

        <fieldset className="mb-3">
          <legend className="mb-1 text-xs font-medium text-stone-600">{t('meeting.limitKind')}</legend>
          <label className="mr-4 text-sm">
            <input
              type="radio"
              checked={limitKind === 'rounds'}
              onChange={() => setLimitKind('rounds')}
              className="mr-1"
            />
            {t('meeting.limitRounds')}
          </label>
          <label className="text-sm">
            <input
              type="radio"
              checked={limitKind === 'minutes'}
              onChange={() => setLimitKind('minutes')}
              className="mr-1"
            />
            {t('meeting.limitMinutes')}
          </label>
        </fieldset>
        {limitKind === 'rounds' ? (
          <label className="mb-3 block text-xs font-medium text-stone-600">
            {t('meeting.maxRounds')}
            <input
              type="number"
              min={1}
              max={200}
              value={maxRounds}
              onChange={(e) => setMaxRounds(Number(e.target.value) || 20)}
              className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm"
            />
          </label>
        ) : (
          <label className="mb-3 block text-xs font-medium text-stone-600">
            {t('meeting.maxMinutes')}
            <input
              type="number"
              min={1}
              max={180}
              value={maxMinutes}
              onChange={(e) => setMaxMinutes(Number(e.target.value) || 15)}
              className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm"
            />
          </label>
        )}

        <label className="mb-3 block text-xs font-medium text-stone-600">
          {t('meeting.speakGap')}
          <select
            value={speakGapSec}
            onChange={(e) => setSpeakGapSec(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm"
          >
            {GAP_OPTIONS.map((sec) => (
              <option key={sec} value={sec}>
                {t('meeting.speakGapOption', { sec: String(sec) })}
              </option>
            ))}
          </select>
        </label>

        <label className="mb-4 flex items-start gap-2 text-sm text-stone-700">
          <input
            type="checkbox"
            checked={continueHistory}
            onChange={(e) => setContinueHistory(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">{t('meeting.continueHistory')}</span>
            <span className="mt-0.5 block text-xs text-stone-500">{t('meeting.continueHistoryHint')}</span>
          </span>
        </label>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-xs text-stone-600 hover:bg-stone-100">
            {t('room.cancel')}
          </button>
          <button
            type="button"
            disabled={!canStart}
            onClick={() => {
              onStart({
                goal: goal.trim(),
                hostType,
                hostContactId: hostType === 'ai' ? hostContactId : undefined,
                maxRounds: limitKind === 'rounds' ? maxRounds : 0,
                maxMinutes: limitKind === 'minutes' ? maxMinutes : 0,
                speakGapSec,
                continueHistory,
              });
              onClose();
            }}
            className="rounded-lg bg-teal-600 px-4 py-2 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-40"
          >
            {t('meeting.start')}
          </button>
        </div>
      </div>
    </div>
  );
}
