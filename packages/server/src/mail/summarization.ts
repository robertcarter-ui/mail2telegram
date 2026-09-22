import type { Ai } from '@cloudflare/workers-types';
import type { EmailRecord, Environment, RuntimeSettings } from '../types';

interface WorkersAiResponse {
    response?: string;
}

interface OpenAiModel {
    id?: string;
}

/**
 * OpenAI-compatible APIs are addressed by their base (`https://host/v1`); the
 * chat and model-list endpoints hang off it. Stored values may still hold a
 * legacy full completions URL, so the suffix is stripped.
 */
export function openaiBaseUrl(endpoint: string): string {
    const base = endpoint.trim().replace(/\/+$/, '');
    return base.replace(/\/chat\/completions$/, '');
}

export function chatCompletionsUrl(baseUrl: string): string {
    return `${openaiBaseUrl(baseUrl)}/chat/completions`;
}

export async function summarizedByWorkerAI(ai: Ai, model: string, prompt: string): Promise<string> {
    const result = (await ai.run(model as any, {
        messages: [
            {
                role: 'system',
                content: 'You are a professional email summarization assistant.',
            },
            {
                role: 'user',
                content: prompt,
            },
        ],
    })) as WorkersAiResponse | string;

    if (typeof result === 'string') {
        return result;
    }

    return result?.response ?? '';
}

export async function summarizedByOpenAI(key: string, baseUrl: string, model: string, prompt: string): Promise<string> {
    if (!key || !baseUrl || !model) {
        return 'Sorry, the OpenAI API is not configured properly.';
    }
    const resp = await fetch(chatCompletionsUrl(baseUrl), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
            model,
            messages: [
                {
                    role: 'system',
                    content: 'You are a professional email summarization assistant.',
                },
                {
                    role: 'user',
                    content: prompt,
                },
            ],
        }),
    });
    if (!resp.ok) {
        throw new Error(`OpenAI API request failed: ${resp.status}`);
    }
    const body = (await resp.json()) as any;
    return body?.choices?.[0]?.message?.content || '';
}

export function summaryEnabled(env: Environment, settings: RuntimeSettings): boolean {
    if (!settings.summaryEnabled) {
        return false;
    }
    if (settings.summaryProvider === 'openai') {
        return Boolean(settings.openaiApiKey) && Boolean(openaiBaseUrl(settings.openaiBaseUrl));
    }
    return Boolean(env.AI) && Boolean(settings.workersAiModel);
}

/** Summarize an email body using the configured provider. */
export async function summarizeEmail(mail: EmailRecord, env: Environment, settings: RuntimeSettings): Promise<string> {
    const body = (mail.body_text || '').substring(0, 12000);
    const prompt = `Summarize the following text in approximately 50 words with ${settings.summaryTargetLang}\n\n${body}`;
    if (settings.summaryProvider !== 'openai') {
        if (!env.AI || !settings.workersAiModel) {
            throw new Error('No summarization provider is configured.');
        }
        return await summarizedByWorkerAI(env.AI, settings.workersAiModel, prompt);
    }
    if (!settings.openaiApiKey || !settings.openaiBaseUrl) {
        throw new Error('No summarization provider is configured.');
    }
    return await summarizedByOpenAI(settings.openaiApiKey, settings.openaiBaseUrl, settings.openaiChatModel, prompt);
}

function collectTextModels(models: Awaited<ReturnType<Ai['models']>>): string[] {
    // `name` (`@cf/...`) is the identifier `ai.run()` accepts; `id` is an
    // internal UUID that is useless in settings.
    return models.filter(model => model.task?.name === 'Text Generation').map(model => model.name);
}

/** Text-generation model names offered by the account's Workers AI binding. */
export async function listWorkersAiTextModels(ai: Ai): Promise<string[]> {
    // Some account/task catalogs ignore the filter; fall back to scanning.
    let params: { task?: string; per_page: number; page?: number } = { task: 'Text Generation', per_page: 100 };
    let models = await ai.models(params);
    let names = collectTextModels(models);
    if (names.length === 0) {
        params = { per_page: 100 };
        models = await ai.models(params);
        names = collectTextModels(models);
    }
    // A full page means the catalog may continue; one extra page covers the
    // current catalog size and keeps latency bounded.
    if (names.length > 0 && models.length === 100) {
        const more = await ai.models({ ...params, page: 2 });
        names = names.concat(collectTextModels(more));
    }
    return [...new Set(names)].toSorted((a, b) => a.localeCompare(b));
}

/** Model ids from an OpenAI-compatible `/models` endpoint. */
export async function listOpenAiCompatibleModels(baseUrl: string, apiKey: string): Promise<string[]> {
    const base = openaiBaseUrl(baseUrl);
    if (!base || !apiKey) {
        throw new Error('Base URL and API token are required');
    }
    const resp = await fetch(`${base}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!resp.ok) {
        throw new Error(`Model list request failed: ${resp.status}`);
    }
    const body = (await resp.json()) as { data?: OpenAiModel[] } | OpenAiModel[];
    const list = Array.isArray(body) ? body : (body.data ?? []);
    const ids = list.map(model => model?.id).filter((id): id is string => Boolean(id));
    return [...new Set(ids)].toSorted((a, b) => a.localeCompare(b));
}
