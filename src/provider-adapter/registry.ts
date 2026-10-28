import type { ProviderAdapter, ProviderAdapterId } from './types.js';

const REGISTRY = new Map<string, ProviderAdapter>();

export function registerProviderAdapter(adapter: ProviderAdapter): void {
    REGISTRY.set(adapter.id, adapter);
}

export function getProviderAdapter(id: ProviderAdapterId): ProviderAdapter {
    const adapter = REGISTRY.get(id);
    if (!adapter) {
        throw new Error(`provider adapter not registered: ${id}`);
    }
    return adapter;
}

export function tryGetProviderAdapter(id: ProviderAdapterId): ProviderAdapter | undefined {
    return REGISTRY.get(id);
}

export function listProviderAdapterIds(): ProviderAdapterId[] {
    return [...REGISTRY.keys()];
}

/** 测试用：清空注册表 */
export function clearProviderAdaptersForTest(): void {
    REGISTRY.clear();
}
