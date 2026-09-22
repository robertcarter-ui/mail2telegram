import type { ForwardableEmailMessage } from '@cloudflare/workers-types';
import { parseEmail } from './parse';

const EML = [
    'From: "Alice Example" <alice@example.com>',
    'To: inbox@example.com',
    'Subject: Hello from the test suite',
    'Message-ID: <test-message-id@example.com>',
    'Date: Tue, 01 Jan 2025 12:00:00 +0000',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="boundary-42"',
    '',
    '--boundary-42',
    'Content-Type: text/plain; charset="utf-8"',
    '',
    'This is the plain text body.',
    '',
    '--boundary-42',
    'Content-Type: text/plain; name="note.txt"',
    'Content-Disposition: attachment; filename="note.txt"',
    'Content-Transfer-Encoding: base64',
    '',
    'aGVsbG8gYXR0YWNobWVudA==',
    '--boundary-42--',
    '',
].join('\r\n');

function buildMessage(raw: string): ForwardableEmailMessage {
    const bytes = new TextEncoder().encode(raw);
    return {
        raw: new Blob([bytes]).stream(),
        rawSize: bytes.byteLength,
        headers: new Headers({
            'Message-ID': '<test-message-id@example.com>',
            Subject: 'Hello from the test suite',
        }),
        from: 'alice@example.com',
        to: 'inbox@example.com',
        setReject: () => {},
        forward: async () => {},
        reply: async () => {},
    } as unknown as ForwardableEmailMessage;
}

async function testCase() {
    const raw = EML;
    const message = buildMessage(raw);
    const email = await parseEmail(message, 1024 * 1024, 'truncate');
    if (email.subject !== 'Hello from the test suite') {
        throw new Error(`unexpected subject: ${email.subject}`);
    }
    if (!email.text.includes('plain text body')) {
        throw new Error(`unexpected body: ${email.text}`);
    }
    if (email.attachments.length !== 1) {
        throw new Error(`expected 1 attachment, got ${email.attachments.length}`);
    }
    const attachment = email.attachments[0];
    if (attachment.filename !== 'note.txt') {
        throw new Error(`unexpected attachment filename: ${attachment.filename}`);
    }
    const content = new TextDecoder().decode(attachment.content);
    if (content !== 'hello attachment') {
        throw new Error(`unexpected attachment content: ${content}`);
    }
    console.log(`parseEmail ok: subject="${email.subject}" attachments=${email.attachments.length}`);
}

testCase()
    .then(() => console.log('done'))
    .catch(e => {
        console.error(e);
        process.exit(1);
    });
