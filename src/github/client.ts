/**
 * GitHub API 客户端：统一请求头、429/5xx 指数退避重试、Issue 读写封装。
 * 上游：持有 GitHub token（PAT 或 App installation token）的 Worker。
 * 下游：api.github.com。
 * 不变量：429/5xx 自动退避（1s/2s）；写操作显式封装便于审计；错误带 HTTP 状态。
 */

const RETRY_DELAYS_MS = [1000, 2000];

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

/** GitHub API：对 429/5xx/网络错误做指数退避重试；仍失败返回最后一次 Response（网络错误返回 null）。 */
export async function ghFetchWithRetry(
    token: string,
    url: string,
    init?: RequestInit,
): Promise<Response | null> {
    for (let attempt = 0; ; attempt++) {
        try {
            const resp = await ghFetch(token, url, init);
            if (resp.ok || (resp.status < 500 && resp.status !== 429)) {
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
            if (attempt < RETRY_DELAYS_MS.length) {
                await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
                continue;
            }
            return null;
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
}

/** 读取 Issue 快照（state/title/body/labels/updated_at） */
export async function getIssue(
    token: string,
    repo: string,
    issueNumber: number,
): Promise<IssueSnapshot | null> {
    const resp = await ghFetchWithRetry(
        token,
        `https://api.github.com/repos/${repo}/issues/${issueNumber}`,
    );
    if (!resp?.ok) {
        return null;
    }
    const data = (await resp.json()) as {
        number: number;
        state: string;
        title: string;
        body: string | null;
        labels?: Array<{ name?: string }>;
        updated_at: string;
    };
    return {
        number: data.number,
        state: data.state === 'closed' ? 'closed' : 'open',
        title: data.title,
        body: data.body,
        labels: (data.labels ?? []).map((l) => l.name ?? '').filter(Boolean),
        updatedAt: data.updated_at,
    };
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
    const resp = await ghFetchWithRetry(
        token,
        `https://api.github.com/repos/${repo}/issues/${issueNumber}/labels`,
        { method: 'POST', body: JSON.stringify({ labels }) },
    );
    return Boolean(resp?.ok);
}

/** 移除 Issue 标签；标签本不存在视为成功 */
export async function removeIssueLabel(
    token: string,
    repo: string,
    issueNumber: number,
    label: string,
): Promise<boolean> {
    const resp = await ghFetchWithRetry(
        token,
        `https://api.github.com/repos/${repo}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`,
        { method: 'DELETE' },
    );
    return Boolean(resp?.ok || resp?.status === 404);
}

/** 创建 Issue 评论；返回评论 id（失败返回 null） */
export async function createIssueComment(
    token: string,
    repo: string,
    issueNumber: number,
    body: string,
): Promise<number | null> {
    const resp = await ghFetchWithRetry(
        token,
        `https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`,
        { method: 'POST', body: JSON.stringify({ body }) },
    );
    if (!resp?.ok) {
        return null;
    }
    const data = (await resp.json()) as { id?: number };
    return data.id ?? null;
}
