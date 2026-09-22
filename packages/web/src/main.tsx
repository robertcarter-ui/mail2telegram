import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initApp } from './init';
import { setupMockEnv } from './mockEnv';
import './styles/index.css';

const params = new URLSearchParams(window.location.search);
// `?debug` also enables the mock so a production build can be previewed locally.
const debug = import.meta.env.DEV || params.has('debug');

async function bootstrap(): Promise<void> {
    // Install the mock before touching the SDK, since launch params are resolved
    // lazily and a missing environment would otherwise throw during init.
    if (debug) {
        try {
            await setupMockEnv();
        } catch (e) {
            console.error('[app] mock environment failed', e);
        }
    }

    try {
        initApp({ debug });
    } catch (e) {
        console.error('[app] init failed', e);
    }

    createRoot(document.getElementById('root')!).render(
        <StrictMode>
            <App />
        </StrictMode>,
    );
}

bootstrap().catch(e => {
    console.error('[app] bootstrap failed', e);
});
