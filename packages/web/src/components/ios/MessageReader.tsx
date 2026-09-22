import type { EmailDetailResponse, SenderRuleAction } from '@mail2telegram/shared';
import { List, ListItem, Preloader, Segmented, SegmentedButton } from 'konsta/react';
import { useEffect, useMemo, useState } from 'react';
import { api, fetchAttachmentBlob } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { useDarkMode } from '../../hooks/useTheme';
import { formatBytes, formatFullDate, initialOf, senderLabel } from '../../lib/format';
import { haptic } from '../../lib/haptics';
import { buildEmailDocument } from '../../lib/sanitize';
import {
    AttachmentIcon,
    CheckIcon,
    EllipsisIcon,
    MailIcon,
    ReplyIcon,
    SpamIcon,
    SparkleIcon,
    StarIcon,
    TrashIcon,
} from './Icons';
import { NavBar } from './NavBar';
import { ReplySheet } from './ReplySheet';

export interface MessageReaderProps {
    emailId: string;
    onChanged?: () => void;
    onDeleted?: () => void;
    /**
     * When provided, a navbar with the native Telegram back button is rendered
     * for the compact (single column) layout. In the split layout the reader has
     * no navigation bar, matching iPadOS Mail.
     */
    onBack?: () => void;
}

/** iOS Mail message view: header, body, attachments and a bottom action bar. */
export function MessageReader({ emailId, onChanged, onDeleted, onBack }: MessageReaderProps) {
    const dark = useDarkMode();
    const { data, loading, error, reload, setData } = useAsync<EmailDetailResponse>(
        () => api.getEmail(emailId),
        [emailId],
    );
    const [showHtml, setShowHtml] = useState(false);
    const [summary, setSummary] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [replyOpen, setReplyOpen] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    // Blocking/trusting a sender writes a persistent rule and files the mail, so
    // the menu asks once before doing it.
    const [pendingRule, setPendingRule] = useState<SenderRuleAction | null>(null);

    const email = data?.email;

    useEffect(() => {
        setShowHtml(false);
        setSummary(null);
        setActionError(null);
        setBusy(null);
        setMenuOpen(false);
        setPendingRule(null);
    }, [emailId]);

    // Escape dismisses the secondary action menu.
    useEffect(() => {
        if (!menuOpen) {
            return;
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setMenuOpen(false);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [menuOpen]);

    useEffect(() => {
        if (email && email.is_read === 0) {
            api.updateEmail(email.id, { isRead: true })
                .then(() => {
                    setData(prev => (prev ? { ...prev, email: { ...prev.email, is_read: 1 } } : prev));
                    onChanged?.();
                })
                .catch(() => {});
        }
    }, [email?.id, email?.is_read]);

    const bodyDocument = useMemo(
        () => (email?.body_html ? buildEmailDocument(email.body_html, dark) : null),
        [email?.body_html, dark],
    );

    if (loading && !data) {
        return (
            <div className="spin-center">
                <Preloader />
            </div>
        );
    }
    if (error || !email || !data) {
        return (
            <div className="reader-empty">
                <div>
                    <p className="mb-3">{error?.message || 'This message could not be loaded.'}</p>
                    <button type="button" className="text-button" onClick={reload}>
                        Try Again
                    </button>
                </div>
            </div>
        );
    }

    const run = async (key: string, task: () => Promise<void>) => {
        setBusy(key);
        setActionError(null);
        try {
            await task();
        } catch (e) {
            setActionError((e as Error).message);
        } finally {
            setBusy(null);
        }
    };

    const toggleStar = () =>
        run('star', async () => {
            const next = email.is_starred === 0;
            haptic.selection();
            await api.updateEmail(email.id, { isStarred: next });
            setData(prev => (prev ? { ...prev, email: { ...prev.email, is_starred: next ? 1 : 0 } } : prev));
            onChanged?.();
        });

    const toggleRead = () =>
        run('read', async () => {
            const markUnread = email.is_read === 1;
            await api.updateEmail(email.id, { isRead: !markUnread });
            setData(prev => (prev ? { ...prev, email: { ...prev.email, is_read: markUnread ? 0 : 1 } } : prev));
            onChanged?.();
        });

    const remove = () =>
        run('delete', async () => {
            haptic.impact();
            await api.deleteEmail(email.id);
            onDeleted?.();
        });

    const summarize = () =>
        run('summary', async () => {
            const result = await api.summarize(email.id);
            setSummary(result.summary);
        });

    const applySenderRule = (action: SenderRuleAction) => {
        setPendingRule(null);
        return run('sender-rule', async () => {
            const result = await api.setSenderRule(email.id, action);
            haptic.notification('success');
            if (result.folder) {
                // The rule re-filed this mail, so the reader shows the new folder.
                setData(prev => (prev ? { ...prev, email: { ...prev.email, folder: result.folder! } } : prev));
            }
            onChanged?.();
        });
    };

    const download = (attachmentId: string, filename: string) =>
        run(attachmentId, async () => {
            const blob = await fetchAttachmentBlob(email.id, attachmentId);
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 10_000);
        });

    const hasHtml = Boolean(email.body_html);
    // Plain text is the default view; emails without a text part fall back to HTML.
    const preferHtml = showHtml || !email.body_text;

    return (
        <div className="reader">
            {/* The subject is already shown in the header below, so the navbar
                only carries the native back button and keeps its title empty. */}
            {onBack ? <NavBar onBack={onBack} /> : null}
            <div className="reader__scroll">
                <div className="reader__head">
                    <h1 className="reader__subject">{email.subject || '(no subject)'}</h1>
                    <div className="reader__from">
                        <span className="reader__avatar" style={{ background: selectedAvatarColor(email.sender) }}>
                            {initialOf(senderLabel(email))}
                        </span>
                        <span className="reader__from-main">
                            <span className="reader__from-name">{senderLabel(email)}</span>
                            <br />
                            <span className="reader__from-addr">{email.sender}</span>
                        </span>
                        <span className="reader__date">
                            {formatFullDate(email.date)}
                            <br />
                            {email.is_starred ? '★ ' : ''}
                            {formatBytes(email.size)}
                        </span>
                    </div>
                    <div className="reader__to">
                        {`To: ${email.recipient}`}
                        {email.cc ? ` · Cc: ${email.cc}` : ''}
                    </div>
                </div>

                {hasHtml && email.body_text ? (
                    <div className="px-4 pb-3">
                        <Segmented strong className="ios-segmented">
                            <SegmentedButton active={!preferHtml} onClick={() => setShowHtml(false)}>
                                Plain Text
                            </SegmentedButton>
                            <SegmentedButton active={preferHtml} onClick={() => setShowHtml(true)}>
                                HTML
                            </SegmentedButton>
                        </Segmented>
                    </div>
                ) : null}

                {preferHtml && bodyDocument ? (
                    <iframe
                        title="Message content"
                        className="reader__frame"
                        sandbox="allow-popups allow-popups-to-escape-sandbox"
                        srcDoc={bodyDocument}
                    />
                ) : (
                    <div className="reader__text">{email.body_text || 'No content.'}</div>
                )}

                {summary ? (
                    <>
                        <div className="reader__section-title">Summary</div>
                        <div className="reader__text">{summary}</div>
                    </>
                ) : null}

                {data.attachments.length > 0 ? (
                    <>
                        <div className="reader__section-title">
                            {data.attachments.length === 1 ? '1 Attachment' : `${data.attachments.length} Attachments`}
                        </div>
                        <List strongIos outlineIos className="!my-0">
                            {data.attachments.map(attachment => (
                                <ListItem
                                    key={attachment.id}
                                    link
                                    media={<AttachmentIcon size={22} />}
                                    onClick={() => download(attachment.id, attachment.filename)}
                                    title={attachment.filename}
                                    after={busy === attachment.id ? 'Saving…' : formatBytes(attachment.size)}
                                />
                            ))}
                        </List>
                    </>
                ) : null}

                {actionError ? (
                    <div className="settings-note" style={{ color: '#ff3b30' }}>
                        {actionError}
                    </div>
                ) : null}
            </div>

            {/* iOS Mail style action bar: the primary actions sit in a pill,
                the rest is folded into the ellipsis menu. */}
            <div className="ios-toolbar">
                {menuOpen ? <div className="ios-toolbar__scrim" onClick={() => setMenuOpen(false)} /> : null}
                {menuOpen ? (
                    <div className="ios-menu" role="menu" aria-label="More actions">
                        <button
                            type="button"
                            role="menuitem"
                            className="ios-menu__item bar-button"
                            disabled={busy === 'read'}
                            onClick={() => {
                                setMenuOpen(false);
                                toggleRead();
                            }}
                        >
                            <MailIcon size={20} />
                            <span>
                                {busy === 'read' ? 'Working…' : email.is_read === 0 ? 'Mark as Read' : 'Mark as Unread'}
                            </span>
                        </button>
                        {data.summaryEnabled ? (
                            <button
                                type="button"
                                role="menuitem"
                                className="ios-menu__item bar-button"
                                disabled={busy === 'summary'}
                                onClick={() => {
                                    setMenuOpen(false);
                                    summarize();
                                }}
                            >
                                <SparkleIcon size={20} />
                                <span>{busy === 'summary' ? 'Working…' : 'Summarize'}</span>
                            </button>
                        ) : null}
                        <button
                            type="button"
                            role="menuitem"
                            className="ios-menu__item bar-button"
                            disabled={busy === 'sender-rule'}
                            onClick={() => {
                                haptic.selection();
                                setMenuOpen(false);
                                setPendingRule('block');
                            }}
                        >
                            <SpamIcon size={20} />
                            <span>Block Sender</span>
                        </button>
                        <button
                            type="button"
                            role="menuitem"
                            className="ios-menu__item bar-button"
                            disabled={busy === 'sender-rule'}
                            onClick={() => {
                                haptic.selection();
                                setMenuOpen(false);
                                setPendingRule('trust');
                            }}
                        >
                            <CheckIcon size={20} />
                            <span>Trust Sender</span>
                        </button>
                    </div>
                ) : null}
                <div className="ios-toolbar__inner">
                    <div className="ios-toolbar__pill">
                        {data.resendEnabled ? (
                            <button
                                type="button"
                                className="ios-toolbar__button bar-button"
                                aria-label="Reply"
                                onClick={() => setReplyOpen(true)}
                            >
                                <ReplyIcon size={24} />
                            </button>
                        ) : null}
                        <button
                            type="button"
                            className="ios-toolbar__button bar-button"
                            aria-label={email.is_starred ? 'Unstar' : 'Star'}
                            aria-pressed={email.is_starred === 1}
                            disabled={busy === 'star'}
                            onClick={toggleStar}
                        >
                            <StarIcon size={24} filled={email.is_starred === 1} />
                        </button>
                        <button
                            type="button"
                            className="ios-toolbar__button ios-toolbar__button--danger bar-button"
                            aria-label="Delete"
                            disabled={busy === 'delete'}
                            onClick={remove}
                        >
                            <TrashIcon size={24} />
                        </button>
                    </div>
                    <button
                        type="button"
                        className="ios-toolbar__more bar-button"
                        aria-label="More actions"
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                        onClick={() => {
                            haptic.selection();
                            setMenuOpen(open => !open);
                        }}
                    >
                        <EllipsisIcon size={24} />
                    </button>
                </div>
            </div>

            {pendingRule ? (
                <div className="ios-menu__scrim" role="presentation" onClick={() => setPendingRule(null)}>
                    <div
                        className="ios-confirm"
                        role="alertdialog"
                        aria-modal="true"
                        aria-label={pendingRule === 'block' ? 'Block sender' : 'Trust sender'}
                        onClick={event => event.stopPropagation()}
                    >
                        <div className="ios-confirm__title">
                            {pendingRule === 'block' ? 'Block this sender?' : 'Trust this sender?'}
                        </div>
                        <div className="ios-confirm__body">
                            {pendingRule === 'block'
                                ? `Mail from ${email.sender} will be moved to Spam and blocked from the inbox from now on.`
                                : `Mail from ${email.sender} will be moved to the inbox and never blocked. Trust wins over the block list.`}
                        </div>
                        <div className="ios-confirm__actions">
                            <button type="button" className="text-button" onClick={() => setPendingRule(null)}>
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="text-button"
                                style={pendingRule === 'block' ? { color: '#ff3b30' } : undefined}
                                disabled={busy === 'sender-rule'}
                                onClick={() => applySenderRule(pendingRule)}
                            >
                                {busy === 'sender-rule' ? 'Working…' : pendingRule === 'block' ? 'Block' : 'Trust'}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
            <ReplySheet opened={replyOpen} emailId={email.id} onClose={() => setReplyOpen(false)} />
        </div>
    );
}

const AVATAR_COLORS = ['#007aff', '#34c759', '#ff9500', '#af52de', '#ff2d55', '#5856d6', '#00c7be'];

function selectedAvatarColor(seed: string): string {
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
        hash = (hash * 31 + seed.charCodeAt(i)) % 997;
    }
    return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}
