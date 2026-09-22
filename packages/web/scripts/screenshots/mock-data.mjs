/**
 * Editable content for the README screenshots.
 *
 * Everything the screenshots show — the inbox list, the message reader and the
 * Telegram push mock — is driven from this file, so refreshing the images after
 * a UI change usually means running the generator again, not editing it.
 *
 * Dates are relative offsets from "now" (in minutes) so the screenshots always
 * look fresh: `minutesAgo: 30` renders as 30 minutes before the script runs.
 */

/** The recipient address shown across all mock mail. */
export const RECIPIENT = 'inbox@tbxark.dev';

/** The Telegram user shown by the Mini App. */
export const ME = {
    user: { id: 1, first_name: 'TBXark', username: 'tbxark' },
    resendEnabled: true,
    settings: {
        blockPolicy: ['reject', 'forward', 'telegram'],
        forwardList: [],
        guardianMode: true,
        maxEmailSize: 10485760,
        maxEmailSizePolicy: 'truncate',
        summaryEnabled: true,
        openaiApiKey: '',
        workersAiModel: '@cf/meta/llama-3.1-8b-instruct',
        openaiChatModel: 'gpt-4o-mini',
        openaiCompletionsApi: 'https://api.openai.com/v1/chat/completions',
        summaryTargetLang: 'english',
        forwardEnabled: false,
        autoCleanupDays: 168,
        attachmentSaveEnabled: true,
        attachmentMaxSize: 20971520,
    },
};

function minutesAgo(minutes) {
    return new Date(Date.now() - minutes * 60_000).toISOString();
}

const DAY = 24 * 60;

/**
 * The inbox list. `is_read: 0` rows render bold with a blue dot; the first
 * three are unread so the tab bar badge shows 3.
 */
