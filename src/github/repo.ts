/**
 * GitHub 仓库操作：建分支、upsert 文件、建 PR、搜索 Issue（provider B 自托管执行用）。
 * 上游：sch1（selfhosted provider）、deploy-tracker 同模式实现（后续迁移方）。
 * 下游：api.github.com（ghFetchWithRetry 退避）。
 * 不变量：token 由调用方传入（PAT 或 App installation token）；建分支/建 PR 幂等
 * （422 已存在视为成功并回查既有资源）；文件内容 base64 UTF-8。
 */
import { ghFetch, ghFetchWithRetry } from './client.js';

function toBase64Utf8(content: string): string {
    const bytes = new TextEncoder().encode(content);
    let binary = '';
    for (const b of bytes) {
        binary += String.fromCharCode(b);
    }
    return btoa(binary);
}

export async function getDefaultBranch(token: string, repo: string): Promise<string | null> {
    const resp = await ghFetchWithRetry(token, `https://api.github.com/repos/${repo}`);
    if (!resp?.ok) {
        return null;
    }
    const data = (await resp.json()) as { default_branch?: string };
    return data.default_branch ?? null;
}

export async function getBranchHeadSha(
    token: string,
    repo: string,
    branch: string,
): Promise<string | null> {
    const resp = await ghFetchWithRetry(
        token,
        `https://api.github.com/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
    );
    if (!resp?.ok) {
        return null;
    }
    const data = (await resp.json()) as { object?: { sha?: string } };
    return data.object?.sha ?? null;
}

/** 建分支（基于 fromSha）；已存在（422）视为成功 */
export async function createBranch(
    token: string,
    repo: string,
    branch: string,
    fromSha: string,
): Promise<boolean> {
    const resp = await ghFetch(token, `https://api.github.com/repos/${repo}/git/refs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: fromSha }),
    });
    return resp.ok || resp.status === 422;
}

interface ContentGetResponse {
    sha?: string;
    content?: string;
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
    const getResp = await ghFetch(
        token,
        `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`,
    );
    let existingSha: string | undefined;
    if (getResp.ok) {
        const data = (await getResp.json()) as ContentGetResponse;
        existingSha = data.sha;
    }
    const body: Record<string, string> = {
        message,
        content: toBase64Utf8(content),
        branch,
    };
    if (existingSha) {
        body.sha = existingSha;
    }
    const resp = await ghFetch(
        token,
        `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`,
        {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        },
    );
    return resp.ok;
}

export interface NewPullRequest {
    title: string;
    head: string;
    base: string;
    body: string;
}

/** 建 PR；已存在（422）回查同 head 的开放 PR 返回其 url */
export async function createPullRequest(
    token: string,
    repo: string,
    input: NewPullRequest,
): Promise<{ ok: boolean; prUrl?: string; error?: string }> {
    const resp = await ghFetchWithRetry(token, `https://api.github.com/repos/${repo}/pulls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
    });
    if (resp?.ok) {
        const data = (await resp.json()) as { html_url?: string };
        return { ok: true, prUrl: data.html_url };
    }
    if (resp?.status === 422) {
        const existing = await ghFetch(
            token,
            `https://api.github.com/repos/${repo}/pulls?head=${encodeURIComponent(`${repo}:${input.head}`)}&state=open`,
        );
        if (existing?.ok) {
            const list = (await existing.json()) as Array<{ html_url?: string }>;
            const url = list[0]?.html_url;
            if (url) {
                return { ok: true, prUrl: url };
            }
        }
        return { ok: false, error: 'PR 已存在但回查失败' };
    }
    const text = resp ? await resp.text() : 'network error';
    return { ok: false, error: `创建 PR 失败: ${resp?.status ?? 'network'} ${text.slice(0, 200)}` };
}

export interface SearchedIssue {
    repo: string;
    number: number;
    title: string;
    state: string;
}

/** 搜索 Issue（漏网对账用；query 同 GitHub search 语法） */
export async function searchIssues(
    token: string,
    query: string,
    limit = 20,
): Promise<SearchedIssue[]> {
    const resp = await ghFetchWithRetry(
        token,
        `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=${limit}`,
    );
    if (!resp?.ok) {
        return [];
    }
    const data = (await resp.json()) as {
        items?: Array<{ number: number; title: string; state: string; repository_url?: string }>;
    };
    return (data.items ?? []).map((item) => ({
        repo: (item.repository_url ?? '').replace('https://api.github.com/repos/', ''),
        number: item.number,
        title: item.title,
        state: item.state,
    }));
}
