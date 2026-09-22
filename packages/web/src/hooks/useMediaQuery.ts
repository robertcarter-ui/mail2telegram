import { useEffect, useState } from 'react';

function evaluate(query: string): boolean {
    return typeof window !== 'undefined' && window.matchMedia(query).matches;
}

/**
 * Tracks a media query.
 *
 * Besides the standard `change` event, this also re-evaluates on window resize
 * and on visual viewport resize. Embedded web views (including Telegram's) do
 * not always dispatch media query change events when the viewport is resized or
 * the window is dragged, so the extra listeners keep the layout in sync.
 */
export function useMediaQuery(query: string): boolean {
    const [matches, setMatches] = useState(() => evaluate(query));

    useEffect(() => {
        const list = window.matchMedia(query);
        const update = () => setMatches(list.matches);

        // Re-read immediately in case the viewport changed before we attached.
        update();

        list.addEventListener('change', update);
        window.addEventListener('resize', update);
        window.addEventListener('orientationchange', update);
        window.visualViewport?.addEventListener('resize', update);

        return () => {
            list.removeEventListener('change', update);
            window.removeEventListener('resize', update);
            window.removeEventListener('orientationchange', update);
            window.visualViewport?.removeEventListener('resize', update);
        };
    }, [query]);

    return matches;
}
