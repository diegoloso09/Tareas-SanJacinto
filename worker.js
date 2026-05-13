// Cloudflare Worker — Inferencia IA local con Workers AI (gratis)
// ─────────────────────────────────────────────────────────────────────
// Reemplaza al proxy hacia Anthropic. Usa Workers AI (Llama) que corre
// dentro de Cloudflare. Sin API keys externas, sin pagar por uso.
//
// El frontend (index.html) sigue mandando un payload con shape de Anthropic:
//   { model, max_tokens, system, messages: [{role:"user", content:"..."}] }
// El worker traduce a Workers AI, llama al modelo, y devuelve un objeto
// con shape Anthropic-compatible para no tocar el frontend:
//   { content: [{ type: "text", text: "..." }] }
//
// SETUP (una vez):
// 1) En el editor del Worker (Cloudflare dashboard), pegá este archivo y deploy.
// 2) Settings → Bindings → Add → "Workers AI":
//      Variable name: AI
//      Deploy de nuevo.
// 3) Editá ALLOWED_ORIGINS abajo con tu URL de GitHub Pages.
// 4) (Opcional) si tenías un secret ANTHROPIC_API_KEY, lo podés borrar.
//
// Cuota gratis: 10.000 Neurons/día. Llama 3.3 70B fast consume ~50-150
// Neurons por llamada, así que tenés margen para ~70-200 tareas/día.
// Si te quedás corto, cambiá MODEL a la versión 8B (mucho más barata).

const ALLOWED_ORIGINS = [
  'https://YOUR-USER.github.io',
  // Para desarrollo local opcional:
  // 'http://localhost:5500',
  // 'http://127.0.0.1:5500',
];

// Modelo por defecto. Alternativas si te quedás sin cuota:
//   '@cf/meta/llama-3.1-8b-instruct-fast'   (mucho más barato y rápido)
//   '@cf/meta/llama-3.1-8b-instruct'
//   '@cf/mistral/mistral-7b-instruct-v0.1'
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

    const corsHeaders = {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };

    // Preflight CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, corsHeaders);
    }

    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return json({ error: 'Origin not allowed', origin }, 403, corsHeaders);
    }

    if (!env.AI) {
      return json({
        error: 'Falta el binding "AI". Agregá Workers AI en Settings → Bindings, name=AI.'
      }, 500, corsHeaders);
    }

    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return json({ error: 'Invalid JSON body' }, 400, corsHeaders);
    }

    // Traducir payload Anthropic → Workers AI
    const messages = [];
    if (payload.system) {
      messages.push({ role: 'system', content: String(payload.system) });
    }
    if (Array.isArray(payload.messages)) {
      for (const m of payload.messages) {
        // El content puede ser string o array (Anthropic permite multimodal)
        let text = '';
        if (typeof m.content === 'string') {
          text = m.content;
        } else if (Array.isArray(m.content)) {
          text = m.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
        }
        messages.push({ role: m.role || 'user', content: text });
      }
    }

    const max_tokens = Number(payload.max_tokens) || 300;

    try {
      const aiResp = await env.AI.run(MODEL, {
        messages,
        max_tokens,
        // Workers AI no siempre respeta response_format, pero ayuda cuando sí:
        response_format: { type: 'json_object' }
      });

      // aiResp suele tener { response: "..." }. Algunos modelos: { text } o { result }.
      let text = '';
      if (typeof aiResp === 'string') text = aiResp;
      else if (aiResp?.response) text = aiResp.response;
      else if (aiResp?.text) text = aiResp.text;
      else if (aiResp?.result) text = aiResp.result;
      else text = JSON.stringify(aiResp);

      // Limpiar fences markdown por las dudas (a veces Llama los mete)
      text = String(text).trim();
      text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

      // Devolver en shape Anthropic-compatible (lo que espera el frontend)
      return json({
        content: [{ type: 'text', text }],
        _meta: { model: MODEL, source: 'workers-ai' }
      }, 200, corsHeaders);
    } catch (e) {
      return json({
        error: 'Workers AI falló',
        detail: String(e?.message || e)
      }, 502, corsHeaders);
    }
  },
};

function json(obj, status, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}
