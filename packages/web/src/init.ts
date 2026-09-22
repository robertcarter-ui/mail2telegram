import {
    backButton,
    initData,
    init as initSdk,
    miniApp,
    retrieveLaunchParams,
    retrieveRawInitData,
    setDebug,
    themeParams,
    viewport,
} from '@tma.js/sdk-react';

export interface InitOptions {
    debug: boolean;
}

/**
 * Initializes the Mini Apps SDK and mounts the native components used across the
 * app. All mounts are guarded with `ifAvailable` so the app still renders when a
 * Telegram client does not support a component.
 */
export function initApp({ debug }: InitOptions): void {
    if (debug) {
        setDebug(true);
    }
    initSdk();

    miniApp.mount.ifAvailable();
    miniApp.ready.ifAvailable();

    themeParams.mount.ifAvailable();
    themeParams.bindCssVars.ifAvailable();

    viewport.mount.ifAvailable();
    viewport.bindCssVars.ifAvailable();
    viewport.expand.ifAvailable();
    requestFullscreen();

    backButton.mount.ifAvailable();

    initData.restore();
}

/** Platforms that run as a phone app and benefit from fullscreen. */
function isMobilePlatform(): boolean {
    const platform = getPlatform();
    return platform === 'ios' || platform === 'android';
}

/**
 * Requests fullscreen on phone clients only. Desktop clients (macOS, Telegram
 * Desktop, web) keep their normal window chrome. Silently ignored when the
 * client does not support fullscreen (Bot API < 8.0) or rejects the request.
 */
export function requestFullscreen(): void {
    if (!isMobilePlatform()) {
        return;
    }
    try {
        const result = viewport.requestFullscreen.ifAvailable();
        if (result.ok) {
            result.data.catch(() => {});
        }
    } catch {
        // fullscreen is a progressive enhancement
    }
}

/** Platform reported by Telegram: `ios`, `android`, `macos`, `tdesktop`, `web`... */
export function getPlatform(): string {
    try {
        return retrieveLaunchParams().tgWebAppPlatform || 'web';
    } catch {
        return 'web';
    }
}

/**
 * True when real Telegram launch data is present, i.e. a Telegram client opened
 * the page and provided `initData`. Every Telegram client carries it, while the
 * dev mock and plain browsers do not, so this decides between Telegram error
 * handling and the browser password login.
 */
export function isTelegramEnvironment(): boolean {
    try {
        return Boolean(retrieveRawInitData());
    } catch {
        return false;
    }
}
