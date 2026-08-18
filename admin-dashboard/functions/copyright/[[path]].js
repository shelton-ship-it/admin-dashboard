// functions/copyright/[[path]].js
// ─────────────────────────────────────────────────────────────────────────────
// Proxy autenticado para o copyright-worker.js (copyright.pixgo.qzz.io) — a
// fonte real de uploads pendentes, denúncias e suporte. Mesmo padrão do
// proxy da API principal (functions/api/[[path]].js): o browser só fala com
// admin.pixgo.qzz.io/copyright/*, nunca com as credenciais reais.
//
// Diferença importante: este worker usa uma credencial PRÓPRIA
// (ADMIN_PASSWORD no worker, header x-admin-password) — não a
// ADMIN_API_KEY_MASTER da API principal. São dois sistemas diferentes.
// O login no dashboard continua a ser uma única key (a mesma
// ADMIN_API_KEY_MASTER); esta função só usa uma segunda credencial,
// internamente, para falar com o worker.
//
// Variáveis de ambiente adicionais a configurar no Cloudflare Pages:
//   COPYRIGHT_WORKER_ADMIN_PASSWORD — igual ao ADMIN_PASSWORD do worker
//   COPYRIGHT_WORKER_URL            — opcional, default https://copyright.pixgo.qzz.io
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

    const workerPassword = env.COPYRIGHT_WORKER_ADMIN_PASSWORD || '';
    if (!workerPassword) {
        return new Response(JSON.stringify({
            error: 'Server Misconfigured',
            message: 'COPYRIGHT_WORKER_ADMIN_PASSWORD não configurada nas env vars do Cloudflare Pages.',
        }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const workerBase = (env.COPYRIGHT_WORKER_URL || 'https://copyright.pixgo.qzz.io').replace(/\/$/, '');
    const pathParts = Array.isArray(params.path) ? params.path : [params.path];
    const restPath = pathParts.filter(Boolean).join('/');

    const incomingUrl = new URL(request.url);
    const targetUrl = `${workerBase}/admin/${restPath}${incomingUrl.search}`;

    const init = {
        method: request.method,
        headers: {
            'Content-Type': request.headers.get('Content-Type') || 'application/json',
            'x-admin-password': workerPassword,
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
            message: `Falha ao contactar o copyright-worker: ${err.message}`,
        }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }
}
