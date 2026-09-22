import type { RuntimeSettings, SummaryProvider } from '@mail2telegram/shared';
import { List, ListInput, ListItem, Segmented, SegmentedButton } from 'konsta/react';
import { useState } from 'react';
import { api } from '../../api/client';
import { haptic } from '../../lib/haptics';
import { ToggleRow } from '../../components/ios/ToggleRow';
import { ModelPickerSheet } from './ModelPickerSheet';
import { SettingsSubPage } from './SettingsSubPage';
import { useSettingsDraft } from './useSettingsDraft';

const SUMMARY_LANGS: { value: string; label: string }[] = [
    { value: 'english', label: 'English' },
    { value: 'chinese', label: 'Chinese' },
    { value: 'japanese', label: 'Japanese' },
    { value: 'korean', label: 'Korean' },
    { value: 'spanish', label: 'Spanish' },
    { value: 'french', label: 'French' },
    { value: 'german', label: 'German' },
];

const PROVIDER_LABEL: Record<SummaryProvider, string> = {
    'workers-ai': 'Workers AI',
    openai: 'OpenAI API',
};

const PROVIDER_NOTE: Record<SummaryProvider, string> = {
    'workers-ai': 'Runs on your Cloudflare account through the Workers AI binding.',
    openai: 'Works with any OpenAI-compatible API endpoint.',
};

interface SummariesFormProps {
    draft: RuntimeSettings;
    workersAiAvailable: boolean;
    update: <K extends keyof RuntimeSettings>(key: K, value: RuntimeSettings[K]) => void;
}

/** Provider switch, credentials and model for an enabled summary backend. */
function SummariesForm({ draft, workersAiAvailable, update }: SummariesFormProps) {
    const [pickerOpen, setPickerOpen] = useState(false);
    const isWorkersAi = draft.summaryProvider !== 'openai';
    const model = isWorkersAi ? draft.workersAiModel : draft.openaiChatModel;
    const canLoadModels = isWorkersAi
        ? workersAiAvailable
        : Boolean(draft.openaiBaseUrl.trim()) && Boolean(draft.openaiApiKey.trim());

    const setProvider = (next: SummaryProvider) => {
        haptic.selection();
        update('summaryProvider', next);
    };

    const loadModels = () => {
        if (isWorkersAi) {
            return api.listAiModels({ provider: 'workers-ai' }).then(result => result.models);
        }
        // The draft values travel with the request so the list loads even when
        // the debounced settings save has not landed yet.
        return api
            .listAiModels({ provider: 'openai', baseUrl: draft.openaiBaseUrl, apiKey: draft.openaiApiKey })
            .then(result => result.models);
    };

    const modelRow = (
        <ListItem
            link
            title="Model"
            after={
                <span className="max-w-[180px] truncate text-[15px] text-[var(--ios-gray)]">{model || 'Not set'}</span>
            }
            onClick={() => setPickerOpen(true)}
        />
    );

    return (
        <>
            <div className="settings-section-title">AI Provider</div>
            <List strongIos outlineIos className="!mt-0">
                <ListItem>
                    <div className="w-full py-1">
                        <Segmented strong className="ios-segmented">
                            <SegmentedButton active={isWorkersAi} onClick={() => setProvider('workers-ai')}>
                                Workers AI
                            </SegmentedButton>
                            <SegmentedButton active={!isWorkersAi} onClick={() => setProvider('openai')}>
                                OpenAI API
                            </SegmentedButton>
                        </Segmented>
                    </div>
                </ListItem>
            </List>
            <div className="settings-note">{PROVIDER_NOTE[isWorkersAi ? 'workers-ai' : 'openai']}</div>

            {isWorkersAi ? (
                <>
                    <div className="settings-section-title">Model</div>
                    <List strongIos outlineIos className="!mt-0">
                        {modelRow}
                    </List>
                    {!workersAiAvailable ? (
                        <div className="settings-note" style={{ color: '#ff3b30' }}>
                            Workers AI is not available on this worker. Add an AI binding to the worker config, or
                            switch to the OpenAI API provider.
                        </div>
                    ) : null}
                </>
            ) : (
                <>
                    <div className="settings-section-title">Connection</div>
                    <List strongIos outlineIos className="!mt-0">
                        <ListInput
                            label="Base URL"
                            inputMode="url"
                            autoCapitalize="off"
                            autoCorrect="off"
                            spellCheck="false"
                            placeholder="https://api.openai.com/v1"
                            value={draft.openaiBaseUrl}
                            onChange={(e: any) => update('openaiBaseUrl', e.target.value)}
                            clearButton
                        />
                        <ListInput
                            label="API Token"
                            type="password"
                            placeholder="sk-..."
                            value={draft.openaiApiKey}
                            onChange={(e: any) => update('openaiApiKey', e.target.value)}
                            clearButton
                        />
                        {modelRow}
                    </List>
                    <div className="settings-note">
                        The model list loads from your provider through the worker. If the provider does not offer one,
                        type the model id manually.
                    </div>
                </>
            )}

            <ModelPickerSheet
                opened={pickerOpen}
                title={`Model · ${PROVIDER_LABEL[isWorkersAi ? 'workers-ai' : 'openai']}`}
                current={model}
                canLoad={canLoadModels}
                blockedHint={
                    isWorkersAi
                        ? 'Workers AI is not configured on this worker. You can still enter a model manually.'
                        : 'Enter the base URL and API token first.'
                }
                loadModels={loadModels}
                onSelect={value => update(isWorkersAi ? 'workersAiModel' : 'openaiChatModel', value)}
                onClose={() => setPickerOpen(false)}
            />
        </>
    );
}

/** AI summary provider, model and language. */
export function SummariesPage() {
    const { draft, workersAiAvailable, loading, error, reload, update } = useSettingsDraft();

    return (
        <SettingsSubPage title="Summaries" loading={loading || !draft} error={error ?? null} onRetry={reload}>
            {draft ? (
                <>
                    <List strongIos outlineIos className="!mt-3">
                        <ToggleRow
                            title="Enable Summaries"
                            checked={draft.summaryEnabled}
                            onChange={value => update('summaryEnabled', value)}
                        />
                    </List>
                    {draft.summaryEnabled ? (
                        <SummariesForm draft={draft} workersAiAvailable={workersAiAvailable} update={update} />
                    ) : null}
                    <div className="settings-section-title">Output</div>
                    <List strongIos outlineIos className="!mt-0">
                        <ListInput
                            label="Summary Language"
                            type="select"
                            dropdown
                            value={draft.summaryTargetLang}
                            onChange={(e: any) => update('summaryTargetLang', e.target.value)}
                        >
                            {SUMMARY_LANGS.map(lang => (
                                <option key={lang.value} value={lang.value}>
                                    {lang.label}
                                </option>
                            ))}
                        </ListInput>
                    </List>
                    <div className="settings-note">
                        Summaries appear in the Telegram push and in the message reader. Changes save automatically.
                    </div>
                </>
            ) : null}
        </SettingsSubPage>
    );
}
