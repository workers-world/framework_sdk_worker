import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    buildBuildMetaWranglerArgs,
    parseDeployCliArgs,
    resolveDeployRuntime,
} from '../scripts/deploy-worker-cli.mjs';

describe('deploy-worker-cli', () => {
    it('resolveDeployRuntime respects WORKERS_DEPLOY_RUNTIME', () => {
        expect(resolveDeployRuntime('/tmp', { WORKERS_DEPLOY_RUNTIME: 'cf' })).toBe('cf');
        expect(resolveDeployRuntime('/tmp', { WORKERS_DEPLOY_RUNTIME: 'wrangler' })).toBe(
            'wrangler',
        );
    });

    it('resolveDeployRuntime uses cloudflare.config.ts for auto cf', () => {
        const dir = mkdtempSync(path.join(os.tmpdir(), 'ww-deploy-'));
        writeFileSync(path.join(dir, 'cloudflare.config.ts'), 'export default {};\n');
        expect(resolveDeployRuntime(dir, {})).toBe('cf');
        expect(resolveDeployRuntime(dir, { WORKERS_DEPLOY_RUNTIME: 'auto' })).toBe('cf');
    });

    it('resolveDeployRuntime defaults to wrangler without config', () => {
        const dir = mkdtempSync(path.join(os.tmpdir(), 'ww-deploy-'));
        expect(resolveDeployRuntime(dir, {})).toBe('wrangler');
    });

    it('buildBuildMetaWranglerArgs maps WORKERS_CI_*', () => {
        const args = buildBuildMetaWranglerArgs({
            WORKERS_CI_COMMIT_SHA: ' abc ',
            WORKERS_CI_BRANCH: 'dev_00_02_00',
            BUILD_TIME: '2026-09-30T04:00:00Z',
        });
        expect(args).toEqual([
            '--var',
            'BUILD_COMMIT_SHA:abc',
            '--var',
            'BUILD_BRANCH:dev_00_02_00',
            '--var',
            'BUILD_TIME:2026-09-30T04:00:00Z',
        ]);
    });

    it('parseDeployCliArgs handles --build-meta and passthrough', () => {
        expect(parseDeployCliArgs(['--build-meta', '--dry-run'])).toEqual({
            buildMeta: true,
            passthrough: ['--dry-run'],
        });
        expect(parseDeployCliArgs(['--', '--containers-rollout=none'])).toEqual({
            buildMeta: false,
            passthrough: ['--containers-rollout=none'],
        });
    });
});