export const EMAILS = [
    {
        id: 'm01',
        sender_name: 'GitHub',
        sender: 'noreply@github.com',
        subject: 'Release v2.0.0 · TBXark/mail2telegram',
        snippet:
            'Version 2.0.0 of TBXark/mail2telegram is now live. What is changed: split settings into pages, deep link notifications into the Mini App…',
        minutesAgo: 47,
        is_read: 0,
        is_starred: 0,
        has_attachments: 0,
        size: 18_432,
    },
    {
        id: 'm02',
        sender_name: 'Stripe',
        sender: 'receipts@stripe.com',
        subject: 'Your payout of $1,248.50 is on its way',
        snippet:
            'Your payout of $1,248.50 USD is on its way. It should arrive in your bank account in 1-2 business days. Bank: WELL…',
        minutesAgo: 143,
        is_read: 0,
        is_starred: 0,
        has_attachments: 0,
        size: 22_118,
    },
    {
        id: 'm03',
        sender_name: 'Airbnb',
        sender: 'automated@airbnb.com',
        subject: 'Your check-in details for the Sunset Loft',
        snippet:
            'Hi Dev, here is everything you need for a smooth arrival. The Sunset Loft is a 5-minute walk from the Shibuya Crossing…',
        minutesAgo: 212,
        is_read: 0,
        is_starred: 0,
        has_attachments: 1,
        size: 475_136,
    },
    {
        id: 'm04',
        sender_name: 'Figma',
        sender: 'updates@figma.com',
        subject: 'Alex Rivera mentioned you in Checkout Redesign',
        snippet:
            'Alex Rivera mentioned you in Checkout Redesign: can you double check the empty state on step 3 of the new flow?',
        minutesAgo: DAY + 96,
        is_read: 1,
        is_starred: 1,
        has_attachments: 0,
        size: 31_744,
    },
    {
        id: 'm05',
        sender_name: 'Cloudflare',
        sender: 'noreply@notify.cloudflare.com',
        subject: 'Weekly usage report for your account',
        snippet:
            'Your weekly usage report: Workers 184,203 requests, D1 32,118 rows read, R2 1.2 GB egress. Everything within plan limits…',
        minutesAgo: DAY + 152,
        is_read: 1,
        is_starred: 0,
        has_attachments: 0,
        size: 27_648,
    },
    {
        id: 'm06',
        sender_name: 'Apple',
        sender: 'no_reply@email.apple.com',
        subject: 'Your Apple Account code is 482913',
        snippet:
            'Use this code to complete Apple Account sign-in: 482913. If you did not attempt to sign in, ignore this email.',
        minutesAgo: DAY + 240,
        is_read: 1,
        is_starred: 0,
        has_attachments: 0,
        size: 9_216,
    },
    {
        id: 'm07',
        sender_name: 'Notion',
        sender: 'team@notionmail.com',
        subject: 'Monthly invoice: 3 additional workspace members',
        snippet:
            'Thanks for being a Plus customer. Your September invoice for 3 additional workspace members is now available.',
        minutesAgo: 2 * DAY + 30,
        is_read: 1,
        is_starred: 0,
        has_attachments: 1,
        size: 64_512,
    },
    {
        id: 'm08',
        sender_name: 'Vercel',
        sender: 'notifications@vercel.dev',
        subject: 'Deployment ready: mail2telegram (production)',
        snippet: 'Your deployment for mail2telegram is ready. Build finished in 42s and all checks passed.',
        minutesAgo: 2 * DAY + 300,
        is_read: 1,
        is_starred: 0,
        has_attachments: 0,
        size: 12_288,
    },
    {
        id: 'm09',
        sender_name: 'LinkedIn',
        sender: 'messages-noreply@linkedin.com',
        subject: 'You appeared in 27 searches this week',
        snippet: 'People found you while searching for full-stack engineers. See who viewed your profile this week.',
        minutesAgo: 3 * DAY + 120,
        is_read: 1,
        is_starred: 0,
        has_attachments: 0,
        size: 35_840,
    },
    {
        id: 'm10',
        sender_name: 'Amazon.com',
        sender: 'ship-confirm@amazon.com',
        subject: 'Your order has shipped: USB-C Cable 2-Pack',
        snippet:
            'Your package with USB-C Cable 2-Pack has shipped and arrives Wednesday. Track your delivery in Your Orders.',
        minutesAgo: 4 * DAY + 60,
        is_read: 1,
        is_starred: 0,
        has_attachments: 0,
        size: 28_672,
    },
    {
        id: 'm11',
        sender_name: 'Spotify',
        sender: 'no-reply@spotify.com',
        subject: 'Your Discover Weekly is here',
        snippet: 'Your weekly mixtape of fresh music. Enjoy new discoveries and old favorites, mixed just for you.',
        minutesAgo: 5 * DAY + 200,
        is_read: 1,
        is_starred: 0,
        has_attachments: 0,
        size: 15_360,
    },
    {
        id: 'm12',
        sender_name: 'Hacker Newsletter',
        sender: 'issue@hackernewsletter.com',
        subject: 'Issue #712: The Cult of the Diff',
        snippet:
            'This week: The Cult of the Diff, why calendars beat to-do lists, and a deep dive into the oldest running web server.',
        minutesAgo: 6 * DAY + 45,
        is_read: 1,
        is_starred: 0,
        has_attachments: 0,
        size: 88_064,
    },
];

/** Turns a spec above into a full `Email` row as the API returns it. */
export function toEmail(spec) {
    return {
        id: spec.id,
        message_id: `<${spec.id}.mock@tbxark.dev>`,
        folder: 'inbox',
        subject: spec.subject,
        sender: spec.sender,
        sender_name: spec.sender_name,
        recipient: RECIPIENT,
        cc: null,
        bcc: null,
        date: minutesAgo(spec.minutesAgo),
        is_read: spec.is_read,
        is_starred: spec.is_starred,
        snippet: spec.snippet,
        size: spec.size,
        in_reply_to: null,
        thread_id: null,
        has_attachments: spec.has_attachments,
        created_at: minutesAgo(spec.minutesAgo),
    };
}

/** The message opened in the reader and on the iPad split view. */
export const DETAIL_EMAIL_ID = 'm03';

