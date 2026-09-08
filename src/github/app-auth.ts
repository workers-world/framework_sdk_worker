/**
 * GitHub App 认证：App JWT（RS256，≤10 分钟）→ installation access token（进程内缓存）。
 * 上游：需要代表 App 安装身份调用 GitHub API 的 Worker。
 * 下游：github/client（ghFetch）。
 * 不变量：私钥须为 PKCS#8 PEM；token 缓存提前 60s 刷新；配置缺失抛错。
 */

const TOKEN_CACHE = new Map<string, { token: string; expiresAtMs: number }>();

export interface GithubAppConfig {
    appId: string;
    /** PKCS#8 PEM（.env 里 \n 转义会被归一化） */
    privateKeyPem: string;
}

function requireConfig(config: GithubAppConfig): GithubAppConfig {
    const appId = config.appId?.trim();
    const privateKeyPem = config.privateKeyPem?.trim();
    if (!appId || !privateKeyPem) {
        throw new Error('GitHub App 未配置：appId / privateKeyPem 缺失');
    }
    return { appId, privateKeyPem };
}

function normalizePem(pem: string): string {
    return pem.replace(/\\n/g, '\n').trim();
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
    const b64 = normalizePem(pem)
        .replace(/-----BEGIN [^-]+-----/, '')
        .replace(/-----END [^-]+-----/, '')
        .replace(/\s+/g, '');
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

function base64UrlEncode(data: ArrayBuffer | string): string {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
    let binary = '';
    for (const b of bytes) {
        binary += String.fromCharCode(b);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/** 签发 GitHub App JWT（≤10 分钟）。 */
export async function createGithubAppJwt(config: GithubAppConfig): Promise<string> {
    const { appId, privateKeyPem } = requireConfig(config);
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = { iat: now - 60, exp: now + 9 * 60, iss: appId };
    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    const key = await crypto.subtle.importKey(
        'pkcs8',
        pemToArrayBuffer(privateKeyPem),
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const signature = await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        key,
        new TextEncoder().encode(signingInput),
    );
    return `${signingInput}.${base64UrlEncode(signature)}`;
}

export interface GithubAppAuth {
    /** 获取 installation access token（缓存至过期前 60s） */
    getInstallationToken(installationId: number): Promise<string>;
    /** 失效某 installation 的缓存 token（401 时调用） */
    invalidate(installationId: number): void;
}

/**
 * 创建 App 认证实例。fetchImpl 可注入（测试）。
 * 缓存键 = `appId:installationId`，多 App 共存安全。
 */
export function createGithubAppAuth(
    config: GithubAppConfig,
    fetchImpl: typeof fetch = fetch,
): GithubAppAuth {
    const cacheKey = `${requireConfig(config).appId}:`;
    return {
        async getInstallationToken(installationId: number): Promise<string> {
            const key = `${cacheKey}${installationId}`;
            const cached = TOKEN_CACHE.get(key);
            if (cached && cached.expiresAtMs > Date.now() + 60_000) {
                return cached.token;
            }
            const jwt = await createGithubAppJwt(config);
            const resp = await fetchImpl(
                `https://api.github.com/app/installations/${installationId}/access_tokens`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${jwt}`,
                        Accept: 'application/vnd.github+json',
                    },
                },
            );
            if (!resp.ok) {
                const text = await resp.text();
                throw new Error(
                    `GitHub App installation token 失败 HTTP ${resp.status}: ${text.slice(0, 200)}`,
                );
            }
            const data = (await resp.json()) as { token: string; expires_at: string };
            const expiresAtMs = Date.parse(data.expires_at) || Date.now() + 50 * 60_000;
            TOKEN_CACHE.set(key, { token: data.token, expiresAtMs });
            return data.token;
        },
        invalidate(installationId: number): void {
            TOKEN_CACHE.delete(`${cacheKey}${installationId}`);
        },
    };
}
