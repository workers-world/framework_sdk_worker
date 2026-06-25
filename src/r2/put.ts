export interface R2PutOptions {
  contentType: string;
  customMetadata?: Record<string, string>;
}

export async function putBinary(
  bucket: R2Bucket,
  key: string,
  data: ArrayBuffer | ReadableStream | string,
  options: R2PutOptions,
): Promise<string> {
  await bucket.put(key, data, {
    httpMetadata: { contentType: options.contentType },
    customMetadata: options.customMetadata,
  });
  return key;
}

export async function putJson(
  bucket: R2Bucket,
  key: string,
  data: unknown,
  customMetadata?: Record<string, string>,
): Promise<string> {
  await bucket.put(key, JSON.stringify(data), {
    httpMetadata: { contentType: 'application/json' },
    customMetadata,
  });
  return key;
}
