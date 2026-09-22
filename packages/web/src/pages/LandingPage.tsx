import { useState } from 'react';
import { api } from '../api/client';
import {
    AttachmentIcon,
    CheckIcon,
    DevicesIcon,
    FastForwardIcon,
    GitHubIcon,
    InboxIcon,
    MailIcon,
    ReplyIcon,
    SentIcon,
    SparkleIcon,
} from '../components/ios/Icons';

const REPO_URL = 'https://github.com/TBXark/mail2telegram';

interface BindState {
    status: 'idle' | 'running' | 'ok' | 'error';
    message?: string;
}

interface Feature {
    Icon: typeof MailIcon;
    title: string;
    text: string;
}

const FEATURES: Feature[] = [
    {
        Icon: SentIcon,
        title: 'Instant Push',
        text: 'Every incoming mail arrives as a Telegram notification with Preview, Summary and Open buttons.',
    },
    {
        Icon: InboxIcon,
        title: 'Mini App Inbox',
        text: 'Browse the full history by folder with search, unread and starred filters.',
    },
    {
        Icon: ReplyIcon,
        title: 'Reply Anywhere',
        text: 'Answer the sender from the chat or the Mini App, delivered through Resend.',
    },
    {
        Icon: SparkleIcon,
        title: 'AI Summaries',
        text: 'One tap summarizes long mail via Workers AI or any OpenAI-compatible API.',
    },
    {
        Icon: CheckIcon,
        title: 'Sender Rules',
        text: 'White and block lists with regex matching, an address tester and per-list policies.',
    },
    {
        Icon: AttachmentIcon,
        title: 'Attachments',
        text: 'Files are stored in R2 and can be downloaded from the message reader.',
    },
    {
        Icon: FastForwardIcon,
        title: 'Auto Forwarding',
        text: 'Keep a backup copy at your real address through Email Routing.',
    },
    {
        Icon: DevicesIcon,
        title: 'iOS & iPadOS UI',
        text: 'A flat native-feeling interface: tab bar on phones, split view on wide screens.',
    },
];

interface Step {
    title: string;
    children: React.ReactNode;
}

const STEPS: Step[] = [
    {
        title: 'Create a Telegram bot',
        children: (
            <>
                Start a chat with <code>@BotFather</code>, run <code>/newbot</code> and copy the token. Set the bot
                privacy policy to <code>https://telegram.org/privacy-tpa</code> to enable Mini Apps.
            </>
        ),
    },
    {
        title: 'Deploy to Cloudflare Workers',
        children: (
            <>
                Create a <code>D1</code> database and an <code>R2</code> bucket, then connect this repository in the
                Cloudflare dashboard or run <code>pnpm run deploy</code>. Set <code>TELEGRAM_TOKEN</code> and{' '}
                <code>TELEGRAM_ID</code> on the worker; the worker address is discovered automatically during setup.
            </>
        ),
    },
    {
        title: 'Bind Email Routing',
        children: (
            <>
                In your Cloudflare zone, point the <code>Email Routing</code> catch-all rule at the{' '}
                <code>mail2telegram</code> worker, then send <code>/start</code> to your bot and open the Mini App.
            </>
        ),
    },
];

/**
 * Landing page shown when the app is opened outside Telegram, where initData
 * validation can never succeed. It doubles as the project introduction and a
 * short setup guide for self-hosting.
 */
