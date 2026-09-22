import DOMPurify from 'dompurify';

/**
 * Sanitize an HTML email body before it is placed into a sandboxed iframe.
 * The iframe itself has no `allow-same-origin`, so scripts cannot reach the app,
 * but we still strip scripts and event handlers as defense in depth.
 */
export function sanitizeEmailHtml(html: string): string {
    return DOMPurify.sanitize(html, {
        FORBID_TAGS: ['script', 'style', 'form', 'input', 'button', 'iframe', 'object', 'embed', 'link', 'meta'],
        FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'srcset'],
        ALLOW_DATA_ATTR: false,
    });
}

/** Wrap sanitized content in a minimal document with readable typography. */
export function buildEmailDocument(html: string, dark: boolean): string {
    const body = sanitizeEmailHtml(html);
    return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base target="_blank">
<style>
  :root { color-scheme: ${dark ? 'dark' : 'light'}; }
  body {
    margin: 0; padding: 16px; background: transparent;
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, 'SF Pro Text', Roboto, sans-serif;
    color: ${dark ? '#f5f5f5' : '#111'};
    overflow-wrap: anywhere;
  }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  a { color: ${dark ? '#6ab2ff' : '#007aff'}; }
  pre { white-space: pre-wrap; }
</style></head><body>${body}</body></html>`;
}
