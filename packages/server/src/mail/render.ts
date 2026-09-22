import type * as Telegram from 'telegram-bot-api-types';
import type { EmailRecord, Environment, RuntimeSettings } from '../types';
import { checkAddressStatus } from './check';
import { summarizeEmail, summaryEnabled } from './summarization';

export interface EmailDetailParams {
    text: string;
    reply_markup: Telegram.InlineKeyboardMarkup;
    link_preview_options: Telegram.LinkPreviewOptions;
}

export interface EmailListRenderOptions {
    /**
     * Destination chat type. Telegram only allows `web_app` buttons in private
     * chats, so group and channel notifications omit the Open button instead of
     * failing to send.
     */
    chatType?: string;
}

export type EmailRender = (
    mail: EmailRecord,
    env: Environment,
    settings: RuntimeSettings,
    options?: EmailListRenderOptions,
) => Promise<EmailDetailParams>;

function sendableText(mail: EmailRecord): string {
    return mail.body_text ?? '';
}

export async function renderEmailListMode(
    mail: EmailRecord,
    env: Environment,
    settings: RuntimeSettings,
    options: EmailListRenderOptions = {},
): Promise<EmailDetailParams> {
    const { DEBUG, DOMAIN } = env;
    const text = `${mail.subject}\n\n-----------\nFrom\t:\t${mail.sender}\nTo\t\t:\t${mail.recipient}`;
    const keyboard: Telegram.InlineKeyboardButton[] = [
        {
            text: 'Preview',
            callback_data: `p:${mail.id}`,
        },
    ];
    if (summaryEnabled(env, settings)) {
        keyboard.push({
            text: 'Summary',
            callback_data: `s:${mail.id}`,
        });
    }
    // Telegram only allows `web_app` buttons in private chats. Without a
    // discovered domain (DOMAIN unset and /init not run yet) the Mini App URL
    // cannot be built, so the Open button is omitted rather than broken.
    if (DOMAIN && (options.chatType === undefined || options.chatType === 'private')) {
        keyboard.push({
            text: 'Open',
            web_app: {
                url: `https://${DOMAIN}/#/mail/${mail.id}`,
            },
        });
    }
    if (DEBUG === 'true') {
        keyboard.push({
            text: 'Debug',
            callback_data: `d:${mail.id}`,
        });
    }
    return {
        text,
        reply_markup: {
            inline_keyboard: [keyboard],
        },
        link_preview_options: {
            is_disabled: true,
        },
    };
}

function renderEmailDetail(text: string | undefined | null, id: string): EmailDetailParams {
    return {
        text: text || 'No content',
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text: 'Back',
                        callback_data: `l:${id}`,
                    },
                    {
                        text: 'Delete',
                        callback_data: 'delete',
                    },
                ],
            ],
        },
        link_preview_options: {
            is_disabled: true,
        },
    };
}

// Uses the same three-argument shape as the other render modes so callers can
// swap them; `env` and `settings` are not needed in preview mode.
/* oxlint-disable no-unused-vars */
export async function renderEmailPreviewMode(
    mail: EmailRecord,
    env: Environment,
    settings: RuntimeSettings,
): Promise<EmailDetailParams> {
    return renderEmailDetail(sendableText(mail).substring(0, 4096), mail.id);
}
/* oxlint-enable no-unused-vars */

export async function renderEmailSummaryMode(
    mail: EmailRecord,
    env: Environment,
    settings: RuntimeSettings,
): Promise<EmailDetailParams> {
    const req = renderEmailDetail('', mail.id);
    try {
        // Same provider selection and body truncation as the Mini App endpoint.
        req.text = await summarizeEmail(mail, env, settings);
    } catch (e) {
        req.text = `Failed to summarize the email: ${(e as Error).message}`;
    }
    return req;
}

export async function renderEmailDebugMode(
    mail: EmailRecord,
    env: Environment,
    settings: RuntimeSettings,
): Promise<EmailDetailParams> {
    const res = await checkAddressStatus([mail.sender, mail.recipient], env);
    const obj = {
        id: mail.id,
        messageId: mail.message_id,
        folder: mail.folder,
        subject: mail.subject,
        from: mail.sender,
        to: mail.recipient,
        date: mail.date,
        size: mail.size,
        // The dump is delivered into a chat, which may hold more members than
        // the owner; never render provider credentials into it. The base URL is
        // masked too because a userinfo segment or query parameter can carry a
        // token, and the key alone would not cover that.
        settings: {
            ...settings,
            openaiApiKey: settings.openaiApiKey ? '<redacted>' : '',
            openaiBaseUrl: maskUrl(settings.openaiBaseUrl),
        },
        block: res,
    };
    const text = JSON.stringify(obj, null, 2);
    return renderEmailDetail(text, mail.id);
}

/**
 * Keeps the base URL informative while dropping anything that can carry a
 * credential: the whole userinfo segment, the query string and the fragment.
 */
function maskUrl(value: string): string {
    if (!value) {
        return value;
    }
    try {
        const url = new URL(value);
        if (url.username || url.password) {
            url.username = 'redacted';
            url.password = '';
        }
        url.search = '';
        url.hash = '';
        return url.toString();
    } catch {
        return value;
    }
}
