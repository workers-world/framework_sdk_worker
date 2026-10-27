/**
 * AI Gateway provider BYOK 凭证错误（code 2009）。
 * 官方自 2026-10-06：上游拒绝凭证统一 HTTP 401 + 2009；
 * Unified Billing 场景为 HTTP 503。
 * @see https://developers.cloudflare.com/changelog/post/2026-10-05-provider-credential-errors/
 */

import { extractAiErrorMessage } from './neuron-quota.js';

/** AI Gateway provider credential rejected */
export const PROVIDER_CREDENTIAL_CODE = 2009;

/** llm-gateway 对外稳定错误码（调用方识别用） */
export const PROVIDER_CREDENTIAL_INVALID = 'PROVIDER_CREDENTIAL_INVALID';

const CODE_2009_RE = /\b2009\b/;
const CREDENTIAL_CONTEXT_RE =
    /credential|credentials|byok|authentication|usercredentialserror|provider.?key|invalid.?key|api.?key.?invalid/i;

function readInternalCode(value: unknown): number | undefined {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.internalCode === 'number' && Number.isFinite(record.internalCode)) {
        return record.internalCode;
    }
    if (typeof record.code === 'number' && Number.isFinite(record.code)) {
        return record.code;
    }
    if (typeof record.code === 'string' && /^\d+$/.test(record.code.trim())) {
        return Number(record.code.trim());
    }
    return undefined;
}

function readStatus(value: unknown): number | undefined {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }
    const status = (value as { status?: unknown }).status;
    return typeof status === 'number' && Number.isFinite(status) ? status : undefined;
}

function readErrorName(value: unknown): string {
    if (value instanceof Error && value.name) {
        return value.name;
    }
    if (value != null && typeof value === 'object') {
        const name = (value as { name?: unknown }).name;
        if (typeof name === 'string') {
            return name;
        }
    }
    return '';
}

function hasCredentialContext(message: string): boolean {
    if (!message) {
        return false;
    }
    if (CODE_2009_RE.test(message)) {
        return true;
    }
    if (/usercredentialserror/i.test(message)) {
        return true;
    }
    if (message.includes(PROVIDER_CREDENTIAL_INVALID)) {
        return true;
    }
    return CREDENTIAL_CONTEXT_RE.test(message);
}

/**
 * 识别 AI Gateway / llm-gateway 返回的 provider BYOK 凭证无效错误。
 * 含新码 401+2009、稳定码 PROVIDER_CREDENTIAL_INVALID，以及过渡期旧码（403 UserCredentialsError、402+credential）。
 * 裸 401（如网关自身 Bearer 失败）无 credential 语境时不命中。
 */
export function isProviderCredentialError(value: unknown): boolean {
    if (readInternalCode(value) === PROVIDER_CREDENTIAL_CODE) {
        return true;
    }

    const message = extractAiErrorMessage(value);
    const status = readStatus(value);
    const name = readErrorName(value);

    if (name === 'UserCredentialsError' || /usercredentialserror/i.test(name)) {
        return true;
    }

    if (message.includes(PROVIDER_CREDENTIAL_INVALID)) {
        return true;
    }

    if (CODE_2009_RE.test(message) && (status === 401 || status === 503 || status == null)) {
        return true;
    }

    // 新响应：401 + credential 语境（或显式 2009）
    if (status === 401 && hasCredentialContext(message)) {
        return true;
    }

    // Unified Billing：503 + credential/2009（排除 CIRCUIT_OPEN 由调用方靠 body.error 区分）
    if (status === 503 && hasCredentialContext(message) && !message.includes('CIRCUIT_OPEN')) {
        return true;
    }

    // 过渡期：ElevenLabs 等 403 UserCredentialsError / credential 文案
    if (status === 403 && hasCredentialContext(message)) {
        return true;
    }

    // 过渡期：其它 provider 曾用 402 + credential/BYOK
    if (status === 402 && hasCredentialContext(message)) {
        return true;
    }

    // 无 status 的 Error 文案（Ai.run throw）
    if (status == null && hasCredentialContext(message) && CODE_2009_RE.test(message)) {
        return true;
    }
    if (status == null && /usercredentialserror/i.test(message)) {
        return true;
    }

    return false;
}

/** Unified Billing 下 provider 拒绝凭证：HTTP 503（与 CIRCUIT_OPEN 靠 body/文案区分） */
export function isUnifiedBillingProviderCredentialError(value: unknown): boolean {
    if (!isProviderCredentialError(value)) {
        return false;
    }
    const status = readStatus(value);
    const message = extractAiErrorMessage(value);
    if (status === 503) {
        return true;
    }
    // 无显式 status 时：文案含 unified billing + credential
    return /unified\s*billing/i.test(message) && hasCredentialContext(message);
}

/**
 * 网关对外映射的 HTTP 状态：401（标准）或 503（Unified Billing）；非凭证错误返回 undefined。
 */
export function providerCredentialHttpStatus(value: unknown): 401 | 503 | undefined {
    if (!isProviderCredentialError(value)) {
        return undefined;
    }
    if (isUnifiedBillingProviderCredentialError(value)) {
        return 503;
    }
    return 401;
}
