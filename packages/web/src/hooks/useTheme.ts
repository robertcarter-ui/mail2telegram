import { miniApp, useSignal } from '@tma.js/sdk-react';

function readSystemDark(): boolean {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Reactive dark-mode flag sourced from the Telegram theme. */
export function useDarkMode(): boolean {
    const isDark = useSignal(miniApp.isDark);
    return isDark === undefined ? readSystemDark() : Boolean(isDark);
}
