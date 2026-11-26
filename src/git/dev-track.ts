/**
 * Org development-track (`dev_*`) branch helpers.
 *
 * SSOT for “当前开发轨 / 纯开发轨 Release”判定。禁止再造 `destin` 别名。
 * 人读文案用 {@link DEV_TRACK_LABEL_ZH}（「开发轨」），代码标识用 `devRef`。
 */

/** Protected release bases — never use as feature PR base or coding push target. */
export const FORBIDDEN_RELEASE_BASES = new Set(['master', 'main']);

/**
 * Pure release-track: `dev_X_Y_Z` numeric segments only (no suffix / verify / theme).
 * Used by worker-ci / ensure-release-pr (`pure-dev-gate`).
 */
export const PURE_DEV_BRANCH_RE = /^dev_[0-9]+_[0-9]+_[0-9]+$/;

/** Bash `=~` pattern — keep in sync with {@link PURE_DEV_BRANCH_RE}. */
export const PURE_DEV_BRANCH_BASH_RE = '^dev_[0-9]+_[0-9]+_[0-9]+$';

/**
 * Any development-track ref starting with `dev_NN_NN_NN` (may have theme suffix).
 * Verify branches are excluded by {@link looksLikeDevRef}.
 */
export const DEV_TRACK_PREFIX_RE = /^dev_\d{2}_\d{2}_\d{2}/;

/** Chinese label for Agent prompts / Admin copy. */
export const DEV_TRACK_LABEL_ZH = '开发轨';

/** cod1 Outbound / sandbox header: PR base = current development track. */
export const COD1_DEV_REF_HEADER = 'X-Cod1-Dev-Ref';

/** Env-style keys (consumers may dual-read legacy `*_DESTIN_*` during migrate). */
export const DEV_REF_ENV_KEYS = ['SCH_COD1_DEV_REF', 'SCH_DEV_DEFAULT', 'COD_DEV_DEFAULT'] as const;

/**
 * `dev_*_pgreq*_verify` style verify branches — never push / never treat as track.
 * Linear-time (avoid nested quantifier ReDoS).
 */
export function isVerifyBranch(branch: string): boolean {
    const b = branch.trim();
    if (!b || b.includes('/')) {
        return false;
    }
    const lower = b.toLowerCase();
    if (!lower.startsWith('dev_') || !lower.endsWith('_verify')) {
        return false;
    }
    const core = lower.slice('dev_'.length, -'_verify'.length);
    const marker = '_pgreq';
    const idx = core.lastIndexOf(marker);
    return idx >= 1;
}

/** Pure `dev_X_Y_Z` — Release→master track only. */
export function isPureDevBranch(name: string | null | undefined): boolean {
    return typeof name === 'string' && PURE_DEV_BRANCH_RE.test(name);
}

/**
 * Allowlist for “current development track” PR base:
 * `dev_NN_NN_NN` (+ optional theme suffix), not verify, not master/main.
 */
export function looksLikeDevRef(ref: string): boolean {
    const r = ref.trim();
    if (!r || FORBIDDEN_RELEASE_BASES.has(r.toLowerCase())) {
        return false;
    }
    if (isVerifyBranch(r)) {
        return false;
    }
    return DEV_TRACK_PREFIX_RE.test(r);
}

/** Alias used by planning / tracker when checking PR base. */
export function isDevTrackBase(ref: string): boolean {
    return looksLikeDevRef(ref);
}

export function isForbiddenPushTarget(branch: string, devRef: string): boolean {
    const b = branch.trim();
    if (!b) {
        return true;
    }
    if (FORBIDDEN_RELEASE_BASES.has(b.toLowerCase())) {
        return true;
    }
    if (isVerifyBranch(b)) {
        return true;
    }
    if (b === devRef.trim()) {
        return true;
    }
    return false;
}

/**
 * Pick first non-empty env among {@link DEV_REF_ENV_KEYS} (+ optional legacy destin keys).
 * Never invents a fake branch name like `destin`.
 */
export function pickDevRefFromEnv(
    env: Record<string, string | undefined> | { [key: string]: string | undefined },
    legacyKeys: readonly string[] = [
        'SCH_COD1_DESTIN_REF',
        'SCH_DESTIN_DEFAULT',
        'COD_DESTIN_DEFAULT',
    ],
): string {
    for (const key of DEV_REF_ENV_KEYS) {
        const v = env[key]?.trim();
        if (v) {
            return v;
        }
    }
    for (const key of legacyKeys) {
        const v = env[key]?.trim();
        if (v) {
            return v;
        }
    }
    return '';
}
