import type { R2Bucket } from '@cloudflare/workers-types';
import type { EmailRecord } from '../types';

/** Inline body keys start with `bodies/`, attachments with `attachments/`. */
export function isR2Pointer(value: string | null | undefined): boolean {
    return Boolean(value && (value.startsWith('bodies/') || value.startsWith('attachments/')));
}

async function resolveBodyValue(bucket: R2Bucket | undefined, value: string | null): Promise<string | null> {
    if (!value) {
        return null;
    }
    if (!isR2Pointer(value)) {
        return value;
    }
    if (!bucket) {
        return null;
    }
    const object = await bucket.get(value);
    return object ? await object.text() : null;
}

export interface ResolvedEmailBody {
    html: string | null;
    text: string | null;
}

/** Resolve HTML/text bodies from R2 when they were offloaded, otherwise return inline content. */
export async function resolveEmailBody(email: EmailRecord, bucket: R2Bucket | undefined): Promise<ResolvedEmailBody> {
    const [html, text] = await Promise.all([
        resolveBodyValue(bucket, email.body_html),
        resolveBodyValue(bucket, email.body_text),
    ]);
    return { html, text };
}

/** Return a copy of the email with R2-offloaded bodies resolved inline. */
export async function hydrateEmail(email: EmailRecord, bucket: R2Bucket | undefined): Promise<EmailRecord> {
    if (!isR2Pointer(email.body_html) && !isR2Pointer(email.body_text)) {
        return email;
    }
    const body = await resolveEmailBody(email, bucket);
    return {
        ...email,
        body_html: body.html,
        body_text: body.text,
    };
}

/** Email record with bodies resolved and internal R2 pointers stripped. */
export type PublicEmail = Omit<EmailRecord, 'body_html' | 'body_text' | 'raw_key'> & {
    bodyHtml: string | null;
    bodyText: string | null;
};

export async function toPublicEmail(email: EmailRecord, bucket: R2Bucket | undefined): Promise<PublicEmail> {
    const body = await resolveEmailBody(email, bucket);
    const { body_html, body_text, raw_key, ...rest } = email;
    return {
        ...rest,
        bodyHtml: body.html,
        bodyText: body.text,
    };
}
