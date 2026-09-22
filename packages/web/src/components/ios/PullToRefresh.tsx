import type { ReactNode } from 'react';
import { Preloader } from 'konsta/react';
import { useEffect, useRef, useState } from 'react';
import { haptic } from '../../lib/haptics';

const THRESHOLD = 64;
/** Resistance applied past the threshold, like the iOS rubber band. */
const RUBBER = 0.35;
/** Height the spinner locks to while a refresh is running. */
const REFRESH_HEIGHT = 44;

export interface PullToRefreshProps {
    onRefresh: () => Promise<void> | void;
    /** Class for the scroll container, e.g. `page-scroll`. */
    className?: string;
    /** Lets the parent scroll or reset the same container. */
    scrollRef?: { current: HTMLDivElement | null };
    children: ReactNode;
}

/**
 * Touch-driven pull-to-refresh for the message list.
 *
 * Konsta has no equivalent, so this follows the iOS Mail gesture directly on
 * the scroll container: the spinner is revealed only while the list is at the
 * top and the pull is mostly downward, so it never fights the swipe-to-delete
 * rows or normal scrolling. Pointer and mouse input are left alone.
 */
export function PullToRefresh({ onRefresh, className = '', scrollRef, children }: PullToRefreshProps) {
    const ref = useRef<HTMLDivElement | null>(null);
    const pullRef = useRef(0);
    const refreshingRef = useRef(false);
    const [pull, setPull] = useState(0);
    const [dragging, setDragging] = useState(false);
    const [settled, setSettled] = useState(false);

    useEffect(() => {
        const el = ref.current;
        if (!el) {
            return;
        }
        let startY = 0;
        let tracking = false;
        let pulling = false;

        const apply = (value: number) => {
            pullRef.current = value;
            setPull(value);
        };

        const onTouchStart = (e: TouchEvent) => {
            if (refreshingRef.current || e.touches.length !== 1) {
                return;
            }
            tracking = el.scrollTop <= 0;
            startY = e.touches[0].clientY;
            pulling = false;
        };

        const onTouchMove = (e: TouchEvent) => {
            if (refreshingRef.current) {
                return;
            }
            const dy = e.touches[0].clientY - startY;
            if (!pulling) {
                if (!tracking || dy <= 0 || el.scrollTop > 0) {
                    tracking = false;
                    return;
                }
                // The pull only takes over once the finger moves down while the
                // list rests at the top; everything else keeps native handling.
                pulling = true;
                setDragging(true);
                setSettled(false);
            }
            const eased = dy <= THRESHOLD ? dy : THRESHOLD + (dy - THRESHOLD) * RUBBER;
            e.preventDefault();
            apply(Math.min(eased, 110));
        };

        const onTouchEnd = () => {
            if (!pulling) {
                tracking = false;
                return;
            }
            pulling = false;
            tracking = false;
            setDragging(false);
            setSettled(true);
            if (pullRef.current >= THRESHOLD) {
                refreshingRef.current = true;
                apply(REFRESH_HEIGHT);
                haptic.impact('light');
                void Promise.resolve(onRefresh()).finally(() => {
                    refreshingRef.current = false;
                    apply(0);
                });
            } else {
                apply(0);
            }
        };

        el.addEventListener('touchstart', onTouchStart, { passive: true });
        el.addEventListener('touchmove', onTouchMove, { passive: false });
        el.addEventListener('touchend', onTouchEnd, { passive: true });
        el.addEventListener('touchcancel', onTouchEnd, { passive: true });
        return () => {
            el.removeEventListener('touchstart', onTouchStart);
            el.removeEventListener('touchmove', onTouchMove);
            el.removeEventListener('touchend', onTouchEnd);
            el.removeEventListener('touchcancel', onTouchEnd);
        };
    }, [onRefresh]);

    return (
        <div
            ref={node => {
                ref.current = node;
                if (scrollRef) {
                    scrollRef.current = node;
                }
            }}
            className={className}
        >
            <div className={`ptr-spinner ${settled ? 'ptr-spinner--settle' : ''}`} style={{ height: pull }}>
                <span className={`ptr-spinner__icon ${pull > 8 ? 'ptr-spinner__icon--visible' : ''}`}>
                    <Preloader />
                </span>
            </div>
            <div
                className={`ptr-content ${dragging ? 'ptr-content--dragging' : ''}`}
                style={{ transform: `translateY(${pull}px)` }}
            >
                {children}
            </div>
        </div>
    );
}
