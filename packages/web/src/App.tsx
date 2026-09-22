import type { MeResponse } from '@mail2telegram/shared';
import { App as KonstaApp, Preloader } from 'konsta/react';
import { useCallback, useEffect, useState } from 'react';
import {
    HashRouter,
    Navigate,
    Outlet,
    Route,
    Routes,
    useLocation,
    useNavigate,
    useOutletContext,
    useSearchParams,
} from 'react-router-dom';
import { api } from './api/client';
import { AppProvider } from './AppContext';
import { MessageReader } from './components/ios/MessageReader';
import { useAsync } from './hooks/useAsync';
import { useMediaQuery } from './hooks/useMediaQuery';
import { useDarkMode } from './hooks/useTheme';
import { isTelegramEnvironment } from './init';
import { MessageTabBar } from './layout/TabBar';
import { InboxPage } from './pages/InboxPage';
import { ComposePage } from './pages/ComposePage';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { MailPage } from './pages/MailPage';
import { AddressListPage } from './pages/settings/AddressListPage';
import { BotPage } from './pages/settings/BotPage';
import { CleanupPage } from './pages/settings/CleanupPage';
import { ForwardingPage } from './pages/settings/ForwardingPage';
import { HandlingPage } from './pages/settings/HandlingPage';
import { SettingsHub } from './pages/settings/SettingsHub';
import { SummariesPage } from './pages/settings/SummariesPage';

/** Below this width the app uses the single column phone layout. */
export const SPLIT_MIN_WIDTH = 720;

/**
 * Layout chrome around the routed pages.
 *
 * Width decides between the phone layout (single column plus tab bar) and the
 * split layout (mail list on the left with a Settings button, detail on the
 * right, never a tab bar). Settings is a normal route shown in the detail
 * column, so neither layout needs a nested router.
 */
function Layout() {
    const location = useLocation();
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const [unread, setUnread] = useState(0);
    // Bumped when the detail column edits or removes mail so the list reloads.
    const [refreshToken, setRefreshToken] = useState(0);
    const bumpRefresh = useCallback(() => setRefreshToken(token => token + 1), []);

    const split = useMediaQuery(`(min-width: ${SPLIT_MIN_WIDTH}px)`);
    const selectedId = params.get('id');
    const isSettings = location.pathname.startsWith('/settings');
    const isCompose = location.pathname.startsWith('/compose');
    // Deep link opened by the Open button on a Telegram notification.
    const mailId = location.pathname.startsWith('/mail/') ? location.pathname.slice('/mail/'.length) : null;

    const onUnreadChange = useCallback((value: number) => setUnread(value), []);
    const closeReader = useCallback(() => {
        const next = new URLSearchParams(params);
        next.delete('id');
        navigate({ pathname: '/inbox', search: next.toString() });
    }, [navigate, params]);
    const openCompose = useCallback(() => navigate('/compose'), [navigate]);
    const closeCompose = useCallback(() => navigate('/inbox'), [navigate]);
    const finishCompose = useCallback(() => {
        // A sent mail lands in the Sent folder, so the list only needs the
        // unread badge to stay honest — but a refresh is cheap and harmless.
        bumpRefresh();
        navigate('/inbox');
    }, [bumpRefresh, navigate]);

    if (split) {
        const detail = isCompose ? (
            <ComposePage onClose={closeCompose} onSent={finishCompose} />
        ) : isSettings ? (
            <Outlet context={{ onUnreadChange }} />
        ) : mailId ? (
            <MessageReader
                key={mailId}
                emailId={mailId}
                onChanged={bumpRefresh}
                onBack={() => navigate('/inbox')}
                onDeleted={() => {
                    bumpRefresh();
                    navigate('/inbox');
                }}
            />
        ) : selectedId ? (
            <MessageReader
                key={selectedId}
                emailId={selectedId}
                onChanged={bumpRefresh}
                onDeleted={() => {
                    bumpRefresh();
                    closeReader();
                }}
            />
        ) : (
            <div className="reader-empty">No Message Selected</div>
        );
        return (
            <div className="split-view split-view--two">
                <div className="split-column">
                    <InboxPage
                        selectedId={selectedId}
                        onSelect={id => (id ? navigate(`/inbox?id=${id}`) : closeReader())}
                        hasSidebar
                        isSettings={isSettings}
                        refreshToken={refreshToken}
                        onOpenSettings={() => navigate(isSettings ? '/inbox' : '/settings')}
                        onCompose={openCompose}
                        onUnreadChange={onUnreadChange}
                    />
                </div>
                <div className="split-column">{detail}</div>
            </div>
        );
    }

    // On the phone the mail detail and compose routes fill the screen like an
    // opened message, so they get no tab bar. Back returns to the inbox.
    if (mailId || isCompose) {
        return (
            <div className="app-shell">
                <div className="app-shell__content">
                    <Outlet context={{ onUnreadChange, onMailChanged: bumpRefresh, refreshToken }} />
                </div>
            </div>
        );
    }

    return (
        <div className="app-shell">
            <div className="app-shell__content">
                <Outlet context={{ onUnreadChange, onMailChanged: bumpRefresh, refreshToken }} />
            </div>
            <MessageTabBar
                active={isSettings ? 'settings' : 'inbox'}
                unread={unread}
                onChange={tab => navigate(tab === 'settings' ? '/settings' : '/inbox')}
            />
            {selectedId && !isSettings ? (
                <div className="fixed inset-0 z-40 flex flex-col bg-[var(--ios-surface)]">
                    <MessageReader
                        key={selectedId}
                        emailId={selectedId}
                        onChanged={bumpRefresh}
                        onBack={closeReader}
                        onDeleted={() => {
                            bumpRefresh();
                            closeReader();
                        }}
                    />
                </div>
            ) : null}
        </div>
    );
}

