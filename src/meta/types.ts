/**
 * Worker 运行时自述（方案 B）：SDK 版本 + 构建信息 + 可选 CF Version Metadata。
 * 不含 env/secret 值；不替代 CF Scripts inventory / settings hash。
 */

export const SDK_PACKAGE = '@workers-world/framework_sdk_worker';

/**
 * 构建时由 tsup define 注入 package.json version（src/meta/globals.d.ts 声明）。
 * 曾为人工同步字面量，多次漂移（0.2.10 vs 实际 0.3.2）后改为单一版本源；
 * typeof 守卫兜底未注入 define 的环境（如直接 ts-node / 无配置 vitest）。
 */
export const SDK_VERSION: string =
    typeof __SDK_VERSION__ !== 'undefined' ? __SDK_VERSION__ : '0.0.0-dev';

export interface WorkerVersionMetadataView {
    id: string;
    tag: string;
    timestamp: string;
}

export interface WorkerMetaBuildInfo {
    commit: string | null;
    branch: string | null;
    time: string | null;
}

export interface WorkerMetaResponse {
    worker: string;
    sdk: {
        package: typeof SDK_PACKAGE;
        version: string;
    };
    build: WorkerMetaBuildInfo;
    versionMetadata?: WorkerVersionMetadataView | null;
}

/** 从 Env 读取构建 vars / CF version_metadata binding 的宽松形状 */
export interface MetaEnvLike {
    BUILD_COMMIT_SHA?: string;
    BUILD_BRANCH?: string;
    BUILD_TIME?: string;
    /** wrangler [version_metadata] binding */
    CF_VERSION_METADATA?: {
        id?: string;
        tag?: string;
        timestamp?: string;
    };
}

export interface RegisterMetaRouteOptions {
    /** wrangler name / script id */
    workerName: string;
    /** Bearer env 字段名，默认 RULES_ADMIN_TOKEN */
    authEnvKey?: string;
    /** 覆盖 SDK 版本（测试用）；默认 SDK_VERSION */
    sdkVersion?: string;
}
