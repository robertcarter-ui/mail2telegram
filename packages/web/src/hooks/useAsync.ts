import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
    data: T | undefined;
    loading: boolean;
    error: Error | undefined;
    reload: () => void;
    setData: (updater: T | ((previous: T | undefined) => T | undefined)) => void;
}

/** Small data-fetching hook with manual reload and safe unmount handling. */
export function useAsync<T>(factory: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
    const [data, setData] = useState<T | undefined>(undefined);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | undefined>(undefined);
    const [nonce, setNonce] = useState(0);
    const mounted = useRef(true);
    const factoryRef = useRef(factory);
    factoryRef.current = factory;

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(undefined);
        factoryRef
            .current()
            .then(result => {
                if (!cancelled && mounted.current) {
                    setData(result);
                }
            })
            .catch((e: unknown) => {
                if (!cancelled && mounted.current) {
                    setError(e instanceof Error ? e : new Error(String(e)));
                }
            })
            .finally(() => {
                if (!cancelled && mounted.current) {
                    setLoading(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [...deps, nonce]);

    const reload = useCallback(() => setNonce(value => value + 1), []);
    const update = useCallback((updater: T | ((previous: T | undefined) => T | undefined)) => {
        setData(previous =>
            typeof updater === 'function' ? (updater as (p: T | undefined) => T | undefined)(previous) : updater,
        );
    }, []);

    return { data, loading, error, reload, setData: update };
}
