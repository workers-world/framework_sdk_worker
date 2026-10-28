import { cursorUsageAdapter } from './providers/cursor.js';
import { opencodeGoAdapter } from './providers/opencode-go.js';
import { workersAiGatewayAdapter } from './providers/workers-ai-gateway.js';
import { clearProviderAdaptersForTest, registerProviderAdapter } from './registry.js';

let installed = false;

export function ensureDefaultProviderAdapters(): void {
    if (installed) {
        return;
    }
    registerProviderAdapter(workersAiGatewayAdapter);
    registerProviderAdapter(opencodeGoAdapter);
    registerProviderAdapter(cursorUsageAdapter);
    installed = true;
}

/** 测试用：清空并允许重新 install */
export function resetDefaultProviderAdaptersForTest(): void {
    clearProviderAdaptersForTest();
    installed = false;
}
