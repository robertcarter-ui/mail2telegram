import { hapticFeedback } from '@tma.js/sdk-react';

/** Native haptic helpers that silently no-op when unsupported. */
export const haptic = {
    impact(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft' = 'light'): void {
        try {
            hapticFeedback.impactOccurred.ifAvailable(style);
        } catch {
            // ignore
        }
    },
    notification(type: 'error' | 'success' | 'warning' = 'success'): void {
        try {
            hapticFeedback.notificationOccurred.ifAvailable(type);
        } catch {
            // ignore
        }
    },
    selection(): void {
        try {
            hapticFeedback.selectionChanged.ifAvailable();
        } catch {
            // ignore
        }
    },
};
