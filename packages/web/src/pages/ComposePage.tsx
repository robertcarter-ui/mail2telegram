import type { ChangeEvent, KeyboardEvent, ReactNode } from 'react';
import { useRef, useState } from 'react';
import { api } from '../api/client';
import { useApp } from '../AppContext';
import { AttachmentIcon, CloseIcon } from '../components/ios/Icons';
import { formatBytes } from '../lib/format';
import { haptic } from '../lib/haptics';

export interface ComposePageProps {
    onClose: () => void;
    /** Called after a mail went out, so the caller can refresh and navigate. */
    onSent: () => void;
}

/** Resend rejects requests larger than 40 MB; keep the client honest early. */
const ATTACHMENT_LIMIT = 40 * 1024 * 1024;

const FROM_STORAGE_KEY = 'mail2telegram.compose-from';

async function fileToBase64(file: File): Promise<string> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    // String.fromCharCode has an argument-count limit, so encode in chunks.
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
}

function fieldRow(label: string, input: ReactNode, trailing?: ReactNode) {
    return (
        <div className="compose__row">
            <span className="compose__label">{label}</span>
            {input}
            {trailing}
        </div>
    );
}

/**
 * iOS Mail style full-screen composer. Sends through the worker's Resend
 * integration, so the sender can be any address on a domain the Resend
 * account owns.
 */
