/**
 * GitHub 仓库操作：建分支、upsert 文件、建/合 PR、搜索 Issue（provider B 自托管执行用）。
 * 上游：sch1（selfhosted provider / 可配置自动合入）、deploy-tracker。
 * 下游：Octokit REST（api.github.com）；GraphQL markReady 仍走 ghFetch。
 * 不变量：token 由调用方传入（PAT 或 App installation token）；建分支/建 PR 幂等
 * （422 已存在视为成功并回查既有资源）；文件内容 base64 UTF-8。
 */
import { ghFetch } from './client.js';
import { createOctokit, splitRepoFullName } from './octokit.js';

function toBase64Utf8(content: string): string {
    const bytes = new TextEncoder().encode(content);
    let binary = '';
    for (const b of bytes) {
        binary += String.fromCharCode(b);
    }
    return btoa(binary);
}

function httpStatus(error: unknown): number | undefined {
    if (error && typeof error === 'object' && 'status' in error) {
        const s = (error as { status?: unknown }).status;
        return typeof s === 'number' ? s : undefined;
    }
    return undefined;
}

function errorMessage(error: unknown): string {
    if (error && typeof error === 'object' && 'message' in error) {
        const m = (error as { message?: unknown }).message;
        if (typeof m === 'string') {
            return m;
        }
    }
    return error instanceof Error ? error.message : String(error);
}

export async function getDefaultBranch(token: string, repo: string): Promise<string | null> {
    try {
        const { owner, repo: name } = splitRepoFullName(repo);
        const octokit = createOctokit(token);
        const { data } = await octokit.rest.repos.get({ owner, repo: name });
        return data.default_branch ?? null;
    } catch {
        return null;
    }
}

export async function getBranchHeadSha(
    token: string,
    repo: string,
    branch: string,
): Promise<string | null> {
    try {
        const { owner, repo: name } = splitRepoFullName(repo);
        const octokit = createOctokit(token);
        const { data } = await octokit.rest.git.getRef({
            owner,
            repo: name,
            ref: `heads/${branch}`,
        });
        return data.object?.sha ?? null;
    } catch {
        return null;
    }
}

/** 建分支（基于 fromSha）；已存在（422）视为成功 */
export async function createBranch(
    token: string,
    repo: string,
    branch: string,
    fromSha: string,
): Promise<boolean> {
    try {
        const { owner, repo: name } = splitRepoFullName(repo);
        const octokit = createOctokit(token);
        await octokit.rest.git.createRef({
            owner,
            repo: name,
            ref: `refs/heads/${branch}`,
            sha: fromSha,
        });
        return true;
    } catch (error) {
        return httpStatus(error) === 422;
    }
}

/** upsert 单个文件：已存在则带 sha 更新（幂等） */
export async function upsertRepoFile(
    token: string,
    repo: string,
    path: string,
    content: string,
    message: string,
    branch: string,
): Promise<boolean> {
    try {
        const { owner, repo: name } = splitRepoFullName(repo);
        const octokit = createOctokit(token);
        let existingSha: string | undefined;
        try {
            const existing = await octokit.rest.repos.getContent({
                owner,
                repo: name,
                path,
                ref: branch,
            });
            if (!Array.isArray(existing.data) && 'sha' in existing.data) {
                existingSha = existing.data.sha;
            }
        } catch {
            // 不存在则新建
        }
        await octokit.rest.repos.createOrUpdateFileContents({
            owner,
            repo: name,
            path,
            message,
            content: toBase64Utf8(content),
            branch,
            ...(existingSha ? { sha: existingSha } : {}),
        });
        return true;
    } catch {
        return false;
    }
}

export interface NewPullRequest {
    title: string;
    head: string;
    base: string;
    body: string;
}

export type PullMergeMethod = 'merge' | 'squash' | 'rebase';

export interface MergePullRequestInput {
    mergeMethod?: PullMergeMethod;
    commitTitle?: string;
    commitMessage?: string;
}

