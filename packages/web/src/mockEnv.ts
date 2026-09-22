import { emitEvent, isTMA, mockTelegramEnv } from '@tma.js/sdk-react';

type MockEnvOptions = NonNullable<Parameters<typeof mockTelegramEnv>[0]>;
type MockEvent = Parameters<NonNullable<MockEnvOptions['onEvent']>>[0];

const THEME_PARAMS = {
    accent_text_color: '#2481cc',
    bg_color: '#ffffff',
    button_color: '#2481cc',
    button_text_color: '#ffffff',
    destructive_text_color: '#ff3b30',
    header_bg_color: '#ffffff',
    hint_color: '#8e8e93',
    link_color: '#007aff',
    secondary_bg_color: '#f1f1f1',
    section_bg_color: '#ffffff',
    section_header_text_color: '#6d6d72',
    subtitle_text_color: '#8e8e93',
    text_color: '#000000',
} as const;

const DARK_THEME_PARAMS = {
    accent_text_color: '#62bcf9',
    bg_color: '#1c1c1e',
    button_color: '#2481cc',
    button_text_color: '#ffffff',
    destructive_text_color: '#ff453a',
    header_bg_color: '#1c1c1e',
    hint_color: '#8e8e93',
    link_color: '#6ab2ff',
    secondary_bg_color: '#000000',
    section_bg_color: '#1c1c1e',
    section_header_text_color: '#8e8e93',
    subtitle_text_color: '#9a9a9a',
    text_color: '#ffffff',
} as const;

/**
 * Installs a mock Telegram environment during local development so the Mini App
 * renders outside Telegram. Returns true when the mock was installed. Should
 * never run in a production build.
 *
 * The mock only fakes the UI surface (theme, viewport, safe area, platform) —
 * it intentionally provides no `tgWebAppData`, so a local run authenticates
 * through the web password exactly like a plain browser would.
 */
export async function setupMockEnv(): Promise<boolean> {
    if (await isTMA('complete')) {
        return false;
    }

    // `?platform=ios` makes it easy to preview the phone layout in a browser and
    // `?theme=dark` previews the dark palette. `?safeTop` / `?safeBottom` fake
    // the safe-area insets reported to the app (px), e.g. to preview how the
    // layout sits under an iPhone notch.
    const query = new URLSearchParams(window.location.search);
    const platform = query.get('platform') || 'tdesktop';
    const themeParams = query.get('theme') === 'dark' ? DARK_THEME_PARAMS : THEME_PARAMS;
    const safeArea = {
        top: Number(query.get('safeTop')) || 0,
        bottom: Number(query.get('safeBottom')) || 0,
    };

    mockTelegramEnv({
        launchParams: new URLSearchParams([
            ['tgWebAppThemeParams', JSON.stringify(themeParams)],
            ['tgWebAppVersion', '8.4'],
            ['tgWebAppPlatform', platform],
        ]),
        onEvent: (event: MockEvent, next: () => void) => {
            switch (event.name) {
                case 'web_app_request_theme':
                    emitEvent('theme_changed', { theme_params: { ...themeParams } });
                    break;
                case 'web_app_request_viewport':
                    emitEvent('viewport_changed', {
                        height: window.innerHeight,
                        width: window.innerWidth,
                        is_expanded: true,
                        is_state_stable: true,
                    });
                    break;
                case 'web_app_request_safe_area':
                case 'web_app_request_content_safe_area':
                    emitEvent(
                        event.name === 'web_app_request_safe_area' ? 'safe_area_changed' : 'content_safe_area_changed',
                        {
                            left: 0,
                            top: safeArea.top,
                            bottom: safeArea.bottom,
                            right: 0,
                        },
                    );
                    break;
                default:
                    break;
            }
            next();
        },
    });

    return true;
}
