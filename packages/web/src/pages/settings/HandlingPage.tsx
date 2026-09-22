import { List, ListInput, Segmented, SegmentedButton } from 'konsta/react';
import { ToggleRow } from '../../components/ios/ToggleRow';
import { formatBytes } from '../../lib/format';
import { SettingsSubPage } from './SettingsSubPage';
import { useSettingsDraft } from './useSettingsDraft';

/** Retention, size limits, attachments and duplicate suppression. */
export function HandlingPage() {
    const { draft, loading, error, reload, update } = useSettingsDraft();

    return (
        <SettingsSubPage title="Mail Handling" loading={loading || !draft} error={error ?? null} onRetry={reload}>
            {draft ? (
                <>
                    <List strongIos outlineIos className="!mt-3">
                        <ListInput
                            type="number"
                            label="Auto Cleanup (days)"
                            value={`${draft.autoCleanupDays}`}
                            onChange={(e: any) => update('autoCleanupDays', Number.parseInt(e.target.value, 10) || 0)}
                        />
                        <ListInput
                            type="number"
                            label="Max Size (bytes)"
                            value={`${draft.maxEmailSize}`}
                            onChange={(e: any) => update('maxEmailSize', Number.parseInt(e.target.value, 10) || 0)}
                        />
                    </List>
                    <div className="settings-note">
                        Messages over {formatBytes(draft.maxEmailSize)} count as oversized.
                    </div>
                    <div className="settings-section-title">Oversized Mail</div>
                    <div className="px-4">
                        <Segmented strong className="ios-segmented">
                            <SegmentedButton
                                active={draft.maxEmailSizePolicy === 'truncate'}
                                onClick={() => update('maxEmailSizePolicy', 'truncate')}
                            >
                                Truncate
                            </SegmentedButton>
                            <SegmentedButton
                                active={draft.maxEmailSizePolicy === 'continue'}
                                onClick={() => update('maxEmailSizePolicy', 'continue')}
                            >
                                Continue
                            </SegmentedButton>
                            <SegmentedButton
                                active={draft.maxEmailSizePolicy === 'unhandled'}
                                onClick={() => update('maxEmailSizePolicy', 'unhandled')}
                            >
                                Headers
                            </SegmentedButton>
                        </Segmented>
                    </div>
                    <div className="settings-note">
                        Oversized policy decides whether the body is truncated, parsed fully, or only the headers are
                        kept. A daily cron deletes mail older than Auto Cleanup days, together with its attachments (0
                        keeps everything); use Clear Mail for one-off cleanups.
                    </div>
                    <div className="settings-section-title">Attachments</div>
                    <List strongIos outlineIos className="!mt-0">
                        <ToggleRow
                            title="Auto-save Attachments"
                            subtitle="Store incoming attachments in R2"
                            checked={draft.attachmentSaveEnabled}
                            onChange={value => update('attachmentSaveEnabled', value)}
                        />
                        {draft.attachmentSaveEnabled ? (
                            <ListInput
                                type="number"
                                label="Max Attachment Size (bytes)"
                                value={`${draft.attachmentMaxSize}`}
                                onChange={(e: any) =>
                                    update('attachmentMaxSize', Number.parseInt(e.target.value, 10) || 0)
                                }
                            />
                        ) : null}
                    </List>
                    <div className="settings-note">
                        {!draft.attachmentSaveEnabled
                            ? 'Attachments are not stored, so the Mini App cannot list or serve them.'
                            : draft.attachmentMaxSize > 0
                              ? `Single attachments over ${formatBytes(draft.attachmentMaxSize)} are skipped; the rest stay downloadable in the Mini App until cleanup.`
                              : 'No size limit: every attachment is stored and downloadable in the Mini App until cleanup.'}
                    </div>
                    <div className="settings-note">
                        A repeated Message-ID is always suppressed (mail without a Message-ID falls back to a content
                        hash), so redeliveries do not notify twice.
                    </div>
                </>
            ) : null}
        </SettingsSubPage>
    );
}
