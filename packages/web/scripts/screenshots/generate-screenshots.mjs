#!/usr/bin/env node
/**
 * README screenshot generator.
 *
 * Renders the real Mini App (and a mock of the Telegram push chat) in headless
 * Chrome with mock API data, then composites the captures into one equal-height,
 * dark, transparent strip at `docs/assets/miniapp_screens.png`.
 *
 * The app is served by a throwaway Vite dev server, so the screenshots always
 * track the current UI; the mail content lives in `mock-data.mjs`.
 *
 * Usage:
 *   pnpm screenshots                     # regenerate docs/assets/miniapp_screens.png
 *   node scripts/screenshots/generate-screenshots.mjs --out other.png
 *   node scripts/screenshots/generate-screenshots.mjs --keep-raw   # keep panels
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from 'puppeteer';
import { createServer as createViteServer, loadConfigFromFile } from 'vite';
import {
    DETAIL_ATTACHMENTS,
    DETAIL_BODY_HTML,
    DETAIL_BODY_TEXT,
    DETAIL_EMAIL_ID,
    EMAILS,
    ME,
    TELEGRAM_PUSH,
    toEmail,
} from './mock-data.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
const DEFAULT_OUT = path.join(REPO_ROOT, 'docs', 'assets', 'miniapp_screens.png');

/** Capture viewports. Phones keep iPhone proportions; the iPad shows the split view (>= 720px). */
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, safeTop: 59, safeBottom: 34 };
const IPAD = { width: 1194, height: 834, deviceScaleFactor: 2, safeTop: 24, safeBottom: 20 };

// ---------------------------------------------------------------------------
// API mock: answers every /api request the Mini App can fire while capturing.
// ---------------------------------------------------------------------------

const EMAIL_ROWS = EMAILS.map(toEmail);

function detailResponse(id) {
    const row = EMAIL_ROWS.find(email => email.id === id) ?? EMAIL_ROWS[0];
    return {
        email: {
            ...row,
            body_html: DETAIL_BODY_HTML,
            body_text: DETAIL_BODY_TEXT,
        },
        attachments: row.id === DETAIL_EMAIL_ID ? DETAIL_ATTACHMENTS : [],
        resendEnabled: ME.resendEnabled,
        summaryEnabled: ME.settings.summaryEnabled,
    };
}

// `/api/client.ts` is the app's source module, not an API route; anything with
// a file extension is served by Vite and must pass through untouched.
const SOURCE_FILE = /\.(?:ts|tsx|js|jsx|mjs|css|json|map|html|svg|png|jpg|jpeg|gif|webp|ico|woff2?)(?:\?|$)/;

/** Installs request interception that answers the app's API calls with mock data. */
async function mockApi(page) {
    await page.setRequestInterception(true);
    page.on('request', request => {
        const url = new URL(request.url());
        if (!url.pathname.startsWith('/api/') || SOURCE_FILE.test(url.pathname)) {
            request.continue();
            return;
        }
        const json = (body, status = 200) =>
            request.respond({
                status,
                contentType: 'application/json',
                body: JSON.stringify(body),
            });

        if (url.pathname === '/api/me') {
            return json(ME);
        }
        if (url.pathname === '/api/emails') {
            return json({
                emails: EMAIL_ROWS,
                total: EMAIL_ROWS.length,
                unread: EMAIL_ROWS.filter(email => email.is_read === 0).length,
            });
        }
        if (url.pathname.startsWith('/api/emails/cleanup')) {
            return json({ emails: 0, attachments: 0, remaining: 0 });
        }
        const match = url.pathname.match(/^\/api\/emails\/([^/]+)(\/summary|\/reply)?$/);
        if (match) {
            const id = decodeURIComponent(match[1]);
            if (match[2] === '/summary') {
                return json({
                    summary:
                        'Airbnb sent your check-in details for the Sunset Loft in Shibuya: self check-in from 3 PM with door code 5842#, pocket wifi on site, and quiet hours after 10 PM.',
                });
            }
            if (match[2] === '/reply') {
                return json({ success: true });
            }
            if (request.method() === 'PATCH') {
                // The reader marks mail as read on open; mirror the patch back.
                const patch = JSON.parse(request.postData() || '{}');
                const row = EMAIL_ROWS.find(email => email.id === id);
                return json({
                    email: {
                        ...row,
                        ...(patch.isRead !== undefined ? { is_read: patch.isRead ? 1 : 0 } : {}),
                        ...(patch.isStarred !== undefined ? { is_starred: patch.isStarred ? 1 : 0 } : {}),
                    },
                });
            }
            if (request.method() === 'DELETE') {
                return json({ success: true });
            }
            return json(detailResponse(id));
        }
        if (url.pathname === '/api/settings') {
            return request.method() === 'PUT' ? json({ settings: ME.settings }) : json({ settings: ME.settings });
        }
        return json({ error: 'not mocked' }, 404);
    });
}

