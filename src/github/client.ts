/**
 * GitHub API 客户端：统一请求头、429/5xx 指数退避重试、Issue 读写封装。
 * 上游：持有 GitHub token（PAT 或 App installation token）的 Worker。
 * 下游：Octokit REST（api.github.com）；uploads.github.com 仍走 fetch（Octokit 不覆盖）。
 * 不变量：429/5xx 自动退避（1s/2s）仅幂等方法 GET/HEAD 默认启用，写方法需 retryWrite 显式
 * opt-in（避免 5xx 歧义时重复创建资源）；写操作显式封装便于审计；错误带 HTTP 状态。
 */

import { createOctokit, splitRepoFullName } from './octokit.js';

const RETRY_DELAYS_MS = [1000, 2000];

const IDEMPOTENT_RETRY_METHODS = new Set(['GET', 'HEAD']);

/** ghFetchWithRetry 的 init：RequestInit + retryWrite（写方法重试 opt-in） */
export type GhFetchInit = RequestInit & {
    /** POST/PUT/PATCH/DELETE 对 429/5xx 也重试（仅用于幂等写，如带 sha 的 upsert） */
    retryWrite?: boolean;
};

export function githubHeaders(token: string, userAgent = 'framework-sdk-worker'): HeadersInit {
    return {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': userAgent,
        'X-GitHub-Api-Version': '2022-11-28',
    };
}

export async function ghFetch(token: string, url: string, init?: RequestInit): Promise<Response> {
    return fetch(url, {
        ...init,
        headers: {
            ...githubHeaders(token),
            ...(init?.headers ?? {}),
        },
        redirect: 'follow',
    });
}

/**
 * GitHub API：对 429/5xx/网络错误做指数退避重试；默认仅幂等方法（GET/HEAD）重试，
 * POST/PUT/PATCH/DELETE 需 init.retryWrite=true 显式 opt-in（失败即返回，防重复创建）；
 * 仍失败返回最后一次 Response（网络错误返回 null）。
 *
 * 低层 fetch 门面（uploads.github.com、GraphQL、deploy-tracker 过渡）；新 REST 优先 createOctokit。
 */
export async function ghFetchWithRetry(
    token: string,
    url: string,
    init?: GhFetchInit,
): Promise<Response | null> {
    const { retryWrite, ...fetchInit } = init ?? {};
    const method = (fetchInit.method ?? 'GET').toUpperCase();
    const allowRetry = IDEMPOTENT_RETRY_METHODS.has(method) || retryWrite === true;
    for (let attempt = 0; ; attempt++) {
        try {
            const resp = await ghFetch(token, url, fetchInit);
            if (resp.ok || (resp.status < 500 && resp.status !== 429) || !allowRetry) {
                return resp;
            }
            if (attempt < RETRY_DELAYS_MS.length) {
                await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
                continue;
            }
            return resp;
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.log(`event=github_api msg=fetch error url=${url} error=${msg}`);
            if (!allowRetry || attempt >= RETRY_DELAYS_MS.length) {
                return null;
            }
            await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
        }
    }
}

export interface IssueSnapshot {
    number: number;
    state: 'open' | 'closed';
    title: string;
    body: string | null;
    labels: string[];
    updatedAt: string;
    /** REST `html_url`；展示链接用，勿拼 github.com */
    htmlUrl: string;
}

function httpStatus(error: unknown): number | undefined {
    if (error && typeof error === 'object' && 'status' in error) {
        const s = (error as { status?: unknown }).status;
        return typeof s === 'number' ? s : undefined;
    }
    return undefined;
}

/** 读取 Issue 快照（state/title/body/labels/updated_at/html_url） */
export async function getIssue(
    token: string,
    repo: string,
    issueNumber: number,
): Promise<IssueSnapshot | null> {
    try {
        const { owner, repo: name } = splitRepoFullName(repo);
        const octokit = createOctokit(token);
        const { data } = await octokit.rest.issues.get({
            owner,
            repo: name,
            issue_number: issueNumber,
        });
        return {
            number: data.number,
            state: data.state === 'closed' ? 'closed' : 'open',
            title: data.title,
            body: data.body ?? null,
            labels: (data.labels ?? [])
                .map((l) => (typeof l === 'string' ? l : (l.name ?? '')))
                .filter(Boolean),
            updatedAt: data.updated_at,
            htmlUrl: data.html_url,
        };
    } catch {
        return null;
    }
}

