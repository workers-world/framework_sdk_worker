/**
 * browser-run（BOR1）Service Binding 薄客户端。
 * 业务 Worker 只调本模块；账号级 slot / 429 cooldown / 引擎选择在 BOR1 内封装。
 */
import { resolveSecret, type SecretLike } from '../secrets/resolve.js';

/** markdown 默认 20s + 网关开销；pdf/screenshot 默认 30s */
const BROWSER_CALL_TIMEOUT_MS: Record<BrowserAction, number> = {
    markdown: 25_000,
    pdf: 35_000,
    screenshot: 35_000,
};

export type BrowserAction = 'markdown' | 'pdf' | 'screenshot';

export type BrowserActionFailReason =
    | 'rate_limit'
    | 'render_error'
    | 'unauthorized'
    | 'network'
    | 'config'
    | 'empty';

export interface BrowserGotoOptions {
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
    timeout?: number;
}

export interface BrowserActionParams {
    url?: string;
    html?: string;
    gotoOptions?: BrowserGotoOptions;
    viewport?: { width: number; height: number };
    /** 调用方标识，如 `email-rule-worker:fetch-article` */
    caller?: string;
}

export interface BrowserRunEnv {
    SVC_BROWSER_RUN?: Fetcher;
    BROWSER_RUN_AUTH_TOKEN?: SecretLike;
}

export type BrowserActionResult =
    | {
          ok: true;
          action: 'markdown';
          text: string;
          engine?: string;
          browserMsUsed?: number;
      }
    | {
          ok: true;
          action: 'pdf' | 'screenshot';
          bytes: ArrayBuffer;
          contentType: string;
          engine?: string;
          browserMsUsed?: number;
      }
    | {
          ok: false;
          error: string;
          failReason: BrowserActionFailReason;
          status?: number;
          retryAfterSec?: number;
          engine?: string;
      };

interface BrowserErrorBody {
    ok?: boolean;
    error?: string;
    code?: string;
    failReason?: string;
}

interface BrowserMarkdownBody {
    ok?: boolean;
    result?: string;
    text?: string;
    engine?: string;
}

function parseRetryAfterHeader(raw: string | null): number | undefined {
    if (!raw) {
        return undefined;
    }
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parseBrowserMsUsed(raw: string | null): number | undefined {
    if (!raw) {
        return undefined;
    }
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function mapFailReason(status: number, code?: string): BrowserActionFailReason {
    if (code === 'rate_limit' || status === 429) {
        return 'rate_limit';
    }
    if (code === 'render_error' || status === 422) {
        return 'render_error';
    }
    if (code === 'unauthorized' || status === 401 || status === 403) {
        return 'unauthorized';
    }
    if (code === 'empty') {
        return 'empty';
    }
    if (status >= 500 || status === 0) {
        return 'network';
    }
    return 'render_error';
}

function actionPath(action: BrowserAction): string {
    return `https://browser-run/internal/v1/${action}`;
}

/**
 * 通过 Service Binding 调用 browser-run Quick Action 网关。
 * host 填 https://browser-run 即可，不走公网。
 */
export async function runBrowserAction(
    env: BrowserRunEnv,
    action: BrowserAction,
    params: BrowserActionParams,
): Promise<BrowserActionResult> {
    if (!env.SVC_BROWSER_RUN) {
        return {
            ok: false,
            error: 'SVC_BROWSER_RUN service binding not configured',
            failReason: 'config',
        };
    }
    const token = await resolveSecret(env.BROWSER_RUN_AUTH_TOKEN);
    if (!token) {
        return {
            ok: false,
            error: 'BROWSER_RUN_AUTH_TOKEN not configured',
            failReason: 'config',
        };
    }
    if (!params.url && !params.html) {
        return {
            ok: false,
            error: 'url or html required',
            failReason: 'render_error',
            status: 400,
        };
    }

    const timeoutMs = BROWSER_CALL_TIMEOUT_MS[action];
    try {
        const resp = await env.SVC_BROWSER_RUN.fetch(actionPath(action), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
                ...(params.caller ? { 'X-Caller': params.caller } : {}),
            },
            body: JSON.stringify({
                ...(params.url ? { url: params.url } : {}),
                ...(params.html ? { html: params.html } : {}),
                ...(params.gotoOptions ? { gotoOptions: params.gotoOptions } : {}),
                ...(params.viewport ? { viewport: params.viewport } : {}),
            }),
            signal: AbortSignal.timeout(timeoutMs),
        });

        const browserMsUsed = parseBrowserMsUsed(resp.headers.get('X-Browser-Ms-Used'));
        const engine = resp.headers.get('X-Browser-Engine') ?? undefined;
        const retryAfterSec = parseRetryAfterHeader(resp.headers.get('Retry-After'));

        if (!resp.ok) {
            const data = (await resp.json().catch(() => null)) as BrowserErrorBody | null;
            const failReason = mapFailReason(resp.status, data?.code ?? data?.failReason);
            return {
                ok: false,
                error: data?.error || resp.statusText || `browser-run HTTP ${resp.status}`,
                failReason,
                status: resp.status,
                retryAfterSec,
                engine,
            };
        }

        if (action === 'markdown') {
            const data = (await resp.json().catch(() => null)) as BrowserMarkdownBody | null;
            const text =
                (typeof data?.result === 'string' ? data.result : data?.text)?.trim() ?? '';
            if (!text) {
                return {
                    ok: false,
                    error: 'browser-run markdown empty',
                    failReason: 'empty',
                    status: resp.status,
                    engine,
                };
            }
            return {
                ok: true,
                action: 'markdown',
                text,
                engine: data?.engine ?? engine,
                browserMsUsed,
            };
        }

        const contentType =
            resp.headers.get('Content-Type') ||
            (action === 'pdf' ? 'application/pdf' : 'image/png');
        const bytes = await resp.arrayBuffer();
        if (!bytes.byteLength) {
            return {
                ok: false,
                error: `browser-run ${action} empty`,
                failReason: 'empty',
                status: resp.status,
                engine,
            };
        }
        return {
            ok: true,
            action,
            bytes,
            contentType,
            engine,
            browserMsUsed,
        };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: msg, failReason: 'network' };
    }
}

export async function browserMarkdown(
    env: BrowserRunEnv,
    params: BrowserActionParams,
): Promise<BrowserActionResult> {
    return runBrowserAction(env, 'markdown', params);
}

export async function browserPdf(
    env: BrowserRunEnv,
    params: BrowserActionParams,
): Promise<BrowserActionResult> {
    return runBrowserAction(env, 'pdf', params);
}

export async function browserScreenshot(
    env: BrowserRunEnv,
    params: BrowserActionParams,
): Promise<BrowserActionResult> {
    return runBrowserAction(env, 'screenshot', params);
}
