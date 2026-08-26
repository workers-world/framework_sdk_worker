import { vi } from 'vitest';

function dnsJsonResponse(addresses: string[], recordType: 1 | 28): Response {
    return new Response(
        JSON.stringify({
            Status: 0,
            Answer: addresses.map((data) => ({
                name: 'example.com',
                type: recordType,
                TTL: 60,
                data,
            })),
        }),
        { headers: { 'content-type': 'application/dns-json' } },
    );
}

/** fetch mock：自动应答 cloudflare-dns.com DoH，其余请求返回 pageResponse */
export function createFetchImplWithDns(
    pageResponse: Response,
    dnsAddresses: { ipv4?: string[]; ipv6?: string[] } = {
        ipv4: ['93.184.216.34'],
    },
): ReturnType<typeof vi.fn> {
    return vi.fn((input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('cloudflare-dns.com/dns-query')) {
            const parsed = new URL(url);
            const type = parsed.searchParams.get('type');
            if (type === '1') {
                return Promise.resolve(dnsJsonResponse(dnsAddresses.ipv4 ?? [], 1));
            }
            if (type === '28') {
                return Promise.resolve(dnsJsonResponse(dnsAddresses.ipv6 ?? [], 28));
            }
            return Promise.resolve(new Response(JSON.stringify({ Status: 0 }), { status: 200 }));
        }
        return Promise.resolve(pageResponse);
    });
}

export function dnsJsonResponseForType(addresses: string[], recordType: 1 | 28): Response {
    return dnsJsonResponse(addresses, recordType);
}
