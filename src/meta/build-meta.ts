/**
 * 组装 WorkerMetaResponse（纯函数，可单测）
 */
import {
    type MetaEnvLike,
    SDK_PACKAGE,
    SDK_VERSION,
    type WorkerMetaResponse,
    type WorkerVersionMetadataView,
} from './types.js';

function trimOrNull(v: string | undefined | null): string | null {
    const t = v?.trim();
    return t ? t : null;
}

export function readVersionMetadata(
    raw: MetaEnvLike['CF_VERSION_METADATA'],
): WorkerVersionMetadataView | null {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    const tag = typeof raw.tag === 'string' ? raw.tag.trim() : '';
    const timestamp = typeof raw.timestamp === 'string' ? raw.timestamp.trim() : '';
    if (!id && !tag && !timestamp) {
        return null;
    }
    return {id, tag, timestamp};
}

export function buildWorkerMeta(
    workerName: string,
    env: MetaEnvLike,
    sdkVersion: string = SDK_VERSION,
): WorkerMetaResponse {
    return {
        worker: workerName,
        sdk: {
            package: SDK_PACKAGE,
            version: sdkVersion,
        },
        build: {
            commit: trimOrNull(env.BUILD_COMMIT_SHA),
            branch: trimOrNull(env.BUILD_BRANCH),
            time: trimOrNull(env.BUILD_TIME),
        },
        versionMetadata: readVersionMetadata(env.CF_VERSION_METADATA),
    };
}