/** 给 Issue 添加标签（已存在不报错） */
export async function addIssueLabels(
    token: string,
    repo: string,
    issueNumber: number,
    labels: string[],
): Promise<boolean> {
    if (labels.length === 0) {
        return true;
    }
    try {
        const { owner, repo: name } = splitRepoFullName(repo);
        const octokit = createOctokit(token, { retryWrite: true });
        await octokit.rest.issues.addLabels({
            owner,
            repo: name,
            issue_number: issueNumber,
            labels,
        });
        return true;
    } catch {
        return false;
    }
}

/** 移除 Issue 标签；标签本不存在视为成功 */
export async function removeIssueLabel(
    token: string,
    repo: string,
    issueNumber: number,
    label: string,
): Promise<boolean> {
    try {
        const { owner, repo: name } = splitRepoFullName(repo);
        const octokit = createOctokit(token, { retryWrite: true });
        await octokit.rest.issues.removeLabel({
            owner,
            repo: name,
            issue_number: issueNumber,
            name: label,
        });
        return true;
    } catch (error) {
        return httpStatus(error) === 404;
    }
}

export interface CreateIssueInput {
    title: string;
    body: string;
    labels?: string[];
}

export interface CreatedIssue {
    number: number;
    htmlUrl: string;
    state: 'open' | 'closed';
}

/** 创建 Issue；失败返回 null */
export async function createIssue(
    token: string,
    repo: string,
    input: CreateIssueInput,
): Promise<CreatedIssue | null> {
    try {
        const { owner, repo: name } = splitRepoFullName(repo);
        const octokit = createOctokit(token);
        const { data } = await octokit.rest.issues.create({
            owner,
            repo: name,
            title: input.title,
            body: input.body,
            labels: input.labels ?? [],
        });
        if (data.number == null || !data.html_url) {
            return null;
        }
        return {
            number: data.number,
            htmlUrl: data.html_url,
            state: data.state === 'closed' ? 'closed' : 'open',
        };
    } catch {
        return null;
    }
}

/** 创建 Issue 评论；返回评论 id（失败返回 null） */
export async function createIssueComment(
    token: string,
    repo: string,
    issueNumber: number,
    body: string,
): Promise<number | null> {
    try {
        const { owner, repo: name } = splitRepoFullName(repo);
        const octokit = createOctokit(token);
        const { data } = await octokit.rest.issues.createComment({
            owner,
            repo: name,
            issue_number: issueNumber,
            body,
        });
        return data.id != null ? Number(data.id) : null;
    } catch {
        return null;
    }
}

/** 更新 Issue 正文（PATCH）；失败返回 false */
export async function updateIssueBody(
    token: string,
    repo: string,
    issueNumber: number,
    body: string,
): Promise<boolean> {
    try {
        const { owner, repo: name } = splitRepoFullName(repo);
        const octokit = createOctokit(token, { retryWrite: true });
        await octokit.rest.issues.update({
            owner,
            repo: name,
            issue_number: issueNumber,
            body,
        });
        return true;
    } catch {
        return false;
    }
}

export interface UploadIssueAttachmentInput {
    filename: string;
    contentType?: string;
    bytes: Uint8Array;
    /**
     * Contents API 落盘路径前缀（默认 `.sch1/intake-evidence/issue-{n}`）。
     * zip/csv 等非图片无法走 user-attachments bearer 时用此路径。
     */
    contentsPathPrefix?: string;
    /** Contents API 目标分支；缺省取仓库 default_branch */
    branch?: string;
}

export interface UploadedIssueAttachment {
    name: string;
    url: string;
    /** user-attachments：原生附件；repo-contents：Contents API 落仓（App token + zip/csv 可靠路径） */
    via: 'user-attachments' | 'repo-contents';
}