export const DETAIL_BODY_HTML = `
<div style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;">
    <div style="background:#ff385c;padding:28px 32px;">
      <span style="color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">airbnb</span>
    </div>
    <div style="padding:32px;">
      <h1 style="margin:0 0 12px;font-size:24px;line-height:1.3;color:#222222;">Your check-in details for the Sunset Loft</h1>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#484848;">
        Hi Dev, here is everything you need for a smooth arrival. Your whole trip, from address to door code, lives in one place.
      </p>
      <div style="margin:0 0 24px;border-radius:12px;overflow:hidden;">
        <div style="height:150px;background:linear-gradient(135deg,#ff7a59,#ff385c);display:flex;align-items:center;justify-content:center;">
          <span style="color:rgba(255,255,255,0.92);font-size:15px;font-weight:600;letter-spacing:2px;">SUNSET LOFT · TOKYO</span>
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;margin:0 0 24px;font-size:14px;color:#484848;">
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #ebebeb;color:#767676;width:42%;">Check-in</td>
          <td style="padding:10px 0;border-bottom:1px solid #ebebeb;font-weight:600;color:#222222;">Saturday, Sep 19 · 3:00 PM – 8:00 PM</td>
        </tr>
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #ebebeb;color:#767676;">Checkout</td>
          <td style="padding:10px 0;border-bottom:1px solid #ebebeb;font-weight:600;color:#222222;">Thursday, Sep 24 · 11:00 AM</td>
        </tr>
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #ebebeb;color:#767676;">Address</td>
          <td style="padding:10px 0;border-bottom:1px solid #ebebeb;font-weight:600;color:#222222;">2-11-3 Shibuya, Tokyo (door code 5842#)</td>
        </tr>
        <tr>
          <td style="padding:10px 0;color:#767676;">Host</td>
          <td style="padding:10px 0;font-weight:600;color:#222222;">Sunlit Loft · Entire loft, 4 guests</td>
        </tr>
      </table>
      <h2 style="margin:0 0 10px;font-size:17px;color:#222222;">Before you arrive</h2>
      <ul style="margin:0 0 24px;padding-left:22px;font-size:14px;line-height:1.8;color:#484848;">
        <li>Self check-in with the smart lock, code sent 24 hours before arrival</li>
        <li>Pocket wifi is on the desk next to the kitchen</li>
        <li>Quiet hours are from 10:00 PM to 8:00 AM</li>
      </ul>
      <a href="https://example.com" style="display:inline-block;background:#ff385c;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:8px;">View your itinerary</a>
    </div>
    <div style="padding:20px 32px;border-top:1px solid #ebebeb;font-size:12px;color:#767676;">
      You are receiving this email because you have a reservation with Airbnb. © 2026 Airbnb, Inc.
    </div>
  </div>
</div>
`;

export const DETAIL_BODY_TEXT = `Hi Dev, here is everything you need for a smooth arrival.

CHECK-IN
Saturday, Sep 19 · 3:00 PM - 8:00 PM
2-11-3 Shibuya, Tokyo (door code 5842#)

CHECKOUT
Thursday, Sep 24 · 11:00 AM

BEFORE YOU ARRIVE
- Self check-in with the smart lock, code sent 24 hours before arrival
- Pocket wifi is on the desk next to the kitchen
- Quiet hours are from 10:00 PM to 8:00 AM

View your itinerary: https://example.com

You are receiving this email because you have a reservation with Airbnb.
`;

export const DETAIL_ATTACHMENTS = [
    {
        id: 'a1',
        email_id: 'm03',
        filename: 'booking-confirmation.pdf',
        mimetype: 'application/pdf',
        size: 241_152,
        content_id: null,
        disposition: 'attachment',
    },
    {
        id: 'a2',
        email_id: 'm03',
        filename: 'loft-house-guide.pdf',
        mimetype: 'application/pdf',
        size: 233_984,
        content_id: null,
        disposition: 'attachment',
    },
];

/**
 * The Telegram push mock: two notifications grouped under day separators, the
 * way a real chat looks. `time` is rendered in the corner of each bubble.
 */
export const TELEGRAM_PUSH = {
    chatTitle: 'mail2telegram',
    chatSubtitle: 'bot',
    statusBarTime: '12:51',
    batteryPercent: 48,
    groups: [
        {
            label: 'September 12',
            messages: [
                {
                    subject: 'Stripe: Your payout of $1,248.50 is on its way',
                    from: 'receipts@stripe.com',
                    to: RECIPIENT,
                    time: '22:35',
                },
            ],
        },
        {
            label: 'Today',
            messages: [
                {
                    subject: 'Airbnb: Your check-in details for the Sunset Loft',
                    from: 'automated@airbnb.com',
                    to: RECIPIENT,
                    time: '09:41',
                },
            ],
        },
    ],
    /** Inline keyboard row under each push. `miniapp` draws the small square icon. */
    buttons: [{ label: 'Preview' }, { label: 'Summary' }, { label: 'Open', miniapp: true }],
};
