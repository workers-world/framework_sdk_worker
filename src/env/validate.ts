import { resolveSecret, type SecretLike } from '../secrets/resolve.js';

export type EnvMode = 'dev' | 'prod';

export type EnvRule = {
    /** env 字段名 */
    key: string;
    /** true=始终必填；prod=仅生产必填 */
    required?: boolean | 'prod';
    /** SecretLike 字段，用 resolveSecret 校验 */
    secret?: boolean;
};

export class EnvValidationError extends Error {
    constructor(
        message: string,
        readonly mode: EnvMode,
        readonly missing: string[],
    ) {
        super(message);
        this.name = 'EnvValidationError';
    }
}

type EnvLike = Record<string, unknown>;

function asEnvRecord(env: object): EnvLike {
    return env as EnvLike;
}

/** 从 ENVIRONMENT / ENV var 推断运行模式；默认 dev（本地 wrangler dev） */
export function getEnvMode(env: EnvLike): EnvMode {
    const raw = env.ENVIRONMENT ?? env.ENV;
    if (typeof raw !== 'string') {
        return 'dev';
    }
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'production' || normalized === 'prod') {
        return 'prod';
    }
    return 'dev';
}

function isEmptyValue(value: unknown): boolean {
    if (value == null) {
        return true;
    }
    if (typeof value === 'string') {
        return value.trim().length === 0;
    }
    return false;
}

async function isRuleMissing(env: EnvLike, rule: EnvRule): Promise<boolean> {
    const value = env[rule.key];
    if (rule.secret) {
        const resolved = await resolveSecret(value as SecretLike | undefined);
        return !resolved;
    }
    return isEmptyValue(value);
}

function isRuleRequired(rule: EnvRule, mode: EnvMode): boolean {
    if (rule.required === true) {
        return true;
    }
    if (rule.required === 'prod') {
        return mode === 'prod';
    }
    return false;
}

/** 校验 env；缺失必填项时 throw EnvValidationError */
export async function assertEnvAsync(
    env: object,
    rules: EnvRule[],
    options?: { mode?: EnvMode },
): Promise<void> {
    const record = asEnvRecord(env);
    const mode = options?.mode ?? getEnvMode(record);
    const missing: string[] = [];

    for (const rule of rules) {
        if (!isRuleRequired(rule, mode)) {
            continue;
        }
        if (await isRuleMissing(record, rule)) {
            missing.push(rule.key);
        }
    }

    if (missing.length > 0) {
        throw new EnvValidationError(
            `Missing required env (${mode}): ${missing.join(', ')}`,
            mode,
            missing,
        );
    }
}

const onceKeys = new Set<string>();

/** 同一 Worker isolate 内只校验一次（按 rules 签名） */
export async function assertEnvOnce(
    env: object,
    rules: EnvRule[],
    options?: { mode?: EnvMode },
): Promise<void> {
    const signature = rules.map((r) => `${r.key}:${r.required ?? ''}:${r.secret ?? ''}`).join('|');
    if (onceKeys.has(signature)) {
        return;
    }
    await assertEnvAsync(env, rules, options);
    onceKeys.add(signature);
}

/** dev 且无 RESEND_API_KEY 时走 console dryRun */
export function shouldResendDryRun(env: object, apiKey?: string): boolean {
    if (apiKey?.trim()) {
        return false;
    }
    return getEnvMode(asEnvRecord(env)) === 'dev';
}

export function logResendDryRun(payload: Record<string, unknown>): void {
    console.log('[notify dryRun]', JSON.stringify(payload));
}
