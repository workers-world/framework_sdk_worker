/**
 * GitHub Octokit 工厂：统一 REST 客户端、User-Agent、API Version、429/5xx 退避。
 * 上游：github/client、github/repo（及业务 Worker 需直接 REST 时）。
 * 下游：@octokit/core + rest-endpoint-methods → api.github.com。
 * 不变量：auth 为 PAT 或 App installation token；写方法默认不重试（retryWrite opt-in）。
 */

import { Octokit } from '@octokit/core';
import { restEndpointMethods } from '@octokit/plugin-rest-endpoint-methods';
import { githubRetryDelayMs, isGithubRequestRetryable } from '../resilience/provider-error.js';

const MAX_GITHUB_RETRIES = 3;
const IDEMPOTENT_RETRY_METHODS = new Set(['GET', 'HEAD']);

/**
 * GitHub REST calendar version（`X-GitHub-Api-Version`）。
 * `2022-11-28` 已标 deprecated，Sunset 2028-03-10；新建请求用当前稳定版。
 * @see https://docs.github.com/en/rest/about-the-rest-api/api-versions
 */
export const GITHUB_API_VERSION = '2026-03-10';

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
            headers: {
                'X-GitHub-Api-Version': GITHUB_API_VERSION,
            },
        },
    });

    octokit.hook.wrap('request', async (request, opts) => {
        const method = String(opts.method ?? 'GET').toUpperCase();
        const allowRetry = IDEMPOTENT_RETRY_METHODS.has(method) || retryWrite;
        for (let attempt = 0; ; attempt++) {
            try {
                return await request(opts);
            } catch (error) {
                const canRetry =
                    allowRetry &&
                    isGithubRequestRetryable(error, method) &&
                    attempt < MAX_GITHUB_RETRIES;
                if (!canRetry) {
                    throw error;
                }
                await new Promise((r) => setTimeout(r, githubRetryDelayMs(error, attempt)));
            }
        }
    });

    return octokit;
}
