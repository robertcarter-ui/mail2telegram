import type { KeyboardEvent } from 'react';
import { Preloader, Sheet } from 'konsta/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckIcon, RefreshIcon } from '../../components/ios/Icons';
import { haptic } from '../../lib/haptics';

export interface ModelPickerSheetProps {
    opened: boolean;
    title?: string;
    /** Model id currently stored in the draft, shown with a checkmark. */
    current: string;
    /** Fetches the provider's model ids through the worker. */
    loadModels: () => Promise<string[]>;
    /** False while the provider is not usable yet; `blockedHint` explains why. */
    canLoad: boolean;
    blockedHint?: string;
    onSelect: (model: string) => void;
    onClose: () => void;
}

/**
 * Bottom sheet for picking an AI model: a freshly loaded list with a search
 * filter, plus a manual entry row for providers without a /models endpoint or
 * models that have not been released to the list yet.
 */
export function ModelPickerSheet({
    opened,
    title = 'Model',
    current,
    loadModels,
    canLoad,
    blockedHint,
    onSelect,
    onClose,
}: ModelPickerSheetProps) {
    const [models, setModels] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [query, setQuery] = useState('');
    const [custom, setCustom] = useState('');
    const requestId = useRef(0);
    const loadRef = useRef(loadModels);
    loadRef.current = loadModels;

    const load = useCallback(async () => {
        const id = (requestId.current += 1);
        setLoading(true);
        setError(null);
        try {
            const result = await loadRef.current();
            // A stale response (user tapped refresh twice, sheet reopened) must
            // not overwrite the newer one.
            if (id === requestId.current) {
                setModels(result);
            }
        } catch (e) {
            if (id === requestId.current) {
                setError((e as Error).message);
                haptic.notification('error');
            }
        } finally {
            if (id === requestId.current) {
                setLoading(false);
            }
        }
    }, []);

    useEffect(() => {
        if (opened) {
            setQuery('');
            setCustom(current);
            setModels([]);
            setError(null);
            if (canLoad) {
                void load();
            }
        }
    }, [opened, canLoad, current, load]);

    const close = () => {
        onClose();
    };

    const pick = (model: string) => {
        haptic.selection();
        if (model !== current) {
            onSelect(model);
        }
        onClose();
    };

    const useCustom = () => {
        const model = custom.trim();
        if (model) {
            pick(model);
        }
    };

    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            close();
        }
    };

    const needle = query.trim().toLowerCase();
    const filtered = needle ? models.filter(model => model.toLowerCase().includes(needle)) : models;

    return (
        <Sheet opened={opened} onBackdropClick={close} className="pb-safe">
            <div className="px-4 pt-2" onKeyDown={onKeyDown}>
                <div className="mb-2 flex items-center justify-between">
                    <button type="button" className="bar-button text-button !my-0 !px-0" onClick={close}>
                        Cancel
                    </button>
                    <span className="text-[17px] font-semibold">{title}</span>
                    <button
                        type="button"
                        aria-label="Reload models"
                        className="bar-button text-button !my-0 !px-0 p-1"
                        onClick={() => void load()}
                        disabled={loading || !canLoad}
                    >
                        {loading ? <Preloader className="!h-[18px] !w-[18px]" /> : <RefreshIcon size={18} />}
                    </button>
                </div>
                <input
                    type="search"
                    aria-label="Search models"
                    placeholder="Search models"
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    className="w-full rounded-xl bg-black/5 px-3 py-2 text-[16px] outline-none dark:bg-white/10"
                />
                <div aria-busy={loading} className="mt-2 max-h-[38vh] overflow-y-auto overscroll-contain">
                    {loading ? (
                        <div className="spin-center">
                            <Preloader />
                        </div>
                    ) : error ? (
                        <div className="py-3 text-center">
                            <div role="alert" className="text-[13px] text-[#ff3b30]">
                                {error}
                            </div>
                            {canLoad ? (
                                <button type="button" className="text-button mt-1" onClick={() => void load()}>
                                    Try Again
                                </button>
                            ) : null}
                        </div>
                    ) : !canLoad ? (
                        <div className="py-3 text-center text-[13px] text-[var(--ios-gray)]">{blockedHint}</div>
                    ) : filtered.length === 0 ? (
                        <div className="py-3 text-center text-[13px] text-[var(--ios-gray)]">
                            {models.length === 0
                                ? 'No models returned by the provider.'
                                : 'No models match your search.'}
                        </div>
                    ) : (
                        <div role="listbox" aria-label="Available models" className="pb-1">
                            {filtered.map(model => {
                                const selected = model === current;
                                return (
                                    <button
                                        key={model}
                                        type="button"
                                        role="option"
                                        aria-selected={selected}
                                        onClick={() => pick(model)}
                                        className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg px-3 text-left active:bg-black/5 dark:active:bg-white/10"
                                    >
                                        <span className="truncate text-[16px]">{model}</span>
                                        {selected ? <CheckIcon size={18} className="shrink-0 text-[#007aff]" /> : null}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
                <div className="mt-1 border-t border-black/10 pb-3 pt-2 dark:border-white/10">
                    <label htmlFor="model-picker-custom" className="mb-1 block text-[13px] text-[var(--ios-gray)]">
                        Or enter a model manually
                    </label>
                    <div className="flex items-center gap-2">
                        <input
                            id="model-picker-custom"
                            value={custom}
                            onChange={event => setCustom(event.target.value)}
                            placeholder="model-id"
                            spellCheck={false}
                            autoCapitalize="off"
                            className="min-w-0 flex-1 rounded-xl bg-black/5 px-3 py-2 text-[16px] outline-none dark:bg-white/10"
                        />
                        <button
                            type="button"
                            className="text-button shrink-0 font-semibold"
                            onClick={useCustom}
                            disabled={!custom.trim()}
                        >
                            Use
                        </button>
                    </div>
                </div>
            </div>
        </Sheet>
    );
}
