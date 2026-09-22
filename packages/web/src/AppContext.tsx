import type { ReactNode } from 'react';
import type { MeResponse } from '@mail2telegram/shared';
import { createContext, useContext } from 'react';

export interface AppContextValue {
    me: MeResponse;
    refreshMe: () => void;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

export function AppProvider({ value, children }: { value: AppContextValue; children: ReactNode }) {
    return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
    const value = useContext(AppContext);
    if (!value) {
        throw new Error('useApp must be used inside AppProvider');
    }
    return value;
}
