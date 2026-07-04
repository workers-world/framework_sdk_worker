import { describe, expect, it, vi } from 'vitest';
import {
  aiGatewayRunOptions,
  inputsUseReadableStream,
  runAiModel,
} from './gateway.js';

describe('inputsUseReadableStream', () => {
  it('detects multipart body stream', () => {
    const stream = new ReadableStream();
    expect(inputsUseReadableStream({
      multipart: { body: stream, contentType: 'multipart/form-data; boundary=x' },
    })).toBe(true);
  });

  it('returns false for plain JSON inputs', () => {
    expect(inputsUseReadableStream({ prompt: 'hello', width: 1024 })).toBe(false);
  });
});

describe('runAiModel', () => {
  it('skips gateway for stream inputs', async () => {
    const stream = new ReadableStream();
    const ai = {
      run: vi.fn().mockResolvedValue({ image: 'abc' }),
    } as unknown as Ai;

    await runAiModel(ai, '@cf/black-forest-labs/flux-2-klein-4b', {
      multipart: { body: stream, contentType: 'multipart/form-data; boundary=x' },
    });

    expect(ai.run).toHaveBeenCalledWith(
      '@cf/black-forest-labs/flux-2-klein-4b',
      expect.any(Object),
      {},
    );
  });

  it('uses gateway for JSON inputs', async () => {
    const ai = {
      run: vi.fn().mockResolvedValue({ image: 'abc' }),
    } as unknown as Ai;

    await runAiModel(ai, 'pruna/p-image', { prompt: 'cat' });

    expect(ai.run).toHaveBeenCalledWith(
      'pruna/p-image',
      { prompt: 'cat' },
      aiGatewayRunOptions(undefined),
    );
  });

  it('skips gateway for @cf JSON image inputs that return binary', async () => {
    const ai = {
      run: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    } as unknown as Ai;

    await runAiModel(ai, '@cf/stabilityai/stable-diffusion-xl-base-1.0', { prompt: 'cat' });

    expect(ai.run).toHaveBeenCalledWith(
      '@cf/stabilityai/stable-diffusion-xl-base-1.0',
      { prompt: 'cat' },
      {},
    );
  });
});
