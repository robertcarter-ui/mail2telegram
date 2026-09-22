import type { EmailRecord, SendAttachment } from '../types';

export interface ReplyOptions {
    /** Optional reply subject override. */
    subject?: string;
}

/** Everything Resend's send endpoint accepts that the worker uses. */
export interface OutgoingEmail {
    from: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    text: string;
    attachments?: SendAttachment[];
}

export async function replyToEmail(
    token: string,
    email: EmailRecord,
    message: string,
    options: ReplyOptions = {},
): Promise<void> {
    const subject = options.subject || (email.subject.startsWith('Re: ') ? email.subject : `Re: ${email.subject}`);
    await sendEmail(token, {
        from: email.recipient,
        to: [email.sender],
        subject,
        text: message,
    });
}

export async function sendEmail(token: string, email: OutgoingEmail): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            from: email.from,
            to: email.to,
            ...(email.cc?.length ? { cc: email.cc } : {}),
            ...(email.bcc?.length ? { bcc: email.bcc } : {}),
            subject: email.subject,
            text: email.text,
            ...(email.attachments?.length
                ? {
                      attachments: email.attachments.map(att => ({
                          filename: att.filename,
                          content: att.content,
                          content_type: att.mimetype,
                      })),
                  }
                : {}),
        }),
    });
    if (!response.ok) {
        // Resend reports domain/recipient problems in the body; surface a short
        // reason instead of a bare status code.
        let reason = '';
        try {
            const body = (await response.json()) as { message?: string };
            reason = body.message ? `: ${body.message}` : '';
        } catch {
            // ignore non-json error bodies
        }
        throw new Error(`Resend API request failed: ${response.status}${reason}`);
    }
}
