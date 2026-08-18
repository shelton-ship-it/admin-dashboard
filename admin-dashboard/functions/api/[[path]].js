// functions/api/[[path]].js
// ─────────────────────────────────────────────────────────────────────────────
// Proxy autenticado do dashboard admin (admin.pixgo.qzz.io) para a API real
// (api.pixgo.qzz.io). Corre como Cloudflare Pages Function (edge, por request).
//
// Fluxo:
//   1. Browser manda x-dashboard-key (a mesma ADMIN_API_KEY_MASTER que já
//      protege a API) em todo pedido a /api/*.
//   2. Esta função valida essa key contra env.ADMIN_API_KEY_MASTER /
//      env.ADMIN_API_KEY_BACKUP.
//   3. Se válida, reencaminha para ${API_BASE_URL}/api/admin/<path> com
//      x-api-key definido aqui — a key nunca é exposta no bundle do frontend,
//      só passa pela rede uma vez (login) e fica em sessionStorage no browser.
//
// Variáveis de ambiente a configurar no Cloudflare Pages (Settings → env vars):
//   ADMIN_API_KEY_MASTER   — obrigatória, igual à do backend EdgeOne
//   ADMIN_API_KEY_BACKUP   — opcional, igual à do backend EdgeOne
//   API_BASE_URL           — opcional, default https://api.pixgo.qzz.io
// ─────────────────────────────────────────────────────────────────────────────

function timingSafeEqualStr(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

export async function onRequest(context) {
    const { request, env, params } = context;

    const dashboardKey = request.headers.get('x-dashboard-key') || '';
    const master = env.ADMIN_API_KEY_MASTER || '';
    const backup = env.ADMIN_API_KEY_BACKUP || '';

    if (!master) {
        return new Response(JSON.stringify({
            error: 'Server Misconfigured',
            message: 'ADMIN_API_KEY_MASTER não configurada nas env vars do Cloudflare Pages.',
        }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const valid = timingSafeEqualStr(dashboardKey, master) ||
                  (backup && timingSafeEqualStr(dashboardKey, backup));

    if (!valid) {
        return new Response(JSON.stringify({
            error: 'Unauthorized',
            message: 'Admin key inválida.',
        }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    const apiBase = (env.API_BASE_URL || 'https://api.pixgo.qzz.io').replace(/\/$/, '');
    const pathParts = Array.isArray(params.path) ? params.path : [params.path];
    const restPath = pathParts.filter(Boolean).join('/');

    const incomingUrl = new URL(request.url);
    const targetUrl = `${apiBase}/api/admin/${restPath}${incomingUrl.search}`;

    const init = {
        method: request.method,
        headers: {
            'Content-Type': request.headers.get('Content-Type') || 'application/json',
            'x-api-key': dashboardKey,
        },
    };

    if (!['GET', 'HEAD'].includes(request.method)) {
        init.body = await request.text();
    }

    try {
        const upstream = await fetch(targetUrl, init);
        const body = await upstream.text();
        return new Response(body, {
            status: upstream.status,
            headers: { 'Content-Type': upstream.headers.get('Content-Type') || 'application/json' },
        });
    } catch (err) {
        return new Response(JSON.stringify({
            error: 'Bad Gateway',
            message: `Falha ao contactar a API: ${err.message}`,
        }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }
}