export interface MergePullRequestResult {
    ok: boolean;
    merged?: boolean;
    sha?: string;
    error?: string;
    /** 临时不可合（如 required checks）可稍后重试；冲突等永久失败为 false */
    retryable?: boolean;
}

/** 合入 PR（PUT .../pulls/{n}/merge）；已合入视为幂等成功 */
export async function mergePullRequest(
    token: string,
    repo: string,
    pullNumber: number,
    input: MergePullRequestInput = {},
): Promise<MergePullRequestResult> {
    const method = input.mergeMethod ?? 'squash';
    try {
        const { owner, repo: name } = splitRepoFullName(repo);
        const octokit = createOctokit(token);
        const { data } = await octokit.rest.pulls.merge({
            owner,
            repo: name,
            pull_number: pullNumber,
            merge_method: method,
            ...(input.commitTitle?.trim() ? { commit_title: input.commitTitle.trim() } : {}),
            ...(input.commitMessage?.trim() ? { commit_message: input.commitMessage.trim() } : {}),
        });
        if (!data.merged) {
            return {
                ok: false,
                merged: false,
                error: data.message?.trim() || 'merge returned merged=false',
                retryable: true,
            };
        }
        return { ok: true, merged: true, sha: data.sha };
    } catch (error) {
        const status = httpStatus(error);
        const snippet = errorMessage(error).slice(0, 300);
        if (status === 405 || status === 409) {
            const lower = snippet.toLowerCase();
            const conflict =
                lower.includes('conflict') ||
                lower.includes('dirty') ||
                lower.includes('not mergeable');
            return {
                ok: false,
                error: `合入失败: ${status} ${snippet}`,
                retryable: !conflict,
            };
        }
        if (status === 422) {
            const lower = snippet.toLowerCase();
            if (lower.includes('already merged') || lower.includes('pull request is not open')) {
                return { ok: true, merged: true };
            }
            return {
                ok: false,
                error: `合入失败: ${status} ${snippet}`,
                retryable: lower.includes('required') || lower.includes('status'),
            };
        }
        return {
            ok: false,
            error: `合入失败: ${status ?? 'network'} ${snippet}`,
            retryable: status == null || status >= 500,
        };
    }
}

/** 建 PR；已存在（422）回查同 head 的开放 PR 返回其 url */
export async function createPullRequest(
    token: string,
    repo: string,
    input: NewPullRequest,
): Promise<{ ok: boolean; prUrl?: string; error?: string }> {
    const { owner, repo: name } = splitRepoFullName(repo);
    const octokit = createOctokit(token);
    try {
        const { data } = await octokit.rest.pulls.create({
            owner,
            repo: name,
            title: input.title,
            head: input.head,
            base: input.base,
            body: input.body,
        });
        return { ok: true, prUrl: data.html_url };
    } catch (error) {
        if (httpStatus(error) === 422) {
            try {
                // head 格式为 user:ref-name（非 owner/repo:branch）
                const existing = await octokit.rest.pulls.list({
                    owner,
                    repo: name,
                    head: `${owner}:${input.head}`,
                    state: 'open',
                });
                const url = existing.data[0]?.html_url;
                if (url) {
                    return { ok: true, prUrl: url };
                }
            } catch {
                // fall through
            }
            return { ok: false, error: 'PR 已存在但回查失败' };
        }
        const text = errorMessage(error);
        return {
            ok: false,
            error: `创建 PR 失败: ${httpStatus(error) ?? 'network'} ${text.slice(0, 200)}`,
        };
    }
}

export interface GitHubPullRef {
    repo: string;
    number: number;
}

/**
 * 解析 GitHub PR URL（html_url）。
 * `fallbackRepo` 仅在 path 缺 owner/repo 时使用（罕见）。
 */
