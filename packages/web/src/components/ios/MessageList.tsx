import type { ReactNode, PointerEvent as ReactPointerEvent } from 'react';
import type { Email } from '@mail2telegram/shared';
import { useCallback, useRef, useState } from 'react';
import { formatListDate, senderLabel } from '../../lib/format';
import { haptic } from '../../lib/haptics';
import { StarIcon, TrashIcon } from './Icons';

/** Width of the revealed delete action, in px. */
const ACTION_WIDTH = 88;
const DRAG_THRESHOLD = 8;

export interface MessageListProps {
    emails: Email[];
    selectedId?: string | null;
    onSelect: (email: Email) => void;
    /** Swiping a row left reveals Delete; called when it is tapped. */
    onDelete?: (email: Email) => void;
    onEndReached?: () => void;
}

/**
 * Swipe-to-reveal row, following the iOS Mail gesture.
 *
 * Pointer events cover mouse and touch. Vertical movement is handed back to the
 * scroller so the list keeps scrolling normally; only a mostly horizontal drag
 * starts the reveal.
 */
function SwipeRow({ onDelete, children }: { onDelete?: () => void; children: ReactNode }) {
    const [offset, setOffset] = useState(0);
    const [dragging, setDragging] = useState(false);
    const offsetRef = useRef(0);
    const openRef = useRef(false);
    const dragRef = useRef<{ x: number; y: number; base: number; active: boolean; decided: boolean } | null>(null);
    const suppressClick = useRef(false);

    const applyOffset = useCallback((value: number) => {
        offsetRef.current = value;
        setOffset(value);
    }, []);

    const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (!onDelete) {
            return;
        }
        if (e.pointerType === 'mouse' && e.button !== 0) {
            return;
        }
        // A new gesture clears the previous drag's click suppression, so the tap
        // that follows an opened row closes it instead of being swallowed.
        suppressClick.current = false;
        dragRef.current = {
            x: e.clientX,
            y: e.clientY,
            base: offsetRef.current,
            active: true,
            decided: false,
        };
    };

    const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag?.active) {
            return;
        }
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (!drag.decided) {
            if (Math.abs(dx) < DRAG_THRESHOLD) {
                return;
            }
            // A mostly vertical gesture belongs to the list scroller.
            if (Math.abs(dy) > Math.abs(dx)) {
                drag.active = false;
                return;
            }
            drag.decided = true;
            setDragging(true);
        }
        applyOffset(Math.max(-ACTION_WIDTH, Math.min(0, drag.base + dx)));
    };

    const finishDrag = () => {
        const drag = dragRef.current;
        if (!drag?.active) {
            return;
        }
        drag.active = false;
        suppressClick.current = drag.decided;
        setDragging(false);
        const shouldOpen = offsetRef.current <= -ACTION_WIDTH / 2;
        openRef.current = shouldOpen;
        haptic.selection();
        applyOffset(shouldOpen ? -ACTION_WIDTH : 0);
    };

    const close = useCallback(() => {
        openRef.current = false;
        applyOffset(0);
    }, [applyOffset]);

    return (
        <div className="swipe-row">
            {onDelete ? (
                <button
                    type="button"
                    className="swipe-row__action"
                    tabIndex={openRef.current ? 0 : -1}
                    aria-label="Delete message"
                    onClick={() => {
                        haptic.impact();
                        close();
                        onDelete();
                    }}
                >
                    <TrashIcon size={22} />
                    <span>Delete</span>
                </button>
            ) : null}
            <div
                className={`swipe-row__content ${dragging ? 'swipe-row__content--dragging' : ''}`}
                // A resting row carries no transform at all, so it stays in the
                // scroller's own paint pass instead of becoming a layer that can
                // drift away from the delete action during fast scrolling.
                style={offset ? { transform: `translateX(${offset}px)` } : undefined}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={finishDrag}
                onPointerCancel={finishDrag}
                onClickCapture={e => {
                    if (suppressClick.current) {
                        suppressClick.current = false;
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                    }
                    // Tapping an open row closes it instead of opening the mail.
                    if (openRef.current) {
                        e.preventDefault();
                        e.stopPropagation();
                        close();
                    }
                }}
            >
                {children}
            </div>
        </div>
    );
}

/** A single iOS Mail message cell. */
function MessageRow({
    email,
    selected,
    onSelect,
}: {
    email: Email;
    selected: boolean;
    onSelect: (email: Email) => void;
}) {
    const unread = email.is_read === 0;
    return (
        <div
            role="button"
            tabIndex={0}
            aria-current={selected || undefined}
            className={`message-row ${unread ? 'message-row--unread' : ''} ${selected ? 'message-row--selected' : ''}`}
            onClick={() => onSelect(email)}
            onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                    onSelect(email);
                }
            }}
        >
            <span className={`message-row__dot ${unread ? '' : 'message-row__dot--read'}`}>
                <span />
            </span>
            <div className="message-row__body">
                <div className="message-row__top">
                    <span className="message-row__sender">{senderLabel(email)}</span>
                    <span className="message-row__time">
                        {email.is_starred ? <StarIcon size={13} filled className="message-row__star" /> : null}
                        {formatListDate(email.date)}
                    </span>
                </div>
                <div className="message-row__subject">{email.subject || '(no subject)'}</div>
                <div className="message-row__preview">{email.snippet || ''}</div>
            </div>
        </div>
    );
}

/** Scrolling list of messages with swipe-to-delete and infinite loading. */
export function MessageList({ emails, selectedId, onSelect, onDelete, onEndReached }: MessageListProps) {
    const observer = useRef<IntersectionObserver | null>(null);
    const sentinel = useCallback(
        (node: HTMLDivElement | null) => {
            observer.current?.disconnect();
            if (!node || !onEndReached) {
                return;
            }
            observer.current = new IntersectionObserver(
                entries => {
                    if (entries[0]?.isIntersecting) {
                        onEndReached();
                    }
                },
                { rootMargin: '300px' },
            );
            observer.current.observe(node);
        },
        [onEndReached],
    );

    return (
        <div>
            {emails.map(email => (
                <SwipeRow key={email.id} onDelete={onDelete ? () => onDelete(email) : undefined}>
                    <MessageRow email={email} selected={email.id === selectedId} onSelect={onSelect} />
                </SwipeRow>
            ))}
            {onEndReached && emails.length > 0 ? <div ref={sentinel} style={{ height: 1 }} /> : null}
        </div>
    );
}
