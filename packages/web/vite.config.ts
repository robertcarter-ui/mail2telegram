import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const WORKER_ORIGIN = 'http://127.0.0.1:8787';

// The `server.proxy` string keys are prefix matches, so `/api` would also swallow
// the app's own module `/api/client.ts` and `/init` would swallow `/init.ts`.
// Serve anything that looks like a source/asset file from Vite and only proxy the
// real, extension-less worker routes.
function bypassSourceFiles(req: { url?: string }): string | undefined {
    const url = req.url || '';
    if (/\.(?:ts|tsx|js|jsx|mjs|css|json|map|html|svg|png|jpg|jpeg|gif|webp|ico|woff2?)(?:\?|$)/.test(url)) {
        return url;
    }
    return undefined;
}

const proxyTargets = ['/api', '/init', '/email', '/telegram'];
const proxy = Object.fromEntries(
    proxyTargets.map(path => [
        path,
        {
            target: WORKER_ORIGIN,
            changeOrigin: true,
            bypass: bypassSourceFiles,
        },
    ]),
);

export default defineConfig({
    root: fileURLToPath(new URL('.', import.meta.url)),
    base: '/',
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
    server: {
        port: 5173,
        host: true,
        proxy,
    },
    build: {
        outDir: fileURLToPath(new URL('./dist/client', import.meta.url)),
        emptyOutDir: true,
        target: 'esnext',
        sourcemap: false,
    },
});
