/**
 * Worker 运行时自述（方案 B）：SDK 版本 + 构建信息 + 可选 CF Version Metadata。
 * 不含 env/secret 值；不替代 CF Scripts inventory / settings hash。
 */

export const SDK_PACKAGE = '@workers-world/framework_sdk_worker';

/** 与 package.json version 同步；发版时一并 bump */
export const SDK_VERSION = '0.2.10';

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
