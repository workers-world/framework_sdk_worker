import { describe, expect, it } from 'vitest';
import {
    isProviderCredentialError,
    isUnifiedBillingProviderCredentialError,
    PROVIDER_CREDENTIAL_INVALID,
    providerCredentialHttpStatus,
} from '../../src/ai/provider-credential.js';

describe('provider-credential', () => {
    it('detects internalCode 2009', () => {
        expect(isProviderCredentialError({ internalCode: 2009, message: 'rejected' })).toBe(true);
        expect(providerCredentialHttpStatus({ internalCode: 2009 })).toBe(401);
    });

    it('detects HTTP 401 + code 2009 message', () => {
        const err = {
            status: 401,
            message: 'AI Gateway error 2009: provider credentials rejected',
        };
        expect(isProviderCredentialError(err)).toBe(true);
        expect(providerCredentialHttpStatus(err)).toBe(401);
        expect(isUnifiedBillingProviderCredentialError(err)).toBe(false);
    });

    it('detects gateway stable code PROVIDER_CREDENTIAL_INVALID', () => {
        expect(
            isProviderCredentialError({
                status: 401,
                error: PROVIDER_CREDENTIAL_INVALID,
                message: PROVIDER_CREDENTIAL_INVALID,
            }),
        ).toBe(true);
    });

    it('detects legacy ElevenLabs UserCredentialsError 403', () => {
        const err = {
            status: 403,
            name: 'UserCredentialsError',
            message: 'UserCredentialsError: invalid api key',
        };
        expect(isProviderCredentialError(err)).toBe(true);
        expect(providerCredentialHttpStatus(err)).toBe(401);
    });

    it('detects legacy 402 + credential context', () => {
        expect(
            isProviderCredentialError({
                status: 402,
                message: 'Payment Required: invalid BYOK credentials',
            }),
        ).toBe(true);
    });

    it('detects Unified Billing 503 credential rejection', () => {
        const err = {
            status: 503,
            message: '2009: provider credentials rejected under Unified Billing',
        };
        expect(isProviderCredentialError(err)).toBe(true);
        expect(isUnifiedBillingProviderCredentialError(err)).toBe(true);
        expect(providerCredentialHttpStatus(err)).toBe(503);
    });

    it('does not treat bare 401 without credential context', () => {
        expect(isProviderCredentialError({ status: 401, message: 'Unauthorized' })).toBe(false);
        expect(providerCredentialHttpStatus({ status: 401, message: 'Unauthorized' })).toBe(
            undefined,
        );
    });

    it('does not treat CIRCUIT_OPEN 503 as credential', () => {
        expect(
            isProviderCredentialError({
                status: 503,
                message: 'CIRCUIT_OPEN',
                error: 'CIRCUIT_OPEN',
            }),
        ).toBe(false);
    });

    it('does not treat bare 402 without credential context', () => {
        expect(isProviderCredentialError({ status: 402, message: 'Payment Required' })).toBe(false);
    });
});
