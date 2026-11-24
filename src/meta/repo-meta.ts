/**
 * 仓库身份声明契约（.ww-repo.json）。
 *
 * 字段分两类：
 * - 人工声明：type（身份枚举）、npm（发布名覆盖）——人工维护；
 * - 管道派生：deps（工作区内依赖的仓名）——由 `ww wt deps --sync` 从源数据
 *   （package.json 依赖、wrangler.toml services、workflow uses）扫描生成，
 *   人工勿手改；即 源数据 + 管道 = meta json。
 *
 * 每个仓库根目录放一份 `.ww-repo.json`；消费方（ww wt bump-sdk / ww wt deps、
 * deploy-tracker catalog、未来 agent 工具）按此发现与分类，不再用目录名前缀或
 * 仓单硬编码。声明保持纯 JSON（静态可读：cat / grep / Contents API 均可，非 TS
 * 项目零适配）；本模块提供 schema 权威与解析校验，随 SDK 发版演进。
 *
 * 业务 worker 接入方式（SDK ≥ 含本模块的版本）：在测试里断言自己的声明合法——
 *   import { parseRepoMeta, REPO_META_FILENAME } from 'framework_sdk_worker/meta/repo-meta';
 *   import { readFileSync } from 'node:fs';
 *   it('repo meta 有效', () => {
 *     const meta = parseRepoMeta(readFileSync(REPO_META_FILENAME, 'utf8'));
 *     if (!meta.ok) throw new Error(meta.reason);
 *     expect(meta.meta?.type).toBe('worker');
 *   });
 */

/** 仓库身份声明文件名（仓库根，随仓提交） */
export const REPO_META_FILENAME = '.ww-repo.json';

/** 仓库类型枚举（与 deploy-tracker catalog kind 对齐：worker ↔ cf_worker） */
export const REPO_META_TYPES = ['worker', 'sdk', 'action', 'app', 'tool'] as const;

export type RepoMetaType = (typeof REPO_META_TYPES)[number];

export interface RepoMeta {
    type: RepoMetaType;
    /** 发布名（仅 SDK 等需要发布到 GitHub Packages 的仓）；缺省按 org 惯例 `@workers-world/<目录名>` */
    npm?: string;
    /**
     * 工作区内依赖的仓库名（扁平有序列表，去重）。派生字段：由 `ww wt deps --sync` 管道
     * 从源数据（package.json 依赖 / wrangler.toml services / workflow uses）扫描生成，
     * 人工勿维护；人工只声明 type / npm。
     */
    deps?: string[];
}

export type RepoMetaParseResult = { ok: true; meta: RepoMeta } | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 工作区仓名约束（deps 引用的目标身份） */
const REPO_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/i;

function parseDeps(value: unknown): { ok: true; deps?: string[] } | { ok: false; reason: string } {
    if (value === undefined) {
        return { ok: true };
    }
    if (!Array.isArray(value) || value.some((d) => typeof d !== 'string' || d.trim() === '')) {
        return { ok: false, reason: `${REPO_META_FILENAME} deps 须为 string[]（工作区仓名）` };
    }
    const deps = value.map((d) => (d as string).trim());
    for (const dep of deps) {
        if (!REPO_NAME_RE.test(dep)) {
            return { ok: false, reason: `${REPO_META_FILENAME} deps 含非法仓名: ${dep}` };
        }
    }
    if (new Set(deps).size !== deps.length) {
        return { ok: false, reason: `${REPO_META_FILENAME} deps 有重复项（派生字段应去重）` };
    }
    return { ok: true, deps };
}

/**
 * 解析并校验 .ww-repo.json 文本。
 * 非法（JSON 坏 / type 缺失或不在枚举 / 字段类型错）→ { ok: false, reason }，调用方自行决定失败或降级。
 */
export function parseRepoMeta(raw: string): RepoMetaParseResult {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, reason: `${REPO_META_FILENAME} 不是合法 JSON: ${msg}` };
    }
    if (!isRecord(parsed)) {
        return { ok: false, reason: `${REPO_META_FILENAME} 须为对象` };
    }
    const type = parsed.type;
    if (typeof type !== 'string' || !(REPO_META_TYPES as readonly string[]).includes(type)) {
        return {
            ok: false,
            reason: `${REPO_META_FILENAME} type 须为 ${REPO_META_TYPES.join('|')}，当前: ${String(type)}`,
        };
    }
    const npm = parsed.npm;
    if (npm !== undefined && (typeof npm !== 'string' || npm.trim() === '')) {
        return { ok: false, reason: `${REPO_META_FILENAME} npm 须为非空字符串` };
    }
    const depsResult = parseDeps(parsed.deps);
    if (!depsResult.ok) {
        return depsResult;
    }
    const meta: RepoMeta = {
        type: type as RepoMetaType,
        ...(npm === undefined ? {} : { npm: npm.trim() }),
        ...(depsResult.deps === undefined ? {} : { deps: depsResult.deps }),
    };
    return { ok: true, meta };
}
