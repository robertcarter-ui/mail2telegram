import type { SettingsResponse } from '@mail2telegram/shared';
import { List, ListItem, Preloader } from 'konsta/react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { NavBar } from '../../components/ios/NavBar';
import { useAsync } from '../../hooks/useAsync';

interface Section {
    path: string;
    title: string;
    value: string;
}

/** Settings index: a short grouped list linking to each settings section. */
export function SettingsHub() {
    const navigate = useNavigate();
    const onExit = () => navigate('/inbox');
    const { data, loading, error, reload } = useAsync<SettingsResponse>(() => api.getSettings(), []);
    const { data: addresses } = useAsync(() => api.listAddresses(), []);

    if (loading && !data) {
        return (
            <div className="split-column">
                <NavBar title="Settings" onBack={onExit} />
                <div className="spin-center">
                    <Preloader />
                </div>
            </div>
        );
    }
    if (error || !data) {
        return (
            <div className="split-column">
                <NavBar title="Settings" onBack={onExit} />
                <div className="reader-empty">
                    <div>
                        <p className="mb-3">{error?.message || 'Settings could not be loaded.'}</p>
                        <button type="button" className="text-button" onClick={reload}>
                            Try Again
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    const settings = data.settings;
    const counts = (type: 'white' | 'block') => addresses?.addresses.filter(a => a.type === type).length ?? 0;

    const sections: Section[] = [
        { path: 'block', title: 'Blocked Senders', value: `${counts('block')}` },
        { path: 'white', title: 'Always Deliver', value: `${counts('white')}` },
        { path: 'forwarding', title: 'Forwarding', value: settings.forwardEnabled ? 'On' : 'Off' },
        { path: 'summaries', title: 'Summaries', value: settings.summaryEnabled ? settings.summaryTargetLang : 'Off' },
        {
            path: 'handling',
            title: 'Mail Handling',
            value: settings.autoCleanupDays > 0 ? `${settings.autoCleanupDays}d cleanup` : 'no auto cleanup',
        },
        { path: 'cleanup', title: 'Clear Mail', value: '' },
        { path: 'bot', title: 'Bot & Webhook', value: '' },
    ];

    return (
        <div className="split-column">
            <NavBar title="Settings" onBack={onExit} />
            <div className="page-scroll">
                <List strongIos outlineIos className="!mt-3">
                    {sections.map(section => (
                        <ListItem
                            key={section.path}
                            link
                            title={section.title}
                            /* Konsta's `link` already draws the trailing chevron,
                               so the value alone goes in `after`. */
                            after={<span className="text-[15px] text-[var(--ios-gray)]">{section.value}</span>}
                            onClick={() => navigate(`/settings/${section.path}`)}
                        />
                    ))}
                </List>
                <div className="settings-note">
                    Blocked mail policy, address lists, forwarding, summaries and mail limits are each on their own
                    page.
                </div>
                <div style={{ height: 24 }} />
            </div>
        </div>
    );
}
