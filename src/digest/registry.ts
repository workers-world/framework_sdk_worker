/**
 * DigestDefinition 注册表辅助。
 */
import type { DigestDefinition } from './types.js';

export function getDigestDefinitionByCron<TEnv>(
    cron: string,
    definitions: DigestDefinition<TEnv>[],
): DigestDefinition<TEnv> | undefined {
    return definitions.find((d) => d.cron === cron);
}

export function getDigestDefinitionById<TEnv>(
    id: string,
    definitions: DigestDefinition<TEnv>[],
): DigestDefinition<TEnv> | undefined {
    return definitions.find((d) => d.id === id);
}