function bytesToBase64(bytes: Uint8Array): string {
    const chunk = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunk) {
        const slice = bytes.subarray(i, Math.min(i + chunk, bytes.length));
        for (let j = 0; j < slice.length; j++) {
            const code = slice[j];
            if (code != null) {
                binary += String.fromCharCode(code);
            }
        }
    }
    return btoa(binary);
}

function safeAttachmentFilename(filename: string): string {
    const base = filename.replace(/\\/g, '/').split('/').pop() ?? 'attachment.bin';
    return base.replace(/[^\w.\-()+@]/g, '_') || 'attachment.bin';
}

async function resolveRepoMeta(
    token: string,
    repo: string,
): Promise<{ id: number; defaultBranch: string; htmlUrl: string } | null> {
    try {
        const { owner, repo: name } = splitRepoFullName(repo);
        const octokit = createOctokit(token);
        const { data } = await octokit.rest.repos.get({ owner, repo: name });
        if (data.id == null || !data.default_branch) {
            return null;
        }
        const id = typeof data.id === 'bigint' ? Number(data.id) : Number(data.id);
        return {
            id,
            defaultBranch: data.default_branch,
            htmlUrl: data.html_url ?? '',
        };
    } catch {
        return null;
    }
}

/**
 * 尝试 uploads.github.com user-attachments（图片/视频；App token 常 404）。
 * 失败则 Contents API 写入仓库路径，Issue 正文可链 html_url / download_url。
 * 注意：uploads.github.com 非 Octokit REST 覆盖范围，保留 ghFetch。
 */
export async function uploadIssueAttachment(
    token: string,
    repo: string,
    issueNumber: number,
    input: UploadIssueAttachmentInput,
): Promise<UploadedIssueAttachment | null> {
    const filename = safeAttachmentFilename(input.filename);
    const contentType = input.contentType?.trim() || 'application/octet-stream';
    const meta = await resolveRepoMeta(token, repo);
    if (!meta) {
        return null;
    }

    const uploadUrl = new URL('https://uploads.github.com/user-attachments/assets');
    uploadUrl.searchParams.set('name', filename);
    uploadUrl.searchParams.set('content_type', contentType);
    uploadUrl.searchParams.set('repository_id', String(meta.id));

    const attachResp = await ghFetchWithRetry(token, uploadUrl.toString(), {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': contentType,
        },
        body: input.bytes,
        // 未引用资产（孤儿附件）无害，保持既有重试语义
        retryWrite: true,
    });
    if (attachResp?.ok) {
        const data = (await attachResp.json()) as { url?: string; href?: string };
        const url = data.url ?? data.href;
        if (url) {
            return { name: filename, url, via: 'user-attachments' };
        }
    }

    const prefix =
        input.contentsPathPrefix?.replace(/\/+$/, '') ||
        `.sch1/intake-evidence/issue-${issueNumber}`;
    const path = `${prefix}/${filename}`;
    const branch = input.branch?.trim() || meta.defaultBranch;

    try {
        const { owner, repo: name } = splitRepoFullName(repo);
        const octokit = createOctokit(token, { retryWrite: true });
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
        } catch (error) {
            // GET 不可判定（网络错误 / 5xx 等非 404）：盲 PUT 会 422（已存在缺 sha）或误覆盖，中止
            if (httpStatus(error) !== 404) {
                return null;
            }
        }

        const { data: putData } = await octokit.rest.repos.createOrUpdateFileContents({
            owner,
            repo: name,
            path,
            message: `sch1: attach intake evidence for #${issueNumber} (${filename})`,
            content: bytesToBase64(input.bytes),
            branch,
            ...(existingSha ? { sha: existingSha } : {}),
        });
        const url =
            putData.content?.download_url ?? putData.content?.html_url ?? putData.commit?.html_url;
        if (!url) {
            return null;
        }
        return {
            name: putData.content?.name ?? filename,
            url,
            via: 'repo-contents',
        };
    } catch {
        return null;
    }
}

/** 仓库 html_url（展示用）；失败返回 null */
export async function getRepoHtmlUrl(token: string, repo: string): Promise<string | null> {
    const meta = await resolveRepoMeta(token, repo);
    return meta?.htmlUrl ?? null;
}

export { createOctokit, splitRepoFullName } from './octokit.js';
