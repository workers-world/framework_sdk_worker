/**
 * GitHub Octokit 工厂：统一 REST 客户端、User-Agent、API Version、429/5xx 退避。
 * 上游：github/client、github/repo（及业务 Worker 需直接 REST 时）。
 * 下游：@octokit/core + rest-endpoint-methods → api.github.com。
 * 不变量：auth 为 PAT 或 App installation token；写方法默认不重试（retryWrite opt-in）。
 */

import { Octokit } from '@octokit/core';
import { restEndpointMethods } from '@octokit/plugin-rest-endpoint-methods';

const RETRY_DELAYS_MS = [1000, 2000];
const IDEMPOTENT_RETRY_METHODS = new Set(['GET', 'HEAD']);

const GithubOctokit = Octokit.plugin(restEndpointMethods);

export type GithubOctokit = InstanceType<typeof GithubOctokit>;

export interface CreateOctokitOptions {
    userAgent?: string;
    fetch?: typeof fetch;
    /** POST/PUT/PATCH/DELETE 对 429/5xx 也重试（仅用于幂等写） */
    retryWrite?: boolean;
}

/** 解析 `owner/repo`；非法则抛错 */
export function splitRepoFullName(fullName: string): { owner: string; repo: string } {
    const trimmed = fullName.trim();
    const slash = trimmed.indexOf('/');
    if (slash <= 0 || slash === trimmed.length - 1 || trimmed.indexOf('/', slash + 1) !== -1) {
        throw new Error(`invalid repo full name: ${fullName}`);
    }
    return { owner: trimmed.slice(0, slash), repo: trimmed.slice(slash + 1) };
}

function statusOf(error: unknown): number | undefined {
    if (error && typeof error === 'object' && 'status' in error) {
        const s = (error as { status?: unknown }).status;
        return typeof s === 'number' ? s : undefined;
    }
    return undefined;
}

function isRetryableStatus(status: number | undefined): boolean {
    return status === 429 || (status != null && status >= 500);
}

/**
 * 创建带 REST 方法的 Octokit；默认仅 GET/HEAD 对 429/5xx/网络错误退避。
 */
export function createOctokit(token: string, options?: CreateOctokitOptions): GithubOctokit {
    const userAgent = options?.userAgent ?? 'framework-sdk-worker';
    const retryWrite = options?.retryWrite === true;
    const fetchImpl = options?.fetch;

    const octokit = new GithubOctokit({
        auth: token,
        userAgent,
        request: {
            fetch: fetchImpl,
        },
        headers: {
            'X-GitHub-Api-Version': '2022-11-28',
        },
    });

    octokit.hook.wrap('request', async (request, opts) => {
        const method = String(opts.method ?? 'GET').toUpperCase();
        const allowRetry = IDEMPOTENT_RETRY_METHODS.has(method) || retryWrite;
        for (let attempt = 0; ; attempt++) {
            try {
                return await request(opts);
            } catch (error) {
                const status = statusOf(error);
                const retryable = status == null || isRetryableStatus(status);
                if (!allowRetry || !retryable || attempt >= RETRY_DELAYS_MS.length) {
                    throw error;
                }
                await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
            }
        }
    });

    return octokit;
}
