export function jsonError(message: string, status = 400): Response {
    return new Response(JSON.stringify({error: message}), {
        status,
        headers: {'Content-Type': 'application/json; charset=utf-8'},
    });
}

export function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {'Content-Type': 'application/json; charset=utf-8'},
    });
}
