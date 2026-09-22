import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { Preloader } from 'konsta/react';
import { api } from '../api/client';
import { LandingPage } from './LandingPage';

interface LoginPageProps {
    /** Called once the password is accepted so the app can reload `/api/me`. */
    onSuccess: () => void;
}

/**
 * Sign-in gate shown when the app is opened outside Telegram. The worker only
 * accepts the web password when `WEB_PASSWORD` is configured; otherwise this
 * page falls back to the project landing, because the Mini App is the only way
 * in.
 */
export function LoginPage({ onSuccess }: LoginPageProps) {
    // `null` while the public `/api/auth` probe is in flight.
    const [passwordEnabled, setPasswordEnabled] = useState<boolean | null>(null);
    const [password, setPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        api.authOptions()
            .then(options => {
                if (!cancelled) {
                    setPasswordEnabled(options.passwordEnabled);
                }
            })
            .catch(() => {
                // Older worker without `/api/auth`: offer the form anyway and
                // let the submit surface the real error.
                if (!cancelled) {
                    setPasswordEnabled(true);
                }
            });
        return () => {
            cancelled = true;
        };
    }, []);

    if (passwordEnabled === null) {
        return (
            <div className="spin-center" style={{ height: '100vh' }}>
                <Preloader />
            </div>
        );
    }
    if (!passwordEnabled) {
        // Password access is disabled: the Telegram Mini App is the only entry,
        // so keep the explanatory landing page that was always shown here.
        return <LandingPage />;
    }

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (submitting || !password) {
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            await api.loginWithPassword(password);
            onSuccess();
        } catch (e) {
            setError((e as Error).message || 'Sign in failed');
            setSubmitting(false);
        }
    };

    return (
        <div className="login">
            <form className="login__card" onSubmit={submit}>
                <div className="login__brand">mail2telegram</div>
                <h1 className="login__title">Sign In</h1>
                <p className="login__hint">
                    Enter the web password (<code>WEB_PASSWORD</code>) set on the worker to open this inbox outside
                    Telegram.
                </p>
                <input
                    className="login__input"
                    type="password"
                    name="password"
                    autoComplete="current-password"
                    autoFocus
                    placeholder="Password"
                    value={password}
                    disabled={submitting}
                    onChange={event => setPassword(event.target.value)}
                />
                {error ? <p className="login__error">{error}</p> : null}
                <button type="submit" className="login__button" disabled={submitting || !password}>
                    {submitting ? 'Signing In…' : 'Sign In'}
                </button>
                <a className="login__landing-link" href="?landing">
                    About mail2telegram
                </a>
            </form>
        </div>
    );
}
