import type { KeyboardEvent } from 'react';
import { Sheet } from 'konsta/react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import { haptic } from '../../lib/haptics';

export interface ReplySheetProps {
    opened: boolean;
    emailId: string;
    onClose: () => void;
}

/** iOS Mail style compose sheet, sending replies through the Resend API. */
export function ReplySheet({ opened, emailId, onClose }: ReplySheetProps) {
    const [text, setText] = useState('');
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Konsta keeps the sheet's contents mounted while closed, so `autoFocus`
    // would leave this hidden textarea holding page focus on load (and drawing
    // the global focus ring). Focus it only while the sheet is open.
    useEffect(() => {
        if (opened) {
            textareaRef.current?.focus();
        }
    }, [opened]);

    const close = () => {
        if (sending) {
            return;
        }
        setText('');
        setError(null);
        onClose();
    };

    const send = async () => {
        if (!text.trim() || sending) {
            return;
        }
        setSending(true);
        setError(null);
        try {
            await api.reply(emailId, text);
            haptic.notification('success');
            setText('');
            onClose();
        } catch (e) {
            haptic.notification('error');
            setError((e as Error).message);
        } finally {
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

    return (
        <Sheet opened={opened} onBackdropClick={close} className="pb-safe">
            <div className="px-4 pt-2">
                <div className="mb-2 flex items-center justify-between">
                    <button
                        type="button"
                        className="bar-button text-button !my-0 !px-0"
                        onClick={close}
                        disabled={sending}
                    >
                        Cancel
                    </button>
                    <span className="text-[17px] font-semibold">Reply</span>
                    <button
                        type="button"
                        className="bar-button text-button !my-0 !px-0 font-semibold"
                        onClick={send}
                        disabled={sending || !text.trim()}
                    >
                        {sending ? 'Sending…' : 'Send'}
                    </button>
                </div>
                <textarea
                    ref={textareaRef}
                    value={text}
                    onChange={event => setText(event.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder="Write your reply…"
                    rows={7}
                    className="w-full resize-none rounded-xl bg-black/5 p-3 text-[16px] leading-relaxed outline-none dark:bg-white/10"
                />
                {error ? <div className="mt-2 text-[13px] text-[#ff3b30]">{error}</div> : null}
            </div>
        </Sheet>
    );
}