// ---------------------------------------------------------------------------
// Capture helpers.
// ---------------------------------------------------------------------------

function appUrl(base, { safeTop, safeBottom }, hash) {
    const params = new URLSearchParams({
        theme: 'dark',
        platform: 'ios',
        safeTop: String(safeTop),
        safeBottom: String(safeBottom),
    });
    return `${base}?${params.toString()}#${hash}`;
}

async function settle(page, ms) {
    await page.evaluate(() => document.fonts.ready);
    await new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Swapping the reader to its HTML body changes the content above the fold, and
 * the browser's scroll anchoring happily scrolls the pane to compensate. Reset
 * every scrollable element so the capture always starts at the top.
 */
async function resetScroll(page) {
    await page.evaluate(() => {
        window.scrollTo(0, 0);
        for (const el of document.querySelectorAll('*')) {
            if (el.scrollTop > 0) {
                el.scrollTop = 0;
            }
            // The reader body renders in a same-origin srcDoc iframe, which can
            // scroll on its own.
            if (el.tagName === 'IFRAME' && el.contentWindow) {
                try {
                    el.contentWindow.scrollTo(0, 0);
                } catch {
                    // cross-origin frames are not ours to reset
                }
            }
        }
    });
}

/** Clicks the "HTML" toggle in the reader so the screenshot shows the rich body. */
async function showHtmlBody(page) {
    await page.waitForSelector('.reader__subject');
    await page.evaluate(() => {
        const button = [...document.querySelectorAll('button')].find(node => node.textContent.trim() === 'HTML');
        button?.click();
    });
    // Plain text is the default view; the rich body only mounts after the toggle.
    await page.waitForSelector('.reader__frame');
}

/**
 * The reader's nav bar only carries the native Telegram back button, which does
 * not exist in a browser. Draw a stand-in chevron so the capture matches how it
 * looks inside Telegram.
 */
async function injectBackButton(page) {
    await page.evaluate(() => {
        const nav = document.querySelector('.ios-navbar');
        if (!nav || nav.querySelector('[data-mock-back]')) {
            return;
        }
        const slot = nav.querySelector('.k-navbar-left') ?? nav.querySelector('[class*="navbar-left"]');
        const chevron =
            '<svg width="25" height="25" viewBox="0 0 24 24" fill="none">' +
            '<path d="M15 5.5 8.5 12l6.5 6.5" stroke="#0a84ff" stroke-width="2.6" ' +
            'stroke-linecap="round" stroke-linejoin="round"/></svg>';
        if (slot) {
            slot.innerHTML = `<span data-mock-back style="display:flex;align-items:center;">${chevron}</span>`;
        } else {
            const badge = document.createElement('div');
            badge.setAttribute('data-mock-back', '');
            badge.style.cssText = 'position:absolute;left:8px;bottom:8px;z-index:2;';
            badge.innerHTML = chevron;
            nav.appendChild(badge);
        }
    });
}

async function newPage(browser, viewport) {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    await page.setDefaultTimeout(30_000);
    await mockApi(page);
    return page;
}

/** Screenshots a page and closes it, so no background request outlives the capture. */
async function shoot(page) {
    const buffer = await page.screenshot();
    await page.close();
    return buffer;
}

/** Captures the inbox list on a phone viewport. */
async function captureInbox(browser, base) {
    const page = await newPage(browser, PHONE);
    await page.goto(appUrl(base, PHONE, '/inbox'), { waitUntil: 'networkidle0' });
    await page.waitForSelector('.message-row');
    await settle(page, 600);
    return shoot(page);
}

/** Captures the message reader on a phone viewport. */
async function captureReader(browser, base) {
    const page = await newPage(browser, PHONE);
    await page.goto(appUrl(base, PHONE, `/inbox?id=${DETAIL_EMAIL_ID}`), { waitUntil: 'networkidle0' });
    await showHtmlBody(page);
    await injectBackButton(page);
    await resetScroll(page);
    await settle(page, 900);
    await resetScroll(page);
    return shoot(page);
}

/** Captures the iPad split view (list + reader). */
async function captureIpad(browser, base) {
    const page = await newPage(browser, IPAD);
    await page.goto(appUrl(base, IPAD, `/inbox?id=${DETAIL_EMAIL_ID}`), { waitUntil: 'networkidle0' });
    await page.waitForSelector('.split-view');
    await showHtmlBody(page);
    await resetScroll(page);
    await settle(page, 900);
    await resetScroll(page);
    return shoot(page);
}

// ---------------------------------------------------------------------------
// Telegram push chat mock.
// ---------------------------------------------------------------------------

export function telegramPushHtml(push) {
    const bubble = message => `
        <div class="bubble">
          <div class="bubble__subject">${message.subject}</div>
          <div class="bubble__divider">------------</div>
          <div class="bubble__meta">From&nbsp;: <a>${message.from}</a></div>
          <div class="bubble__meta">To&nbsp;&nbsp;: <a>${message.to}</a></div>
          <div class="bubble__time">${message.time}</div>
        </div>
        <div class="kb">
          ${push.buttons
              .map(
                  button => `
            <div class="kb__btn">
              ${button.label}
              ${button.miniapp ? '<span class="kb__icon"></span>' : ''}
            </div>`,
              )
              .join('')}
        </div>`;

    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    width: ${PHONE.width}px; height: ${PHONE.height}px;
    background: #000; overflow: hidden; position: relative;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .nav {
    position: absolute; top: ${PHONE.safeTop}px; left: 0; right: 0; height: 64px;
    display: flex; align-items: center; gap: 8px; padding: 0 8px; z-index: 3;
    background: rgba(0, 0, 0, 0.82); backdrop-filter: blur(18px);
  }
  .nav__back {
    width: 40px; height: 40px; border-radius: 20px; flex: 0 0 auto;
    background: rgba(44, 44, 46, 0.72); display: flex; align-items: center; justify-content: center;
  }
  .nav__pill {
    flex: 1; height: 44px; border-radius: 22px; background: rgba(28, 28, 30, 0.88);
    display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1.15;
  }
  .nav__title { color: #fff; font-size: 16px; font-weight: 600; }
  .nav__subtitle { color: #8e8e93; font-size: 12.5px; }
  .nav__avatar {
    width: 38px; height: 38px; border-radius: 19px; flex: 0 0 auto;
    background: linear-gradient(135deg, #f6b73c, #f0506e);
    color: #fff; font-size: 17px; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
  }
  .chat { position: absolute; inset: 0; padding: ${PHONE.safeTop + 64}px 10px 110px; overflow: hidden; }
  .chip {
    width: fit-content; margin: 10px auto 4px; padding: 4px 12px; border-radius: 15px;
    background: #232325; color: #fff; font-size: 13.5px; font-weight: 500;
  }
  .bubble {
    position: relative; background: #212121; border-radius: 18px;
    padding: 11px 12px 26px; margin-top: 10px;
    color: #f2f2f2; font-size: 16.5px; line-height: 1.35;
  }
  .bubble__subject { word-break: break-word; }
  .bubble__divider { margin: 12px 0 10px; color: #d1d1d6; letter-spacing: 0; }
  .bubble__meta { color: #fff; margin-top: 2px; }
  .bubble__meta a { color: #62bcf9; text-decoration: none; }
  .bubble__time { position: absolute; right: 11px; bottom: 6px; color: #7c7c82; font-size: 13px; }
  .kb { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; margin-top: 8px; }
  .kb__btn {
    position: relative; background: #212121; border-radius: 12px; height: 47px;
    display: flex; align-items: center; justify-content: center;
    color: #fff; font-size: 16.5px;
  }
  .kb__icon {
    position: absolute; top: 5px; right: 7px; width: 11px; height: 11px;
    border: 1.6px solid rgba(255, 255, 255, 0.85); border-radius: 3px;
  }
  .input {
    position: absolute; left: 0; right: 0; bottom: ${PHONE.safeBottom}px;
    display: flex; align-items: center; gap: 8px; padding: 6px 8px; z-index: 3;
  }
  .input__folder {
    height: 38px; padding: 0 14px; border-radius: 19px; background: rgba(44, 44, 46, 0.72);
    color: #fff; font-size: 15.5px; font-weight: 600;
    display: flex; align-items: center; gap: 7px;
  }
  .input__folder svg { display: block; }
  .input__field {
    flex: 1; height: 38px; border-radius: 19px; background: #1c1c1e;
    color: #8e8e93; font-size: 16px; display: flex; align-items: center; padding: 0 14px;
  }
  .input__btn {
    width: 38px; height: 38px; border-radius: 19px; flex: 0 0 auto;
    background: rgba(44, 44, 46, 0.72);
    display: flex; align-items: center; justify-content: center;
  }
</style>
</head>
<body>
  <div class="chat">
    ${push.groups
        .map(
            group => `
      <div class="chip">${group.label}</div>
      ${group.messages.map(bubble).join('')}
    `,
        )
        .join('')}
  </div>
  <div class="nav">
    <div class="nav__back">
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none">
        <path d="M15 4.5 7.5 12l7.5 7.5" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
    <div class="nav__pill">
      <div class="nav__title">${push.chatTitle}</div>
      <div class="nav__subtitle">${push.chatSubtitle}</div>
    </div>
    <div class="nav__avatar">m</div>
  </div>
  <div class="input">
    <div class="input__folder">
      <svg width="17" height="17" viewBox="0 0 20 20" fill="none">
        <rect x="2.5" y="5" width="12.5" height="12.5" rx="3" stroke="#fff" stroke-width="1.7"/>
        <path d="M6.5 5V5.75A2.75 2.75 0 0 1 9.25 3.5h5A2.75 2.75 0 0 1 17 6.25v5a2.75 2.75 0 0 1-1.5 2.45" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/>
      </svg>
      Inbox
    </div>
    <div class="input__btn">
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
        <path d="M20.5 11.5 12 20a5.3 5.3 0 0 1-7.5-7.5l8-8a3.5 3.5 0 0 1 5 5l-8 8a1.8 1.8 0 0 1-2.5-2.5l7.3-7.3" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
    <div class="input__field">Message</div>
    <div class="input__btn">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <rect x="9" y="2.5" width="6" height="12" rx="3" stroke="#fff" stroke-width="1.7"/>
        <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/>
      </svg>
    </div>
  </div>
</body>
</html>`;
}

async function capturePush(browser) {
    const page = await browser.newPage();
    await page.setViewport(PHONE);
    await page.setDefaultTimeout(30_000);
    await page.setContent(telegramPushHtml(TELEGRAM_PUSH), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await new Promise(resolve => setTimeout(resolve, 300));
    return shoot(page);
}

// ---------------------------------------------------------------------------
// Composite: equal-height device frames with iOS chrome on a transparent canvas.
// ---------------------------------------------------------------------------

const GAP = 46;
const PADDING = 56;
const LABEL_SPACE = 70;
const BEZEL = 10;

function statusChrome({ time, battery }) {
    return `
    <div class="status">
      <span class="status__time">${time}</span>
      <span class="status__icons">
        <svg width="18" height="12" viewBox="0 0 18 12" fill="#fff">
          <rect x="0" y="7.5" width="3.2" height="4.5" rx="1"/>
          <rect x="4.9" y="5" width="3.2" height="7" rx="1"/>
          <rect x="9.8" y="2.5" width="3.2" height="9.5" rx="1"/>
          <rect x="14.7" y="0" width="3.2" height="12" rx="1"/>
        </svg>
        <svg width="17" height="12" viewBox="0 0 17 12" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round">
          <path d="M1.6 4.1a10.6 10.6 0 0 1 13.8 0"/>
          <path d="M4 6.7a7 7 0 0 1 9 0"/>
          <path d="M6.4 9.2a3.5 3.5 0 0 1 4.2 0"/>
        </svg>
        <span class="status__battery">${battery}</span>
        <span class="status__battery-body"><span style="width:${battery}%"></span></span>
      </span>
    </div>`;
}

function panelHtml(panel) {
    const radius = panel.device === 'phone' ? 56 : 42;
    const island = panel.device === 'phone' ? '<div class="island"></div>' : '';
    const home = `<div class="home ${panel.device === 'phone' ? 'home--phone' : 'home--ipad'}"></div>`;
    return `
    <div class="panel">
      <div class="device device--${panel.device}" style="border-radius:${radius}px;">
        <img class="screen screen--${panel.device}" width="${panel.displayWidth}" height="${panel.displayHeight}"
             src="data:image/png;base64,${Buffer.from(panel.img).toString('base64')}" alt="">
        ${island}
        ${statusChrome(panel.status)}
        ${home}
      </div>
      <div class="label">${panel.label}</div>
    </div>`;
}

function compositeHtml(panels) {
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: transparent; }
  body {
    width: ${
        panels.reduce((sum, panel) => sum + panel.displayWidth, 0) +
        2 * BEZEL * panels.length +
        2 * PADDING +
        GAP * (panels.length - 1)
    }px;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .canvas { display: flex; align-items: flex-start; gap: ${GAP}px; padding: ${PADDING}px; }
  .panel { display: flex; flex-direction: column; align-items: center; }
  .device {
    position: relative; background: #000; overflow: hidden;
    box-shadow: 0 0 0 ${BEZEL}px #050506, 0 0 0 ${BEZEL + 1.5}px rgba(255, 255, 255, 0.24),
                0 26px 70px rgba(0, 0, 0, 0.55);
  }
  .screen { display: block; }
  .island {
    position: absolute; top: 11px; left: 50%; transform: translateX(-50%);
    width: 122px; height: 36px; border-radius: 18px; background: #000; z-index: 6;
    box-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.05);
  }
  .status {
    position: absolute; top: 0; left: 0; right: 0; height: ${PHONE.safeTop - 5}px;
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 0 0; color: #fff; z-index: 5; pointer-events: none;
  }
  .device--phone .status { padding-left: 40px; padding-right: 30px; }
  .device--ipad .status { height: 24px; padding: 4px 30px 0 34px; }
  .status__time { font-size: 16.5px; font-weight: 600; letter-spacing: 0.2px; }
  .status__icons { display: flex; align-items: center; gap: 6px; }
  .status__battery { font-size: 12.5px; font-weight: 600; margin-right: 1px; }
  .status__battery-body {
    width: 25px; height: 13px; border: 1px solid rgba(255, 255, 255, 0.55); border-radius: 4px;
    padding: 1.5px; display: flex;
  }
  .status__battery-body span { background: #fff; border-radius: 2px; display: block; }
  .home {
    position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%);
    border-radius: 3px; background: rgba(255, 255, 255, 0.92); z-index: 6;
  }
  .home--phone { width: 139px; height: 5px; }
  .home--ipad { width: 180px; height: 5px; bottom: 7px; }
  .label { margin-top: 26px; color: #a4a4ab; font-size: 30px; font-weight: 500; letter-spacing: 0.2px; }
</style>
</head>
<body>
  <div class="canvas">
    ${panels.map(panelHtml).join('\n')}
  </div>
</body>
</html>`;
}

async function composeComposite(browser, panels, outPath) {
    const deviceHeight = panels[0].displayHeight + 2 * BEZEL;
    const width =
        panels.reduce((sum, panel) => sum + panel.displayWidth + 2 * BEZEL, 0) +
        2 * PADDING +
        GAP * (panels.length - 1);
    const height = deviceHeight + PADDING * 2 + LABEL_SPACE;

    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 2 });
    await page.setContent(compositeHtml(panels), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    // `page.screenshot()` returns a Uint8Array in current Puppeteer; make sure
    // every inlined panel actually decoded before capturing the composite.
    await page.waitForFunction(() => [...document.images].every(img => img.complete && img.naturalWidth > 0), {
        timeout: 15_000,
    });
    await new Promise(resolve => setTimeout(resolve, 200));
    const png = await page.screenshot({ omitBackground: true });
    await page.close();

    fs.writeFileSync(outPath, png);
    return { width, height };
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

function parseArgs(argv) {
    const args = { out: DEFAULT_OUT };
    for (let i = 2; i < argv.length; i += 1) {
        if (argv[i] === '--out') {
            args.out = path.resolve(argv[++i]);
        } else if (argv[i] === '--keep-raw') {
            args.keepRaw = true;
        }
    }
    return args;
}

async function startWebServer() {
    // Reuse the project's real Vite config for its React/Tailwind plugins and
    // aliases — without them no utility classes are generated at all, which for
    // example left the closed reply sheet (`.fixed top-full`) laid out inside
    // the reader instead of off-screen. Only the server block is replaced: a
    // random port, and no API proxy, because there is no worker running and the
    // capture intercepts every /api request itself.
    const loaded = await loadConfigFromFile(
        { command: 'serve', mode: 'development' },
        path.join(PACKAGE_ROOT, 'vite.config.ts'),
    );
    const config = loaded?.config ?? {};
    const server = await createViteServer({
        ...config,
        configFile: false,
        logLevel: 'error',
        server: { ...config.server, port: 0, strictPort: false, proxy: {} },
    });
    await server.listen();
    const url = server.resolvedUrls?.local?.[0] ?? server.resolvedUrls?.network?.[0];
    if (!url) {
        throw new Error('Vite dev server did not report a local URL');
    }
    return { server, base: new URL(url).toString() };
}

async function main() {
    const args = parseArgs(process.argv);

    console.log('Starting Vite dev server…');
    const { server, base } = await startWebServer();
    console.log(`  serving ${base}`);

    const browser = await launch({
        headless: true,
        args: ['--force-color-profile=srgb', '--hide-scrollbars'],
    });

    try {
        console.log('Capturing panels…');
        const push = await capturePush(browser);
        const inbox = await captureInbox(browser, base);
        const reader = await captureReader(browser, base);
        const ipad = await captureIpad(browser, base);

        // The iPad capture is rescaled to the phone screenshot height so every
        // panel lines up in one strip.
        const panels = [
            {
                label: 'Push Notification',
                device: 'phone',
                img: push,
                displayWidth: PHONE.width,
                displayHeight: PHONE.height,
                status: { time: TELEGRAM_PUSH.statusBarTime, battery: TELEGRAM_PUSH.batteryPercent },
            },
            {
                label: 'Inbox',
                device: 'phone',
                img: inbox,
                displayWidth: PHONE.width,
                displayHeight: PHONE.height,
                status: { time: '9:41', battery: 72 },
            },
            {
                label: 'Reader',
                device: 'phone',
                img: reader,
                displayWidth: PHONE.width,
                displayHeight: PHONE.height,
                status: { time: '9:41', battery: 72 },
            },
            {
                label: 'iPad Split View',
                device: 'ipad',
                img: ipad,
                displayWidth: Math.round((IPAD.width * PHONE.height) / IPAD.height),
                displayHeight: PHONE.height,
                status: { time: '9:41', battery: 92 },
            },
        ];

        if (args.keepRaw) {
            const rawDir = path.join(path.dirname(args.out), 'screenshots-raw');
            fs.mkdirSync(rawDir, { recursive: true });
            for (const panel of panels) {
                fs.writeFileSync(path.join(rawDir, `${panel.label.toLowerCase().replace(/\s+/g, '-')}.png`), panel.img);
            }
            console.log(`  raw panels written to ${rawDir}`);
        }

        // README also embeds the push chat on its own (`docs/assets/example.png`); keep
        // the standalone panel in sync with the strip.
        const examplePath = path.join(path.dirname(args.out), 'example.png');
        fs.writeFileSync(examplePath, push);
        console.log(`Wrote ${examplePath}`);

        console.log('Compositing…');
        const { width, height } = await composeComposite(browser, panels, args.out);
        console.log(`Wrote ${args.out} (${width}x${height} css px @2x)`);
    } finally {
        await browser.close();
        await server.close();
    }
}

// Only run when executed directly, so the HTML builders stay importable for
// layout inspection without launching a browser.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => {
        console.error(error);
        process.exit(1);
    });
}
