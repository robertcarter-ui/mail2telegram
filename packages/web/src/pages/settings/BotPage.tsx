import { List, ListItem, Preloader } from 'konsta/react';
import { useState } from 'react';
import { api } from '../../api/client';
import { haptic } from '../../lib/haptics';
import { SettingsSubPage } from './SettingsSubPage';

interface ActionState {
    status: 'idle' | 'running' | 'ok' | 'error';
    message?: string;
}

const idle: ActionState = { status: 'idle' };

/** Bot commands reference plus webhook rebind and env migration actions. */
export function BotPage() {
    const [rebindState, setRebindState] = useState<ActionState>(idle);
    const [importState, setImportState] = useState<ActionState>(idle);

    const rebind = async () => {
        setRebindState({ status: 'running' });
        haptic.impact();
        try {
            const result = await api.rebindWebhook();
            const ok = result?.webhook?.ok !== false;
            setRebindState({
                status: ok ? 'ok' : 'error',
                message: result?.webhook?.description || 'Webhook re-registered.',
            });
            haptic.notification(ok ? 'success' : 'error');
        } catch (e) {
            setRebindState({ status: 'error', message: (e as Error).message });
            haptic.notification('error');
        }
    };

    const importEnv = async () => {
        setImportState({ status: 'running' });
        haptic.impact();
        try {
            const result = await api.importEnvSettings();
            const { white, block } = result.importedAddresses;
            setImportState({
                status: 'ok',
                message: `Settings imported. ${white} allow and ${block} block ${white + block === 1 ? 'rule' : 'rules'} added.`,
            });
            haptic.notification('success');
        } catch (e) {
            setImportState({ status: 'error', message: (e as Error).message });
            haptic.notification('error');
        }
    };

    return (
        <SettingsSubPage title="Bot & Webhook">
            <div className="settings-section-title">Webhook</div>
            <List strongIos outlineIos className="!mt-0">
                <ListItem
                    link
                    title={rebindState.status === 'running' ? 'Rebinding…' : 'Rebind Webhook'}
                    onClick={rebindState.status === 'running' ? undefined : rebind}
                    className={rebindState.status === 'running' ? 'opacity-60' : ''}
                    after={rebindState.status === 'running' ? <Preloader /> : undefined}
                />
            </List>
            <div className="settings-note">
                Re-registers the Telegram webhook, the bot command list and the menu button. Run this after changing the
                worker domain or when the bot stops responding.
            </div>
            {rebindState.message ? (
                <div
                    className="settings-note"
                    style={{ color: rebindState.status === 'error' ? '#ff3b30' : 'var(--ios-gray)' }}
                >
                    {rebindState.message}
                </div>
            ) : null}

            <div className="settings-section-title">Migration</div>
            <List strongIos outlineIos className="!mt-0">
                <ListItem
                    link
                    title={importState.status === 'running' ? 'Importing…' : 'Import from Environment'}
                    onClick={importState.status === 'running' ? undefined : importEnv}
                    className={importState.status === 'running' ? 'opacity-60' : ''}
                    after={importState.status === 'running' ? <Preloader /> : undefined}
                />
            </List>
            <div className="settings-note">
                Copies the deployment variables into the app's stored settings: block policy, forwarding, mail limits,
                summary options and the allow/block lists. After importing you can remove those variables from the
                worker config — everything else is managed here. The bot token, chat IDs, domain and API keys stay in
                the deployment.
            </div>
            {importState.message ? (
                <div
                    className="settings-note"
                    style={{ color: importState.status === 'error' ? '#ff3b30' : 'var(--ios-gray)' }}
                >
                    {importState.message}
                </div>
            ) : null}

            <div className="settings-section-title">Commands</div>
            <List strongIos outlineIos className="!mt-0">
                <ListItem title="/start" after="Open Mini App" />
            </List>
            <div className="settings-note">
                The first /start also binds the webhook and points the bot menu button at this worker. Reply to any
                forwarded message in Telegram to answer the sender through Resend.
            </div>
        </SettingsSubPage>
    );
}
