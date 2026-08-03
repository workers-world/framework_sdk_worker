import {defineConfig} from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/**/*.test.ts'],
        passWithNoTests: true,
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: ['test/**'],
            thresholds: {lines: 30, functions: 25, branches: 20},
        },
    },
});