export function ComposePage({ onClose, onSent }: ComposePageProps) {
    const { me } = useApp();
    // The worker host is also the deployment's mail domain, so it only feeds
    // the placeholder — the sender itself is free text.
    const domain = window.location.hostname;
    // Remember the last sender between visits; it starts empty and the
    // placeholder shows the deployment's own domain.
    const [from, setFrom] = useState(() => localStorage.getItem(FROM_STORAGE_KEY) || '');
    const [to, setTo] = useState('');
    const [cc, setCc] = useState('');
    const [bcc, setBcc] = useState('');
    const [showCcBcc, setShowCcBcc] = useState(false);
    const [subject, setSubject] = useState('');
    const [text, setText] = useState('');
    const [files, setFiles] = useState<{ id: string; file: File }[]>([]);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    const ready = Boolean(from.trim()) && Boolean(to.trim()) && Boolean(subject.trim()) && Boolean(text.trim());
    const enabled = ready && !sending && me.resendEnabled;

    const close = () => {
        if (sending) {
            return;
        }
        onClose();
    };

    const addFiles = (event: ChangeEvent<HTMLInputElement>) => {
        const picked = Array.from(event.target.files ?? []);
        event.target.value = '';
        if (picked.length === 0) {
            return;
        }
        const total = [...files.map(entry => entry.file), ...picked].reduce((sum, file) => sum + file.size, 0);
        if (total > ATTACHMENT_LIMIT) {
            haptic.notification('error');
            setError('Attachments exceed the 40 MB limit');
            return;
        }
        setError(null);
        setFiles(prev => [...prev, ...picked.map(file => ({ id: crypto.randomUUID(), file }))]);
    };

    const send = async () => {
        if (!enabled) {
            return;
        }
        setSending(true);
        setError(null);
        try {
            const attachments = await Promise.all(
                files.map(async ({ file }) => ({
                    filename: file.name,
                    mimetype: file.type || 'application/octet-stream',
                    content: await fileToBase64(file),
                    size: file.size,
                })),
            );
            await api.sendEmail({
                from: from.trim(),
                to: to.trim(),
                cc: cc.trim() || undefined,
                bcc: bcc.trim() || undefined,
                subject: subject.trim(),
                text,
                attachments,
            });
            haptic.notification('success');
            localStorage.setItem(FROM_STORAGE_KEY, from.trim());
            onSent();
        } catch (e) {
            haptic.notification('error');
            setError((e as Error).message);
            setSending(false);
        }
    };

    // Desktop conveniences: Escape cancels, Cmd/Ctrl+Enter sends.
    const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            close();
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void send();
        }
    };

    if (!me.resendEnabled) {
        return (
            <div className="split-column">
                <div className="compose">
                    <div className="compose__bar">
                        <button type="button" className="bar-button text-button !my-0 !px-0" onClick={onClose}>
                            Cancel
                        </button>
                        <span className="text-[17px] font-semibold">New Message</span>
                        <span className="text-button !my-0 !px-0 opacity-40">Send</span>
                    </div>
                    <div className="empty-state">
                        <div className="empty-state__title">Sending Unavailable</div>
                        <div className="empty-state__subtitle">
                            Configure RESEND_API_KEY on the worker to send mail.
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="split-column">
            <div className="compose">
                <div className="compose__bar">
                    <button
                        type="button"
                        className="bar-button text-button !my-0 !px-0"
                        onClick={close}
                        disabled={sending}
                    >
                        Cancel
                    </button>
                    <span className="text-[17px] font-semibold">New Message</span>
                    <button
                        type="button"
                        className="bar-button text-button !my-0 !px-0 font-semibold"
                        onClick={send}
                        disabled={!enabled}
                    >
                        {sending ? 'Sending…' : 'Send'}
                    </button>
                </div>

                <div className="compose__fields">
                    {fieldRow(
                        'From:',
                        <input
                            className="compose__input"
                            type="email"
                            placeholder={`name@${domain}`}
                            value={from}
                            onChange={e => setFrom(e.target.value)}
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                        />,
                    )}
                    {fieldRow(
                        'To:',
                        <input
                            className="compose__input"
                            type="text"
                            placeholder="name@example.com"
                            value={to}
                            onChange={e => setTo(e.target.value)}
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                        />,
                        !showCcBcc ? (
                            <button
                                type="button"
                                className="bar-button text-button !my-0 !px-0 text-[15px]"
                                onClick={() => setShowCcBcc(true)}
                            >
                                Cc/Bcc
                            </button>
                        ) : undefined,
                    )}
                    {showCcBcc
                        ? fieldRow(
                              'Cc:',
                              <input
                                  className="compose__input"
                                  type="text"
                                  value={cc}
                                  onChange={e => setCc(e.target.value)}
                                  autoCapitalize="none"
                                  autoCorrect="off"
                                  spellCheck={false}
                              />,
                          )
                        : null}
                    {showCcBcc
                        ? fieldRow(
                              'Bcc:',
                              <input
                                  className="compose__input"
                                  type="text"
                                  value={bcc}
                                  onChange={e => setBcc(e.target.value)}
                                  autoCapitalize="none"
                                  autoCorrect="off"
                                  spellCheck={false}
                              />,
                          )
                        : null}
                    {fieldRow(
                        'Subject:',
                        <input
                            className="compose__input"
                            type="text"
                            value={subject}
                            onChange={e => setSubject(e.target.value)}
                        />,
                    )}
                </div>

                <textarea
                    value={text}
                    onChange={e => setText(e.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder="Write your message…"
                    className="compose__body"
                />

                <div className="compose__attachments">
                    {files.length > 0 ? (
                        <div className="compose__files">
                            {files.map(({ id, file }) => (
                                <div key={id} className="compose__file">
                                    <AttachmentIcon size={18} />
                                    <span className="compose__file-name">{file.name}</span>
                                    <span className="compose__file-size">{formatBytes(file.size)}</span>
                                    <button
                                        type="button"
                                        aria-label={`Remove ${file.name}`}
                                        className="bar-button compose__file-remove"
                                        disabled={sending}
                                        onClick={() => setFiles(prev => prev.filter(entry => entry.id !== id))}
                                    >
                                        <CloseIcon size={14} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : null}
                    <button
                        type="button"
                        className="bar-button text-button compose__add"
                        onClick={() => fileRef.current?.click()}
                        disabled={sending}
                    >
                        <AttachmentIcon size={18} />
                        <span>Add Attachment</span>
                    </button>
                    <input
                        ref={fileRef}
                        type="file"
                        multiple
                        hidden
                        onChange={addFiles}
                        aria-label="Choose attachments"
                    />
                </div>

                {error ? <div className="compose__error">{error}</div> : null}
            </div>
        </div>
    );
}
