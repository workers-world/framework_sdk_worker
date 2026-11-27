import { describe, expect, it } from 'vitest';
import {
    DEV_TRACK_LABEL_ZH,
    FORBIDDEN_RELEASE_BASES,
    isDevTrackBase,
    isForbiddenPushTarget,
    isPureDevBranch,
    isVerifyBranch,
    looksLikeDevRef,
    PURE_DEV_BRANCH_BASH_RE,
    PURE_DEV_BRANCH_RE,
    pickDevRefFromEnv,
} from '../../src/git/dev-track.js';

describe('dev-track', () => {
    it('exposes Chinese label and forbidden bases', () => {
        expect(DEV_TRACK_LABEL_ZH).toBe('开发轨');
        expect(FORBIDDEN_RELEASE_BASES.has('master')).toBe(true);
        expect(FORBIDDEN_RELEASE_BASES.has('main')).toBe(true);
    });

    it('isVerifyBranch', () => {
        expect(isVerifyBranch('dev_00_01_00_pgreq20261028_verify')).toBe(true);
        expect(isVerifyBranch('dev_00_01_00')).toBe(false);
        expect(isVerifyBranch('dev___pgreq_verify')).toBe(true);
        expect(isVerifyBranch('dev__pgreq_verify')).toBe(false);
        expect(isVerifyBranch('dev_pgreq_verify')).toBe(false);
        expect(isVerifyBranch('dev_x_pgreq/y_verify')).toBe(false);
        expect(isVerifyBranch('DEV_00_01_00_PGREQ1_VERIFY')).toBe(true);
        expect(isVerifyBranch('dev__pgreq_pgreq_verify')).toBe(true);
        expect(isVerifyBranch('dev__pgreq_foo_pgreq_verify')).toBe(true);
    });

    it('isPureDevBranch accepts numeric three-segment only', () => {
        expect(isPureDevBranch('dev_00_02_00')).toBe(true);
        expect(isPureDevBranch('dev_0_1_2')).toBe(true);
        expect(isPureDevBranch('dev_00_17_00_pgreq251_verify')).toBe(false);
        expect(isPureDevBranch('dev_00_02_00_touch_id')).toBe(false);
        expect(isPureDevBranch('destin')).toBe(false);
        expect(isPureDevBranch(null)).toBe(false);
    });

    it('PURE_DEV_BRANCH_BASH_RE matches PURE_DEV_BRANCH_RE', () => {
        const bash = new RegExp(PURE_DEV_BRANCH_BASH_RE);
        for (const name of ['dev_00_02_00', 'dev_0_1_2', 'dev_12_34_56']) {
            expect(bash.test(name)).toBe(PURE_DEV_BRANCH_RE.test(name));
        }
        for (const name of ['dev_00_17_00_pgreq251_verify', 'dev_00_02_00_touch_id', 'destin']) {
            expect(bash.test(name)).toBe(false);
            expect(PURE_DEV_BRANCH_RE.test(name)).toBe(false);
        }
    });

    it('looksLikeDevRef rejects destin alias and master', () => {
        expect(looksLikeDevRef('dev_00_08_00')).toBe(true);
        expect(looksLikeDevRef('dev_00_02_00_touch_id')).toBe(true);
        expect(looksLikeDevRef('destin')).toBe(false);
        expect(looksLikeDevRef('destin_00_01_00')).toBe(false);
        expect(looksLikeDevRef('master')).toBe(false);
        expect(looksLikeDevRef('dev_00_01_00_pgreq_x_verify')).toBe(false);
        expect(isDevTrackBase('dev_00_01_00')).toBe(true);
    });

    it('isForbiddenPushTarget', () => {
        expect(isForbiddenPushTarget('dev_00_01_00', 'dev_00_01_00')).toBe(true);
        expect(isForbiddenPushTarget('master', 'dev_00_01_00')).toBe(true);
        expect(isForbiddenPushTarget('dev_00_01_00_pgreq1_verify', 'dev_00_01_00')).toBe(true);
        expect(isForbiddenPushTarget('cod1/abc', 'dev_00_01_00')).toBe(false);
    });

    it('pickDevRefFromEnv reads new keys only; never invents a branch', () => {
        expect(pickDevRefFromEnv({ SCH_DEV_DEFAULT: 'dev_00_19_00' })).toBe('dev_00_19_00');
        expect(pickDevRefFromEnv({ SCH_DESTIN_DEFAULT: 'dev_00_18_00' })).toBe('');
        expect(pickDevRefFromEnv({})).toBe('');
        expect(
            pickDevRefFromEnv({
                SCH_DEV_DEFAULT: 'dev_00_20_00',
                SCH_DESTIN_DEFAULT: 'dev_00_01_00',
            }),
        ).toBe('dev_00_20_00');
    });
});
