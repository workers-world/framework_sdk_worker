import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGithubAppAuth, createGithubAppJwt } from '../../src/github/app-auth.js';

// 测试用 RSA 私钥（PKCS#8）：node:crypto 现场生成，仅用于单测签名验证，非生产凭证；
// 不在仓内落 PEM 字面量（避免 gitleaks 等密钥扫描误报）
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_KEY_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

describe('createGithubAppJwt', () => {
    it('builds a three-segment RS256 JWT with iss = appId', async () => {
        const jwt = await createGithubAppJwt({ appId: '12345', privateKeyPem: PRIVATE_KEY_PEM });
        const [h, p, sig] = jwt.split('.');
        expect(h).toBeTruthy();
        expect(p).toBeTruthy();
        expect(sig).toBeTruthy();

        const header = JSON.parse(atob(h.replace(/-/g, '+').replace(/_/g, '/')));
        expect(header.alg).toBe('RS256');
        expect(header.typ).toBe('JWT');

        const payload = JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/')));
        expect(payload.iss).toBe('12345');
        expect(payload.exp - payload.iat).toBe(9 * 60 + 60);
    });

    it('throws on missing config', async () => {
        await expect(createGithubAppJwt({ appId: '', privateKeyPem: '' })).rejects.toThrow(
            /GitHub App 未配置/,
        );
    });
});

describe('createGithubAppAuth', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('fetches installation token and caches it', async () => {
        const fetchMock = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        token: 'ghs_test',
                        expires_at: new Date(Date.now() + 3600_000).toISOString(),
                    }),
                    {
                        status: 201,
                    },
                ),
        ) as unknown as typeof fetch;
        const auth = createGithubAppAuth(
            { appId: '12345', privateKeyPem: PRIVATE_KEY_PEM },
            fetchMock,
        );

        const t1 = await auth.getInstallationToken(43);
        const t2 = await auth.getInstallationToken(43);

        expect(t1).toBe('ghs_test');
        expect(t2).toBe('ghs_test');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        const headers = init.headers as Record<string, string>;
        expect(headers['User-Agent']).toBe('framework-sdk-worker');
        expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28');
    });

    it('invalidates cache on demand', async () => {
        const fetchMock = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        token: 'ghs_test',
                        expires_at: new Date(Date.now() + 3600_000).toISOString(),
                    }),
                    {
                        status: 201,
                    },
                ),
        ) as unknown as typeof fetch;
        const auth = createGithubAppAuth(
            { appId: '12345', privateKeyPem: PRIVATE_KEY_PEM },
            fetchMock,
        );

        await auth.getInstallationToken(44);
        auth.invalidate(44);
        await auth.getInstallationToken(44);

        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('throws readable error on non-ok response', async () => {
        const fetchMock = vi.fn(
            async () => new Response('nope', { status: 401 }),
        ) as unknown as typeof fetch;
        const auth = createGithubAppAuth(
            { appId: '12345', privateKeyPem: PRIVATE_KEY_PEM },
            fetchMock,
        );
        await expect(auth.getInstallationToken(42)).rejects.toThrow(/HTTP 401/);
    });
});