export function parseGitHubPullRef(prUrl: string, fallbackRepo?: string): GitHubPullRef | null {
    const raw = prUrl.trim();
    if (!raw) {
        return null;
    }
    let pathname: string;
    try {
        pathname = new URL(raw).pathname;
    } catch {
        return null;
    }
    const m = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/i.exec(pathname);
    if (m) {
        return { repo: `${m[1]}/${m[2]}`, number: Number(m[3]) };
    }
    const numOnly = /^\/pull\/(\d+)(?:\/|$)/i.exec(pathname);
    if (numOnly && fallbackRepo?.trim()) {
        const repo = fallbackRepo.trim();
        if (/^[^/]+\/[^/]+$/.test(repo)) {
            return { repo, number: Number(numOnly[1]) };
        }
    }
    return null;
}

const MARK_PR_READY_GQL = `mutation MarkPullRequestReadyForReview($pullRequestId: ID!) {
  markPullRequestReadyForReview(input: { pullRequestId: $pullRequestId }) {
    pullRequest { isDraft }
  }
}`;

/**
 * 将 draft PR 标为 Ready for review（GraphQL；REST ready_for_review 对部分 App/权限会 404）。
 * 已是非 draft 视为幂等成功（alreadyReady）。
 */
export async function markPullRequestReadyForReview(
    token: string,
    repo: string,
    pullNumber: number,
): Promise<{ ok: boolean; alreadyReady?: boolean; error?: string }> {
    const { owner, repo: name } = splitRepoFullName(repo);
    const octokit = createOctokit(token);
    let nodeId: string | undefined;
    let draft: boolean | undefined;
    try {
        const { data: pull } = await octokit.rest.pulls.get({
            owner,
            repo: name,
            pull_number: pullNumber,
        });
        draft = pull.draft;
        nodeId = pull.node_id?.trim();
    } catch (error) {
        return {
            ok: false,
            error: `pulls.get 失败: ${httpStatus(error) ?? 'network'} ${errorMessage(error).slice(0, 200)}`,
        };
    }
    if (!draft) {
        return { ok: true, alreadyReady: true };
    }
    if (!nodeId) {
        return { ok: false, error: 'pull 缺少 node_id，无法 GraphQL 转正' };
    }

    // GraphQL 非 REST plugin 覆盖；保留 ghFetch
    const gqlResp = await ghFetch(token, 'https://api.github.com/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            query: MARK_PR_READY_GQL,
            variables: { pullRequestId: nodeId },
        }),
    });
    if (!gqlResp.ok) {
        const text = await gqlResp.text();
        return {
            ok: false,
            error: `graphql 失败: ${gqlResp.status} ${text.slice(0, 200)}`,
        };
    }
    const gqlBody = (await gqlResp.json()) as {
        data?: { markPullRequestReadyForReview?: { pullRequest?: { isDraft?: boolean } } };
        errors?: Array<{ message?: string }>;
    };
    const gqlErrors = gqlBody.errors?.map((e) => e.message).filter(Boolean);
    if (gqlErrors && gqlErrors.length > 0) {
        const msg = gqlErrors.join('; ');
        const lower = msg.toLowerCase();
        if (lower.includes('not a draft') || lower.includes('already')) {
            return { ok: true, alreadyReady: true };
        }
        return { ok: false, error: `graphql: ${msg.slice(0, 200)}` };
    }
    const stillDraft = gqlBody.data?.markPullRequestReadyForReview?.pullRequest?.isDraft;
    if (stillDraft === true) {
        return { ok: false, error: 'graphql 成功但 PR 仍为 draft' };
    }
    return { ok: true };
}

export interface SearchedIssue {
    repo: string;
    number: number;
    title: string;
    state: string;
    htmlUrl?: string;
}

/** 搜索 Issue（漏网对账用；query 同 GitHub search 语法） */
export async function searchIssues(
    token: string,
    query: string,
    limit = 20,
): Promise<SearchedIssue[]> {
    try {
        const octokit = createOctokit(token);
        const { data } = await octokit.rest.search.issuesAndPullRequests({
            q: query,
            per_page: limit,
        });
        return (data.items ?? []).map((item) => ({
            repo: (item.repository_url ?? '').replace('https://api.github.com/repos/', ''),
            number: item.number,
            title: item.title,
            state: item.state,
            htmlUrl: item.html_url,
        }));
    } catch {
        return [];
    }
}
