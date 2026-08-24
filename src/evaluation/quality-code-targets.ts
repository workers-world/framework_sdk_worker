/**
 * Quality Analyze 代码锚点：service × layer → 文件路径；service → GitHub repo。
 */
import type { QualityDiagnosis } from './quality-incident.js';

export type QualitySuspectedLayer = QualityDiagnosis['suspectedLayer'];

export interface QualityWorkerRepoMapping {
    owner: string;
    repo: string;
}

export interface QualityCodeAnchorsRegistry {
    services: Record<
        string,
        {
            github: QualityWorkerRepoMapping;
            layers: Partial<Record<QualitySuspectedLayer, string[]>>;
        }
    >;
}

/** workers-world GitHub URL（Cursor Cloud Agents API 可用） */
export function resolveWorkerRepoUrl(
    service: string,
    registry: QualityCodeAnchorsRegistry,
): string | undefined {
    const entry = registry.services[service];
    if (!entry) {
        return undefined;
    }
    const { owner, repo } = entry.github;
    return `https://github.com/${owner}/${repo}`;
}

/** 按 service + layer 解析锚点文件路径 */
export function resolveCodeAnchorPaths(
    service: string,
    layer: QualitySuspectedLayer,
    registry: QualityCodeAnchorsRegistry,
): string[] {
    const entry = registry.services[service];
    if (!entry) {
        return [];
    }
    const paths = entry.layers[layer] ?? entry.layers.unknown ?? [];
    return [...paths];
}

/** 从 incident fields.chain / path 推断初步 layer */
export function inferSuspectedLayerFromIncident(
    fields: Record<string, string | number | boolean>,
): QualitySuspectedLayer {
    const chain = String(fields.chain ?? '');
    const path = String(fields.path ?? '');
    if (/fetch|browser|article_fetch/i.test(chain) || /fetch/i.test(path)) {
        return 'fetch';
    }
    if (/summarize|summary|title_only|llm/i.test(chain) || /summarize|title_only/i.test(path)) {
        return 'summarize';
    }
    if (/notify/i.test(chain)) {
        return 'notify';
    }
    if (/url|heuristic|product_landing|bypass/i.test(chain)) {
        return 'url_heuristic';
    }
    if (/llm|gateway/i.test(chain)) {
        return 'llm';
    }
    return 'unknown';
}

export function githubBlobUrl(repoUrl: string, filePath: string, ref = 'master'): string {
    const base = repoUrl.replace(/\/$/, '');
    return `${base}/blob/${ref}/${filePath.replace(/^\//, '')}`;
}
