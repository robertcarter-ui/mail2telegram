/**
 * Sends a test email through Resend, for exercising the inbound path of
 * mail2telegram (Email Routing -> worker) without a mail client.
 *
 * The attachment size is configurable, which is what makes it useful: the
 * truncation and attachment-storage behaviour only shows up above
 * `max_email_size`.
 *
 * Usage:
 *   node scripts/send-test-email.mjs --check
 *   node scripts/send-test-email.mjs --to temp@tbxark.com --mb 2
 *
 * Options:
 *   --check          verify the API key and list verified domains, send nothing
 *   --to <address>   destination (must route to the worker)
 *   --from <address> sender (must be on a verified Resend domain; defaults to
 *                    the destination's domain so replies stay in the same zone)
 *   --mb <n>         attachment size in MiB (default 2)
 *   --subject <s>    subject line (default includes the size, for log matching)
 *
 * The API key is read from RESEND_API_KEY, falling back to `.dev.vars`. It is
 * never printed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function readKeyFromDevVars() {
    const path = `${root}.dev.vars`;
    if (!existsSync(path)) {
        return '';
    }
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*RESEND_API_KEY\s*=\s*(.*)$/);
        if (match) {
            return match[1].trim().replace(/^["']|["']$/g, '');
        }
    }
    return '';
}

function argValue(name, fallback) {
    const index = process.argv.indexOf(`--${name}`);
    return index === -1 ? fallback : process.argv[index + 1];
}

const apiKey = process.env.RESEND_API_KEY || readKeyFromDevVars();
if (!apiKey) {
    console.error('No Resend API key found (RESEND_API_KEY or .dev.vars).');
    process.exit(1);
}
// Guard against accidentally echoing the credential in any output below.
function scrub(text) {
    return String(text).split(apiKey).join('<redacted>');
}

const check = process.argv.includes('--check');
const to = argValue('to', '');
const mb = Number(argValue('mb', '2'));
const from = argValue('from', to ? `test@${to.split('@')[1]}` : '');
const subject = argValue('subject', `mail2telegram test ${mb}MiB attachment ${new Date().toISOString()}`);
const attachmentName = argValue('filename', '');
const html = argValue('html', '');
const bodyText = argValue('text', '');
const attachmentsArg = argValue('attachments', '1');
const rawMessageId = argValue('message-id', '');
const inReplyTo = argValue('in-reply-to', '');

async function api(path, init) {
    const response = await fetch(`https://api.resend.com${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...init?.headers },
    });
    const text = await response.text();
    let body;
    try {
        body = JSON.parse(text);
    } catch {
        body = text;
    }
    return { status: response.status, ok: response.ok, body };
}

if (check) {
    const result = await api('/domains', { method: 'GET' });
    console.log(scrub(`GET /domains -> ${result.status}`));
    if (!result.ok) {
        console.log(scrub(`  error: ${JSON.stringify(result.body).slice(0, 300)}`));
        console.log('  => the key is not usable for sending; a valid key is required.');
        process.exit(2);
    }
    const domains = result.body?.data ?? [];
    console.log('  verified domains:');
    for (const domain of domains) {
        console.log(scrub(`    - ${domain.name} (status=${domain.status}, region=${domain.region ?? '-'})`));
    }
    if (domains.length === 0) {
        console.log('    (none)');
    }
    process.exit(0);
}

if (!to) {
    console.error('--to <address> is required (or use --check).');
    process.exit(1);
}
if (!Number.isFinite(mb) || mb <= 0 || mb > 30) {
    console.error('--mb must be between 0 and 30 (Resend caps total message size at 40MB).');
    process.exit(1);
}

// A deterministic body, so repeated runs are comparable.
const attachment = Buffer.alloc(Math.round(mb * 1024 * 1024), 0x41);
const attachmentCount = Math.max(0, Number.parseInt(attachmentsArg, 10) || 0);
console.log(`sending: to=${to} from=${from}`);
if (attachmentCount > 0) {
    console.log(
        `attachments: ${attachmentCount} x ${mb}MiB (${attachment.byteLength} bytes each, base64 ~${Math.round((attachment.byteLength / 1024 / 1024 / 3) * 4)}MiB)`,
    );
}
console.log(`subject: ${subject}`);

const headers = {};
if (rawMessageId) {
    // A fixed Message-ID is what exercises dedup: sending the same value twice
    // should be treated as one delivery.
    headers['Message-ID'] = rawMessageId;
    console.log(`Message-ID: ${rawMessageId} (fixed; send twice to test dedup)`);
}
if (inReplyTo) {
    headers['In-Reply-To'] = inReplyTo;
    headers.References = inReplyTo;
    console.log(`In-Reply-To: ${inReplyTo} (tests threading)`);
}

const body = {
    from,
    to: [to],
    subject,
    // `--text -` sends no text part, which is how an HTML-only mail arrives.
    ...(bodyText === '-'
        ? {}
        : {
              text: bodyText || `mail2telegram inbound test\nattachment: ${mb}MiB\nsent: ${new Date().toISOString()}\n`,
          }),
    ...(html ? { html } : {}),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(attachmentCount > 0
        ? {
              attachments: Array.from({ length: attachmentCount }, (_unused, index) => ({
                  // Names a real client might send, including characters that are
                  // unsafe in an R2 key or an HTTP header.
                  filename: attachmentName || (index === 0 ? `test-${mb}mb.bin` : `../odd name ${index};"\\ <>.bin`),
                  content: attachment.toString('base64'),
              })),
          }
        : {}),
};

const started = Date.now();
const result = await api('/emails', { method: 'POST', body: JSON.stringify(body) });
console.log(scrub(`POST /emails -> ${result.status} in ${Date.now() - started}ms`));
if (result.ok) {
    console.log(scrub(`  id: ${result.body?.id ?? '(none)'}`));
    console.log('  accepted by Resend; delivery to Email Routing follows.');
} else {
    console.log(scrub(`  error: ${JSON.stringify(result.body).slice(0, 400)}`));
    process.exit(1);
}
