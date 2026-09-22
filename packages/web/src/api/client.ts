import type {
    Address,
    AddressTestResponse,
    AddressType,
    SenderRuleAction,
    SenderRuleResponse,
    AiModelsRequest,
    AiModelsResponse,
    AuthLoginResponse,
    AuthResponse,
    CleanupPreviewResponse,
    CleanupResponse,
    Email,
    EmailDetailResponse,
    EmailListResponse,
    ImportEnvResponse,
    MeResponse,
    RuntimeSettings,
    SendEmailRequest,
    SendEmailResponse,
    SettingsResponse,
} from '@mail2telegram/shared';
import { retrieveRawInitData } from '@tma.js/sdk-react';

export class ApiError extends Error {
    readonly status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

/**
 * Where the browser session token is kept between visits. Only the token is
 * stored — never the password itself — and rotating `WEB_PASSWORD` on the
 * worker invalidates it.
 */
const TOKEN_STORAGE_KEY = 'mail2telegram.web-token';

function getStoredToken(): string {
    return localStorage.getItem(TOKEN_STORAGE_KEY) || '';
}

function storeToken(token: string): void {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

function rawInitData(): string {
    try {
        return retrieveRawInitData() || '';
    } catch {
        // Outside Telegram there is no launch data at all.
        return '';
    }
}

/**
 * `tma <initData>` inside Telegram, `web <token>` for a browser session,
 * or nothing when the visitor has not signed in yet.
 */
function authHeader(): string {
    const raw = rawInitData();
    if (raw) {
        return `tma ${raw}`;
    }
    const token = getStoredToken();
    return token ? `web ${token}` : '';
}

async function request<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
    const headers = new Headers(init.headers);
    if (auth) {
        // Only authenticated routes need the header; it is absent until the
        // visitor is inside Telegram or has signed in with the web password.
        const header = authHeader();
        if (header) {
            headers.set('Authorization', header);
        }
    }
    if (init.body) {
        headers.set('Content-Type', 'application/json');
    }
    const response = await fetch(path, { ...init, headers });
    if (!response.ok) {
        let message = response.statusText;
        try {
            const body = (await response.json()) as { error?: string };
            message = body.error || message;
        } catch {
            // ignore non-json error bodies
        }
        throw new ApiError(response.status, message);
    }
    if (response.status === 204) {
        return undefined as T;
    }
    return (await response.json()) as T;
}

export interface EmailQuery {
    q?: string;
    starred?: boolean;
    unread?: boolean;
    limit?: number;
    offset?: number;
}

export const api = {
    /** Public: whether the worker accepts the web password login. */
    authOptions(): Promise<AuthResponse> {
        return request<AuthResponse>('/api/auth', {}, false);
    },

    /**
     * Exchanges the web password for a browser session: the password travels in
     * the JSON body (no header encoding limits) and only the issued token is
     * kept in localStorage for the following requests.
     */
    async loginWithPassword(password: string): Promise<AuthLoginResponse> {
        const result = await request<AuthLoginResponse>(
            '/api/auth/login',
            {
                method: 'POST',
                body: JSON.stringify({ password }),
            },
            false,
        );
        storeToken(result.token);
        return result;
    },

    me(): Promise<MeResponse> {
        return request<MeResponse>('/api/me');
    },

    listEmails(query: EmailQuery = {}): Promise<EmailListResponse> {
        const params = new URLSearchParams();
        if (query.q) params.set('q', query.q);
        if (query.starred !== undefined) params.set('starred', `${query.starred}`);
        if (query.unread !== undefined) params.set('unread', `${query.unread}`);
        if (query.limit !== undefined) params.set('limit', `${query.limit}`);
        if (query.offset !== undefined) params.set('offset', `${query.offset}`);
        const suffix = params.toString();
        return request<EmailListResponse>(`/api/emails${suffix ? `?${suffix}` : ''}`);
    },

    getEmail(id: string): Promise<EmailDetailResponse> {
        return request<EmailDetailResponse>(`/api/emails/${id}`);
    },

    updateEmail(id: string, patch: { isRead?: boolean; isStarred?: boolean }): Promise<{ email: Email }> {
        return request<{ email: Email }>(`/api/emails/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(patch),
        });
    },

    /** Applies a block/trust rule to the sender of a mail. */
    setSenderRule(id: string, action: SenderRuleAction): Promise<SenderRuleResponse> {
        return request<SenderRuleResponse>(`/api/emails/${id}/address-rule`, {
            method: 'POST',
            body: JSON.stringify({ action }),
        });
    },

    deleteEmail(id: string): Promise<{ success: boolean }> {
        return request<{ success: boolean }>(`/api/emails/${id}`, { method: 'DELETE' });
    },

    previewCleanup(params: { days?: number; all?: boolean }): Promise<CleanupPreviewResponse> {
        const query = new URLSearchParams();
        if (params.all) {
            query.set('all', 'true');
        } else {
            query.set('days', `${params.days}`);
        }
        return request<CleanupPreviewResponse>(`/api/emails/cleanup/preview?${query.toString()}`);
    },

    cleanupEmails(params: { days?: number; all?: boolean; attachmentsOnly?: boolean }): Promise<CleanupResponse> {
        return request<CleanupResponse>('/api/emails/cleanup', {
            method: 'POST',
            body: JSON.stringify(params),
        });
    },

    summarize(id: string): Promise<{ summary: string }> {
        return request<{ summary: string }>(`/api/emails/${id}/summary`, { method: 'POST' });
    },

    reply(id: string, text: string): Promise<{ success: boolean }> {
        return request<{ success: boolean }>(`/api/emails/${id}/reply`, {
            method: 'POST',
            body: JSON.stringify({ text }),
        });
    },

    /** Sends a new mail through the worker's Resend integration. */
    sendEmail(body: SendEmailRequest): Promise<SendEmailResponse> {
        return request<SendEmailResponse>('/api/emails/send', {
            method: 'POST',
            body: JSON.stringify(body),
        });
    },

    listAddresses(type?: AddressType): Promise<{ addresses: Address[] }> {
        const suffix = type ? `?type=${type}` : '';
        return request<{ addresses: Address[] }>(`/api/addresses${suffix}`);
    },

    addAddress(address: string, type: AddressType, note?: string): Promise<{ address: Address }> {
        return request<{ address: Address }>('/api/addresses', {
            method: 'POST',
            body: JSON.stringify({ address, type, note }),
        });
    },

    removeAddress(id: string): Promise<{ success: boolean }> {
        return request<{ success: boolean }>(`/api/addresses/${id}`, { method: 'DELETE' });
    },

    testAddress(address: string): Promise<AddressTestResponse> {
        return request<AddressTestResponse>('/api/addresses/test', {
            method: 'POST',
            body: JSON.stringify({ address }),
        });
    },

    /** Re-registers the Telegram webhook, commands and menu button (worker `/init`). */
    rebindWebhook(): Promise<{
        webhook?: { ok?: boolean; description?: string };
        commands?: { ok?: boolean };
        menuButton?: { ok?: boolean };
    }> {
        // `/init` works unauthenticated from the landing page, where no initData
        // exists. Credentials are still attached when the visitor has them: the
        // worker only lets an authenticated owner move the remembered host.
        return request('/init', {});
    },

    getSettings(): Promise<SettingsResponse> {
        return request<SettingsResponse>('/api/settings');
    },

    updateSettings(patch: Partial<RuntimeSettings>): Promise<SettingsResponse> {
        return request<SettingsResponse>('/api/settings', {
            method: 'PUT',
            body: JSON.stringify(patch),
        });
    },

    /** Model ids offered by the provider, fetched through the worker. */
    listAiModels(body: AiModelsRequest): Promise<AiModelsResponse> {
        return request<AiModelsResponse>('/api/settings/ai/models', {
            method: 'POST',
            body: JSON.stringify(body),
        });
    },

    /** Copies env-derived settings and address lists into stored settings. */
    importEnvSettings(): Promise<ImportEnvResponse> {
        return request<ImportEnvResponse>('/api/settings/import', { method: 'POST' });
    },

    attachmentUrl(emailId: string, attachmentId: string): string {
        return `/api/emails/${emailId}/attachments/${attachmentId}`;
    },
};

export async function fetchAttachmentBlob(emailId: string, attachmentId: string): Promise<Blob> {
    const headers = new Headers();
    const header = authHeader();
    if (header) {
        headers.set('Authorization', header);
    }
    const response = await fetch(api.attachmentUrl(emailId, attachmentId), { headers });
    if (!response.ok) {
        throw new ApiError(response.status, response.statusText);
    }
    return await response.blob();
}
