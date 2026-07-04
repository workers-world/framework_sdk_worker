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
});
