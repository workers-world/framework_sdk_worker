/**
 * GitHub API 客户端：统一请求头、429/5xx 指数退避重试、Issue 读写封装。
 * 上游：持有 GitHub token（PAT 或 App installation token）的 Worker。
 * 下游：api.github.com。
 * 不变量：429/5xx 自动退避（1s/2s）仅幂等方法 GET/HEAD 默认启用，写方法需 retryWrite 显式
 * opt-in（避免 5xx 歧义时重复创建资源）；写操作显式封装便于审计；错误带 HTTP 状态。
 */

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
        { method: 'POST', body: JSON.stringify({ labels }), retryWrite: true },
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
        { method: 'DELETE', retryWrite: true },
    );
    return Boolean(resp?.ok || resp?.status === 404);
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
    const resp = await ghFetchWithRetry(token, `https://api.github.com/repos/${repo}/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            title: input.title,
            body: input.body,
            labels: input.labels ?? [],
        }),
    });
    if (!resp?.ok) {
        return null;
    }
    const data = (await resp.json()) as {
        number?: number;
        html_url?: string;
        state?: string;
    };
    if (data.number == null || !data.html_url) {
        return null;
    }
    return {
        number: data.number,
        htmlUrl: data.html_url,
        state: data.state === 'closed' ? 'closed' : 'open',
    };
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

/** 更新 Issue 正文（PATCH）；失败返回 false */
export async function updateIssueBody(
    token: string,
    repo: string,
    issueNumber: number,
    body: string,
): Promise<boolean> {
    const resp = await ghFetchWithRetry(
        token,
        `https://api.github.com/repos/${repo}/issues/${issueNumber}`,
        {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body }),
            retryWrite: true,
        },
    );
    return Boolean(resp?.ok);
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

function encodeContentsPath(path: string): string {
    return path
        .split('/')
        .filter(Boolean)
        .map((seg) => encodeURIComponent(seg))
        .join('/');
}

async function resolveRepoMeta(
    token: string,
    repo: string,
): Promise<{ id: number; defaultBranch: string } | null> {
    const resp = await ghFetchWithRetry(token, `https://api.github.com/repos/${repo}`);
    if (!resp?.ok) {
        return null;
    }
    const data = (await resp.json()) as { id?: number; default_branch?: string };
    if (data.id == null || !data.default_branch) {
        return null;
    }
    return { id: data.id, defaultBranch: data.default_branch };
}

/**
 * 尝试 uploads.github.com user-attachments（图片/视频；App token 常 404）。
 * 失败则 Contents API 写入仓库路径，Issue 正文可链 html_url / download_url。
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
    const encodedPath = encodeContentsPath(path);

    const getResp = await ghFetchWithRetry(
        token,
        `https://api.github.com/repos/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`,
    );
    let existingSha: string | undefined;
    if (!getResp || (getResp.status !== 404 && !getResp.ok)) {
        // GET 不可判定（网络错误 / 5xx 等非 404）：盲 PUT 会 422（已存在缺 sha）或误覆盖，中止
        return null;
    }
    if (getResp.ok) {
        const existing = (await getResp.json()) as { sha?: string };
        existingSha = existing.sha;
    }

    const putBody: Record<string, string> = {
        message: `sch1: attach intake evidence for #${issueNumber} (${filename})`,
        content: bytesToBase64(input.bytes),
        branch,
    };
    if (existingSha) {
        putBody.sha = existingSha;
    }

    const putResp = await ghFetchWithRetry(
        token,
        `https://api.github.com/repos/${repo}/contents/${encodedPath}`,
        {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(putBody),
            // 同路径同内容 + 带 sha 更新，重试收敛
            retryWrite: true,
        },
    );
    if (!putResp?.ok) {
        return null;
    }
    const putData = (await putResp.json()) as {
        content?: { html_url?: string; download_url?: string; name?: string };
        commit?: { html_url?: string };
    };
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
}
