import { List, ListItem, Preloader } from 'konsta/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import { CheckIcon } from '../../components/ios/Icons';
import { ToggleRow } from '../../components/ios/ToggleRow';
import { useAsync } from '../../hooks/useAsync';
import { haptic } from '../../lib/haptics';
import { SettingsSubPage } from './SettingsSubPage';

interface CleanupRange {
    key: string;
    label: string;
    days?: number;
    all?: boolean;
}

const RANGES: CleanupRange[] = [
    { key: '1d', label: 'Older than 1 Day', days: 1 },
    { key: '3d', label: 'Older than 3 Days', days: 3 },
    { key: '7d', label: 'Older than 7 Days', days: 7 },
    { key: '30d', label: 'Older than 1 Month', days: 30 },
    { key: 'all', label: 'All Mail', all: true },
];

/** How long the armed confirm state stays active before it resets. */
const CONFIRM_RESET_MS = 4000;

interface ActionState {
    status: 'idle' | 'running' | 'ok' | 'error';
    message?: string;
}

function plural(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** Bulk cleanup: permanently remove mail by age, or just free the attachments. */
export function CleanupPage() {
    const [rangeKey, setRangeKey] = useState('7d');
    const [attachmentsOnly, setAttachmentsOnly] = useState(false);
    const [armed, setArmed] = useState(false);
    const [result, setResult] = useState<ActionState>({ status: 'idle' });
    const armTimer = useRef<number | null>(null);

    const range = RANGES.find(item => item.key === rangeKey) ?? RANGES[2];
    const preview = useAsync(() => api.previewCleanup({ days: range.days, all: range.all }), [range.key]);

    const disarm = useCallback(() => {
        setArmed(false);
        if (armTimer.current !== null) {
            clearTimeout(armTimer.current);
            armTimer.current = null;
        }
    }, []);

    useEffect(() => () => disarm(), [disarm]);

    // Changing the selection invalidates both the confirm state and the
    // previous run's outcome.
    useEffect(() => {
        disarm();
        setResult({ status: 'idle' });
    }, [rangeKey, attachmentsOnly, disarm]);

    const run = async () => {
        if (result.status === 'running') {
            return;
        }
        haptic.impact();
        if (!armed) {
            setArmed(true);
            armTimer.current = window.setTimeout(disarm, CONFIRM_RESET_MS);
            return;
        }
        disarm();
        setResult({ status: 'running' });
        try {
            const outcome = await api.cleanupEmails({ days: range.days, all: range.all, attachmentsOnly });
            let message = attachmentsOnly
                ? `Removed ${plural(outcome.attachments, 'attachment')}.`
                : `Removed ${plural(outcome.emails, 'message')} and ${plural(outcome.attachments, 'attachment')}.`;
            if (outcome.remaining > 0) {
                message += ` ${plural(outcome.remaining, 'message')} in range remain — run again to continue.`;
            }
            setResult({ status: 'ok', message });
            haptic.notification('success');
        } catch (e) {
            setResult({ status: 'error', message: (e as Error).message });
            haptic.notification('error');
        }
        preview.reload();
    };

    const counts = preview.data;
    const note = counts
        ? attachmentsOnly
            ? counts.attachments > 0
                ? `Will remove ${plural(counts.attachments, 'attachment')}; the messages themselves are kept.`
                : 'No attachments in this range.'
            : counts.emails > 0
              ? `Will permanently remove ${plural(counts.emails, 'message')} and ${plural(counts.attachments, 'attachment')}.`
              : 'Nothing to clear in this range.'
        : 'Counting…';

    const actionTitle = result.status === 'running' ? 'Clearing…' : armed ? 'Tap Again to Confirm' : 'Clear Mail';

    return (
        <SettingsSubPage title="Clear Mail">
            <div className="settings-section-title">Delete Range</div>
            <List strongIos outlineIos className="!mt-0">
                {RANGES.map(item => (
                    <ListItem
                        key={item.key}
                        title={item.label}
                        after={
                            item.key === rangeKey ? (
                                <CheckIcon size={20} className="text-[var(--ios-blue)]" />
                            ) : undefined
                        }
                        onClick={() => {
                            haptic.selection();
                            setRangeKey(item.key);
                        }}
                    />
                ))}
            </List>
            <div className="settings-note">{preview.error ? preview.error.message : note}</div>

            <div className="settings-section-title">Options</div>
            <List strongIos outlineIos className="!mt-0">
                <ToggleRow
                    title="Attachments Only"
                    subtitle="Keep the messages, delete their stored attachments"
                    checked={attachmentsOnly}
                    onChange={setAttachmentsOnly}
                />
            </List>

            <div className="settings-section-title">Action</div>
            <List strongIos outlineIos className="!mt-0">
                <ListItem
                    title={<span style={{ color: '#ff3b30' }}>{actionTitle}</span>}
                    after={result.status === 'running' ? <Preloader /> : undefined}
                    className={result.status === 'running' ? 'opacity-60' : ''}
                    onClick={run}
                />
            </List>
            <div className="settings-note">
                Cleanup permanently erases mail from the worker database and deletes stored attachments, so removed mail
                cannot be recovered. Starred mail is never removed.
            </div>
            {result.message ? (
                <div
                    className="settings-note"
                    style={{ color: result.status === 'error' ? '#ff3b30' : 'var(--ios-gray)' }}
                >
                    {result.message}
                </div>
            ) : null}
        </SettingsSubPage>
    );
}
