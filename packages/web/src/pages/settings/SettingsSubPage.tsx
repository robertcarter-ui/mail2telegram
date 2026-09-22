import type { ReactNode } from 'react';
import { Preloader } from 'konsta/react';
import { useNavigate } from 'react-router-dom';
import { NavBar } from '../../components/ios/NavBar';

export interface SettingsSubPageProps {
    title: string;
    loading?: boolean;
    error?: Error | null;
    onRetry?: () => void;
    children: ReactNode;
}

/** Shared frame for a settings section: navbar with back, scrolling body. */
export function SettingsSubPage({ title, loading, error, onRetry, children }: SettingsSubPageProps) {
    const navigate = useNavigate();
    const goBack = () => navigate('/settings');

    if (loading) {
        return (
            <div className="split-column">
                <NavBar title={title} onBack={goBack} />
                <div className="spin-center">
                    <Preloader />
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="split-column">
                <NavBar title={title} onBack={goBack} />
                <div className="reader-empty">
                    <div>
                        <p className="mb-3">{error.message}</p>
                        {onRetry ? (
                            <button type="button" className="text-button" onClick={onRetry}>
                                Try Again
                            </button>
                        ) : null}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="split-column">
            <NavBar title={title} onBack={goBack} />
            <div className="page-scroll">
                {children}
                <div style={{ height: 24 }} />
            </div>
        </div>
    );
}