/** Phone-only inbox list; the split layout renders InboxPage directly. */
function InboxRoute() {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const selectedId = params.get('id');
    const { onUnreadChange, refreshToken } = useOutletContext<{
        onUnreadChange: (value: number) => void;
        refreshToken: number;
    }>();

    return (
        <InboxPage
            selectedId={selectedId}
            onSelect={id => {
                if (!id) {
                    const next = new URLSearchParams(params);
                    next.delete('id');
                    navigate({ pathname: '/inbox', search: next.toString() });
                    return;
                }
                navigate(`/inbox?id=${id}`);
            }}
            hasSidebar={false}
            refreshToken={refreshToken}
            onCompose={() => navigate('/compose')}
            onUnreadChange={onUnreadChange}
        />
    );
}

/** Phone-only compose screen; the split layout renders ComposePage directly. */
function ComposeRoute() {
    const { onMailChanged } = useOutletContext<{
        onMailChanged?: () => void;
    }>();
    const navigate = useNavigate();
    return (
        <ComposePage
            onClose={() => navigate('/inbox')}
            onSent={() => {
                onMailChanged?.();
                navigate('/inbox');
            }}
        />
    );
}

function AppInner() {
    const dark = useDarkMode();
    const [params, setParams] = useSearchParams();
    const { data, loading, error, reload } = useAsync<MeResponse>(() => api.me(), []);

    // First-time /start opens the Mini App with ?setup=1; bind the webhook and
    // set the bot menu button automatically, then drop the flag from the URL.
    useEffect(() => {
        if (params.get('setup') !== '1') {
            return;
        }
        const next = new URLSearchParams(params);
        next.delete('setup');
        setParams(next, { replace: true });
        api.rebindWebhook().catch(e => {
            console.error('[app] auto webhook setup failed', e);
        });
    }, [params, setParams]);

    // Keep the document palette in sync so `color-scheme`, our CSS variables and
    // Konsta's dark variants all describe the same theme.
    useEffect(() => {
        document.documentElement.classList.toggle('dark', dark);
    }, [dark]);

    // `?landing` previews the non-Telegram landing page. It stays after the
    // effects so the dark palette still applies to the landing.
    if (new URLSearchParams(window.location.search).has('landing')) {
        return <LandingPage />;
    }

    if (loading && !data) {
        return (
            <div className="spin-center" style={{ height: '100vh' }}>
                <Preloader />
            </div>
        );
    }
    if (error || !data) {
        // Outside Telegram there is no initData: offer the web password login,
        // which falls back to the landing page when no password is configured.
        if (!isTelegramEnvironment()) {
            return <LoginPage onSuccess={reload} />;
        }
        return (
            <div className="reader-empty" style={{ height: '100vh' }}>
                <div>
                    <p className="mb-3">
                        {error?.message || 'Unable to authenticate with Telegram. Reopen the Mini App from the bot.'}
                    </p>
                    <button type="button" className="text-button" onClick={reload}>
                        Try Again
                    </button>
                </div>
            </div>
        );
    }

    return (
        <KonstaApp theme="ios" safeAreas dark={dark} className={dark ? 'dark' : ''}>
            <AppProvider value={{ me: data, refreshMe: reload }}>
                <Routes>
                    <Route element={<Layout />}>
                        <Route path="/" element={<Navigate to="/inbox" replace />} />
                        <Route path="/inbox" element={<InboxRoute />} />
                        <Route path="/compose" element={<ComposeRoute />} />
                        <Route path="/mail/:id" element={<MailPage />} />
                        <Route path="/settings" element={<Outlet />}>
                            <Route index element={<SettingsHub />} />
                            <Route path="white" element={<AddressListPage type="white" />} />
                            <Route path="block" element={<AddressListPage type="block" />} />
                            <Route path="forwarding" element={<ForwardingPage />} />
                            <Route path="summaries" element={<SummariesPage />} />
                            <Route path="handling" element={<HandlingPage />} />
                            <Route path="cleanup" element={<CleanupPage />} />
                            <Route path="bot" element={<BotPage />} />
                            <Route path="*" element={<Navigate to="/settings" replace />} />
                        </Route>
                        <Route path="*" element={<Navigate to="/inbox" replace />} />
                    </Route>
                </Routes>
            </AppProvider>
        </KonstaApp>
    );
}

/** Root application: iOS Mail style shell with hash-based routing. */
export function App() {
    return (
        <HashRouter>
            <AppInner />
        </HashRouter>
    );
}
