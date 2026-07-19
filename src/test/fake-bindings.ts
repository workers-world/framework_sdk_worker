export function makeFakeFetcher(
  handler?: (
    url: string | URL | Request,
    init?: RequestInit,
  ) => Response | Promise<Response>,
): Fetcher {
  const fallback = () => new Response('Not Found', { status: 404 });
  const resolve = handler ?? fallback;

  return {
    fetch(input: string | URL | Request, init?: RequestInit) {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      return Promise.resolve(resolve(url, init));
    },
  } as Fetcher;
}

export function makeFakeQueue<T>(): { send: (body: T) => Promise<void>; sent: T[] } {
  const sent: T[] = [];
  return {
    sent,
    send: async (body: T) => {
      sent.push(body);
    },
  };
}

export function makeFakeKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
  } as unknown as KVNamespace;
}
