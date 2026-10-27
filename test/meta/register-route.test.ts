import { describe, expect, it } from 'vitest';
import { registerMetaRoute, SDK_PACKAGE, SDK_VERSION } from '../../src/meta/index.js';

describe('registerMetaRoute', () => {
    it('registers bearer middleware and GET handler', async () => {
        const uses: string[] = [];
        const gets: string[] = [];
        let handler:
            | ((c: { env: object; json: (body: unknown) => Response }) => Response)
            | undefined;
        const app = {
            use(path: string) {
                uses.push(path);
            },
            get(
                path: string,
                h: (c: { env: object; json: (body: unknown) => Response }) => Response,
            ) {
                gets.push(path);
                handler = h;
            },
        };
        registerMetaRoute(app, { workerName: 'notify-worker', sdkVersion: '9.9.9' });
        expect(uses).toEqual(['/v1/meta']);
        expect(gets).toEqual(['/v1/meta']);
        const resp = handler?.({
            env: { BUILD_COMMIT_SHA: 'abc', RULES_ADMIN_TOKEN: 'secret' },
            json: (body) => new Response(JSON.stringify(body), { status: 200 }),
        });
        expect(resp?.status).toBe(200);
        const body = (await resp?.json()) as {
            worker: string;
            sdk: { package: string; version: string };
            build: { commit: string | null };
        };
        expect(body.worker).toBe('notify-worker');
        expect(body.sdk).toEqual({ package: SDK_PACKAGE, version: '9.9.9' });
        expect(body.build.commit).toBe('abc');
        expect(SDK_VERSION).toBe('0.0.0-test');
    });

    it('defaults auth env key', () => {
        const uses: string[] = [];
        registerMetaRoute(
            {
                use(path: string) {
                    uses.push(path);
                },
                get() {
                    return undefined;
                },
            },
            { workerName: 'w' },
        );
        expect(uses).toEqual(['/v1/meta']);
    });
});
