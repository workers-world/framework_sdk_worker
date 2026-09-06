import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGithubAppAuth, createGithubAppJwt } from '../../src/github/app-auth.js';

// 测试用 RSA 私钥（PKCS#8，node:crypto 现场生成，仅用于单测签名验证，非生产凭证）
const PRIVATE_KEY_PEM = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCzDylcvUtKtsQr\n7+rpQuBIjG7s1cwdckqIF9JS/LuAb3aC7cEvGOjKklYyxctQj0ikEENE2i/3TEUr\ngVJJ5J/q1T3sO1zi/2U8Y5o1hm+uXNaLBcUVFzN0TY4LcUdg48AUeulpVGnoYP3h\nLtCrbEu1PzlwZ7OVALww9Oeg95LoUX9HyFnVJWuwtmif0HIwZus9+aWaWzh6rNds\nGji5K2C2YVmVTtxLweLkxmwvXeTBTvKfFeRKVPNnmWS91f3vmXebJpumBpRkkexW\nOaxGCuaU0BtrU038/6GoFaPHLJz0LqGmHAxtNGn4BPEyCy0JKlwdsbKfh+6H9oOC\nDu37C/cRAgMBAAECggEABEr+g5/xNG0d1mzV3bpR/MNLLIfysRkKoukpTH6NM0bY\n2UpAebPX7vVjtitqVLfetrpCFp5BjKUKOoEK+0UNNXjf13BT6YhUgcZkjdh3iH9m\n0GX2w+ruu6DZYTpZyv+i3QrWWkVhFaZvp8yyyY1a4lFN+/0sf8vI90aD4CbXYZT6\nUUOkP4x48OErGSGLsORRSw9hHQqz3wEFzlF/aMXnnJNfjgekMaGeWrtm+6QEyCO7\nsbxqVZei4qmNueC4aSe25a/tAJ4jsr1cnJEVN7fhNB/B3CbXnKlcKZfhE7/s5w4R\nnIZHckzwWha+9DvR/RmoX0S2cKMZJVm8rmUbLcfRLQKBgQDpp/HcyZxHW4EOWxzx\nLOWx8wUSNqG9NgJhisAphJtWVDGifzYOpQqZGc2M67nXCekjGWtVN0ZqcDez9OM8\nicr1TN0gnJDeHnzG54YGXg+NPJ2fOa4xg7xR3NRt2iCvQ/cP7rTr961VIS/zrXQm\nz/YCuHUHsxYUExT2iI+dEnyUZQKBgQDELqaLg72GW6BRdlR29oz3FSlBKijbUjTG\nt+DDcMtySzdPj8WXoxSl6XqwvcuoWYIbC0os/aL3ODyaG8PTdlLMNaHg8OqFNiWL\nb8+AyoRNaNJ7jppbE/eeqJXIdVXKlKVvz/D34IyOLM0U0eUnEPpu1R0bcxkiRnc8\nOPOX9pz/PQKBgQCRJvT4rQJ5zd2RloaXSMX00zzeQLQfgBLgl7qi0C9T5P/kq9Rg\nKqU30TDBj5smfJCpblwgVzNWYhoooEQeUpeT5cklPj48zoHDawb2o65TlklxJfsR\n5X2y+VW6XJybZMRx0F/yiy3RyckpPyL+DYkNzZteSiG4HNaUBOf6swZThQKBgC90\njWrgIj9W+K/b7NCeETlPkBwoQ5vSBdwv7Jm6Nixej3GaeJSWqU787GXGc3Y0uKks\nEPRTIlGk89vfbX5AeATX0GGmRUSV9X0GPe6MjnZfLdMfiq0PZm2loB3ObENFs8MZ\nTNPZKIbXxYAMyd6qV7npqVHThLfqzbrul9YhnJaNAoGAOrGgIFqhs/aPBJbpqZZU\noG1k4em/hj6COGT4Q7nMFuGlSffdtDNnIBQIG2+QszPikUDuTDPVOrwAKPIRtQza\n02IMWkqQ0pb1DRM+W3UEG3f5H2HT1WJwHW/uiEmLGyIREdToME4xAHHCbsS52Mky\nozN1rLZUArzNPvFNqkzuP7s=\n-----END PRIVATE KEY-----\n';

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
        const fetchMock = vi.fn(async () =>
            new Response(JSON.stringify({ token: 'ghs_test', expires_at: new Date(Date.now() + 3600_000).toISOString() }), {
                status: 201,
            }),
        ) as unknown as typeof fetch;
        const auth = createGithubAppAuth({ appId: '12345', privateKeyPem: PRIVATE_KEY_PEM }, fetchMock);

        const t1 = await auth.getInstallationToken(43);
        const t2 = await auth.getInstallationToken(43);

        expect(t1).toBe('ghs_test');
        expect(t2).toBe('ghs_test');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('invalidates cache on demand', async () => {
        const fetchMock = vi.fn(async () =>
            new Response(JSON.stringify({ token: 'ghs_test', expires_at: new Date(Date.now() + 3600_000).toISOString() }), {
                status: 201,
            }),
        ) as unknown as typeof fetch;
        const auth = createGithubAppAuth({ appId: '12345', privateKeyPem: PRIVATE_KEY_PEM }, fetchMock);

        await auth.getInstallationToken(44);
        auth.invalidate(44);
        await auth.getInstallationToken(44);

        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('throws readable error on non-ok response', async () => {
        const fetchMock = vi.fn(async () => new Response('nope', { status: 401 })) as unknown as typeof fetch;
        const auth = createGithubAppAuth({ appId: '12345', privateKeyPem: PRIVATE_KEY_PEM }, fetchMock);
        await expect(auth.getInstallationToken(42)).rejects.toThrow(/HTTP 401/);
    });
});
