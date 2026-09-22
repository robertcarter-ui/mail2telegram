import type { RuntimeSettings, SettingsResponse } from '@mail2telegram/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { haptic } from '../../lib/haptics';

export interface SettingsDraft {
    draft: RuntimeSettings | undefined;
    /** True when the worker has the Workers AI binding, so the provider is usable. */
    workersAiAvailable: boolean;
    loading: boolean;
    error: Error | undefined;
    reload: () => void;
    update: <K extends keyof RuntimeSettings>(key: K, value: RuntimeSettings[K]) => void;
    saving: boolean;
    savedAt: number | null;
    saveError: string | null;
}

/**
 * Loads runtime settings and persists changes automatically.
 *
 * Settings rows live on separate pages, so saving immediately (debounced) avoids
 * losing an edit when navigating away and keeps every page self-contained.
 */
export function useSettingsDraft(): SettingsDraft {
    const { data, loading, error, reload, setData } = useAsync<SettingsResponse>(() => api.getSettings(), []);
    const [draft, setDraft] = useState<RuntimeSettings | undefined>(undefined);
    const [saving, setSaving] = useState(false);
    const [savedAt, setSavedAt] = useState<number | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);

    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pending = useRef<Partial<RuntimeSettings>>({});
    const mounted = useRef(true);

    useEffect(() => {
        if (data?.settings) {
            setDraft({ ...data.settings });
        }
    }, [data]);

    const flush = useCallback(async () => {
        const patch = pending.current;
        pending.current = {};
        if (Object.keys(patch).length === 0) {
            return;
        }
        setSaving(true);
        setSaveError(null);
        try {
            const result = await api.updateSettings(patch);
            if (mounted.current) {
                setData(result);
                setDraft({ ...result.settings });
                setSavedAt(Date.now());
            }
        } catch (e) {
            if (mounted.current) {
                setSaveError((e as Error).message);
                haptic.notification('error');
            }
        } finally {
            if (mounted.current) {
                setSaving(false);
            }
        }
    }, [setData]);

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            if (timer.current) {
                clearTimeout(timer.current);
            }
            // Navigating away within the debounce window must still deliver
            // the pending edit; `flush` skips local state updates through the
            // `mounted` guard but the request itself goes out.
            void flush();
        };
    }, [flush]);

    const update = useCallback(
        <K extends keyof RuntimeSettings>(key: K, value: RuntimeSettings[K]) => {
            setDraft(current => (current ? { ...current, [key]: value } : current));
            pending.current = { ...pending.current, [key]: value };
            if (timer.current) {
                clearTimeout(timer.current);
            }
            timer.current = setTimeout(() => {
                void flush();
            }, 600);
        },
        [flush],
    );

    return {
        draft,
        workersAiAvailable: data?.workersAiAvailable ?? false,
        loading,
        error,
        reload,
        update,
        saving,
        savedAt,
        saveError,
    };
}
