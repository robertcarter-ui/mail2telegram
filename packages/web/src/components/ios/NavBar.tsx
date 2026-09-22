import type { ReactNode } from 'react';
import { backButton, miniApp } from '@tma.js/sdk-react';
import { Navbar } from 'konsta/react';
import { useEffect, useRef } from 'react';

export interface NavBarProps {
    /** Center title. Omit to leave the navbar title area empty. */
    title?: ReactNode;
    /**
     * TMA back button handler. When set, the native Telegram back button is
     * shown while this navbar is mounted and drives navigation. When omitted the
     * native back button is hidden.
     */
    onBack?: () => void;
    /**
     * Close mode for a root screen with nothing to go back to: the native
     * button closes the Mini App.
     */
    close?: boolean;
    /** Trailing controls, rendered on the right side of the navbar. */
    right?: ReactNode;
    className?: string;
}

/**
 * Flat iOS style navigation bar with a compact centered title.
 *
 * The only Telegram-native chrome in the app is the back / close button: it is
 * requested here, inside the navbar region, and nowhere else.
 */
export function NavBar({ title, onBack, close, right, className }: NavBarProps) {
    const handler = useRef(onBack);
    handler.current = onBack;
    const wantsButton = Boolean(onBack) || Boolean(close);

    useEffect(() => {
        if (!wantsButton) {
            backButton.hide.ifAvailable();
            return;
        }
        backButton.show.ifAvailable();
        const subscription = backButton.onClick.ifAvailable(() => {
            if (handler.current) {
                handler.current();
            } else if (close) {
                miniApp.close.ifAvailable();
            }
        });
        return () => {
            if (subscription.ok) {
                subscription.data();
            }
            backButton.hide.ifAvailable();
        };
    }, [wantsButton, close]);

    return (
        <Navbar
            centerTitle
            right={right}
            title={title ?? ''}
            className={`ios-navbar ${className ?? ''}`}
            bgClassName="ios-navbar__bg"
        />
    );
}
