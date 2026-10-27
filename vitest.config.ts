import {defineConfig} from 'vitest/config';

export default defineConfig({
    // 与 tsup define 对齐：SDK_VERSION 测试环境取 '0.0.0-test'
    define: {
        __SDK_VERSION__: JSON.stringify('0.0.0-test'),
    },
    test: {
        include: ['test/**/*.test.ts'],
        passWithNoTests: true,
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: ['test/**'],
            thresholds: {lines: 70, functions: 75, branches: 85},
        },
    },
});
