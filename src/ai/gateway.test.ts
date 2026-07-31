import {describe, expect, it, vi} from 'vitest';
import {
    aiGatewayRunOptions,
    callAiModel,
    inputsUseChatMessages,
    inputsUseReadableStream,
    shouldUseAiGateway,
} from './gateway.js';

describe('inputsUseReadableStream', () => {
    it('detects multipart body stream', () => {
        const stream = new ReadableStream();
        expect(inputsUseReadableStream({
            multipart: {body: stream, contentType: 'multipart/form-data; boundary=x'},
        })).toBe(true);
    });

    it('returns false for plain JSON inputs', () => {
        expect(inputsUseReadableStream({prompt: 'hello', width: 1024})).toBe(false);
    });
});

describe('inputsUseChatMessages', () => {
    it('returns true for non-empty messages array', () => {
        expect(inputsUseChatMessages({
            messages: [{role: 'user', content: 'hi'}],
        })).toBe(true);
    });

    it('returns false for empty or missing messages', () => {
        expect(inputsUseChatMessages({messages: []})).toBe(false);
        expect(inputsUseChatMessages({prompt: 'cat'})).toBe(false);
    });
});

describe('shouldUseAiGateway', () => {
    it('uses gateway for @cf chat inputs with messages', () => {
        const inputs = {messages: [{role: 'user', content: 'hi'}]};
        expect(shouldUseAiGateway('@cf/meta/llama-4-scout-17b-16e-instruct', inputs)).toBe(true);
        expect(shouldUseAiGateway('@cf/zai-org/glm-4.7-flash', inputs)).toBe(true);
    });

    it('skips gateway for @cf image prompt inputs', () => {
        expect(shouldUseAiGateway('@cf/stabilityai/stable-diffusion-xl-base-1.0', {prompt: 'cat'})).toBe(false);
    });

    it('skips gateway for stream inputs even with messages', () => {
        const stream = new ReadableStream();
        expect(shouldUseAiGateway('@cf/meta/llama-4-scout-17b-16e-instruct', {
            messages: [{role: 'user', content: 'hi'}],
            multipart: {body: stream, contentType: 'multipart/form-data; boundary=x'},
        })).toBe(false);
    });
});

describe('callAiModel', () => {
    it('skips gateway for stream inputs', async () => {
        const stream = new ReadableStream();
        const ai = {
            run: vi.fn().mockResolvedValue({image: 'abc'}),
        } as unknown as Ai;

        await callAiModel(ai, '@cf/black-forest-labs/flux-2-klein-4b', {
            multipart: {body: stream, contentType: 'multipart/form-data; boundary=x'},
        });

        expect(ai.run).toHaveBeenCalledWith(
            '@cf/black-forest-labs/flux-2-klein-4b',
            expect.any(Object),
            {},
        );
    });

    it('uses gateway for pruna JSON inputs', async () => {
        const ai = {
            run: vi.fn().mockResolvedValue({image: 'abc'}),
        } as unknown as Ai;

        await callAiModel(ai, 'pruna/p-image', {prompt: 'cat'});

        expect(ai.run).toHaveBeenCalledWith(
            'pruna/p-image',
            {prompt: 'cat'},
            aiGatewayRunOptions(undefined),
        );
    });

    it('skips gateway for @cf JSON image inputs that return binary', async () => {
        const ai = {
            run: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
        } as unknown as Ai;

        await callAiModel(ai, '@cf/stabilityai/stable-diffusion-xl-base-1.0', {prompt: 'cat'});

        expect(ai.run).toHaveBeenCalledWith(
            '@cf/stabilityai/stable-diffusion-xl-base-1.0',
            {prompt: 'cat'},
            {},
        );
    });

    it('uses gateway for @cf chat inputs with messages', async () => {
        const ai = {
            run: vi.fn().mockResolvedValue({response: 'hello'}),
        } as unknown as Ai;
        const inputs = {messages: [{role: 'user', content: 'hi'}]};

        await callAiModel(ai, '@cf/google/gemma-4-26b-a4b-it', inputs);

        expect(ai.run).toHaveBeenCalledWith(
            '@cf/google/gemma-4-26b-a4b-it',
            inputs,
            aiGatewayRunOptions(undefined),
        );
    });
});