export function LandingPage() {
    // The /init endpoint is public and takes no input: it only re-registers
    // this worker's own webhook, commands and menu button, so the button below
    // cannot leak or misuse anything.
    const [bind, setBind] = useState<BindState>({ status: 'idle' });

    const runBinding = async () => {
        setBind({ status: 'running' });
        try {
            const result = await api.rebindWebhook();
            const ok = result?.webhook?.ok !== false;
            setBind({
                status: ok ? 'ok' : 'error',
                message: ok
                    ? `Webhook bound. Send /start to your bot in Telegram.${result?.webhook?.description ? ` (${result.webhook.description})` : ''}`
                    : `Binding failed. ${result?.webhook?.description || ''}`.trim(),
            });
        } catch (e) {
            setBind({ status: 'error', message: (e as Error).message });
        }
    };

    return (
        <div className="landing">
            <div className="landing__wrap">
                <nav className="landing__nav">
                    <span>mail2telegram</span>
                    <a className="landing__nav-link" href={REPO_URL} target="_blank" rel="noreferrer">
                        <GitHubIcon size={18} />
                        GitHub
                    </a>
                </nav>

                <header className="landing__hero">
                    <h1 className="landing__title">Your email, delivered to Telegram.</h1>
                    <p className="landing__subtitle">
                        mail2telegram forwards incoming mail to Telegram as instant push notifications and keeps a full,
                        searchable inbox in a Mini App. Self-hosted on Cloudflare Workers, free tier friendly.
                    </p>
                    <div className="landing__actions">
                        <a className="landing__button" href={REPO_URL} target="_blank" rel="noreferrer">
                            Get Started
                        </a>
                        <a
                            className="landing__button landing__button--secondary"
                            href={`${REPO_URL}#readme`}
                            target="_blank"
                            rel="noreferrer"
                        >
                            Documentation
                        </a>
                    </div>

                    <div className="landing__flow">
                        <span className="landing__flow-step">
                            <span className="landing__flow-icon">
                                <MailIcon size={20} />
                            </span>
                            Email
                        </span>
                        <span className="landing__flow-arrow">→</span>
                        <span className="landing__flow-step">
                            <span className="landing__flow-icon">
                                <SentIcon size={20} />
                            </span>
                            Telegram push
                        </span>
                        <span className="landing__flow-arrow">→</span>
                        <span className="landing__flow-step">
                            <span className="landing__flow-icon">
                                <InboxIcon size={20} />
                            </span>
                            Mini App inbox
                        </span>
                    </div>
                </header>

                <h2 className="landing__section-title">Features</h2>
                <div className="landing__grid">
                    {FEATURES.map(({ Icon, title, text }) => (
                        <div key={title} className="landing__card">
                            <span className="landing__card-icon">
                                <Icon size={20} />
                            </span>
                            <h3 className="landing__card-title">{title}</h3>
                            <p className="landing__card-text">{text}</p>
                        </div>
                    ))}
                </div>

                <h2 className="landing__section-title">Self-host in three steps</h2>
                <div>
                    {STEPS.map((step, index) => (
                        <div key={step.title} className="landing__step">
                            <span className="landing__step-num">{index + 1}</span>
                            <div>
                                <div className="landing__step-title">{step.title}</div>
                                <p className="landing__step-text">{step.children}</p>
                            </div>
                        </div>
                    ))}
                </div>
                <p className="landing__more">
                    Full deployment and configuration reference in the{' '}
                    <a href={`${REPO_URL}/blob/master/docs/DEPLOY.md`} target="_blank" rel="noreferrer">
                        Deployment Guide
                    </a>
                    .
                </p>

                <h2 className="landing__section-title">One-Click Binding</h2>
                <div className="landing__bind">
                    <div className="landing__bind-row">
                        <div>
                            <div className="landing__step-title">Register webhook &amp; menu button</div>
                            <p className="landing__step-text">
                                Already deployed? Bind the webhook, bot commands and menu button to this worker right
                                here, without opening Telegram first. The action is public but parameter-less: it can
                                only ever register this deployment.
                            </p>
                        </div>
                        <button
                            type="button"
                            className="landing__button landing__button--bind"
                            disabled={bind.status === 'running'}
                            onClick={runBinding}
                        >
                            {bind.status === 'running' ? 'Binding…' : 'Bind Now'}
                        </button>
                    </div>
                    {bind.message ? (
                        <p
                            className={`landing__bind-status ${bind.status === 'error' ? 'landing__bind-status--error' : 'landing__bind-status--ok'}`}
                        >
                            {bind.message}
                        </p>
                    ) : null}
                </div>

                <footer className="landing__footer">
                    <div className="landing__notice">
                        This page appears when the Mini App is opened outside Telegram. If this is your deployment, open
                        the bot in Telegram and send <code>/start</code>.
                    </div>
                    <div>
                        <a href={REPO_URL} target="_blank" rel="noreferrer">
                            GitHub
                        </a>
                        {' · '}
                        <a href={`${REPO_URL}/blob/master/LICENSE`} target="_blank" rel="noreferrer">
                            MIT License
                        </a>
                        {' · Built with Cloudflare Workers & Telegram Mini Apps'}
                    </div>
                </footer>
            </div>
        </div>
    );
}
