// Supabase Edge Function: support-chat
// Secrets (set in Supabase > Edge Functions > Secrets, never in GitHub):
//   ANTHROPIC_API_KEY  required
//   AI_MODEL           optional, default claude-haiku-4-5-20251001
//   ALLOWED_ORIGIN     optional, e.g. https://your-site.onrender.com (default: any)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided to the function automatically.

const KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = Deno.env.get("AI_MODEL") ?? "claude-haiku-4-5-20251001";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// Best-effort rate limit: 20 messages per 10 minutes per IP
const hits = new Map<string, number[]>();
function limited(ip: string) {
  const now = Date.now();
  const a = (hits.get(ip) ?? []).filter((t) => now - t < 600000);
  a.push(now);
  hits.set(ip, a);
  return a.length > 20;
}

// Safety net that does not depend on the AI: obvious crisis words (English + Filipino)
const CRISIS = /(kill myself|suicid|end my life|want to die|self[- ]?harm|hurt myself|cut myself|magpakamatay|pagpapakamatay|gusto ko (nang )?mamatay|ayoko na mabuhay|saktan ang sarili|patayin ang sarili)/i;

const words = (s: string) => (s.toLowerCase().match(/[a-z0-9']{3,}/g) ?? []);

// Only APPROVED, anonymized knowledge entries are ever used
async function approvedNotes(q: string) {
  if (!SB_URL || !SB_SERVICE) return [];
  try {
    const r = await fetch(`${SB_URL}/rest/v1/kb_entries?status=eq.approved&select=category,problem,response&limit=200`, {
      headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` },
    });
    const rows = await r.json();
    if (!Array.isArray(rows)) return [];
    const w = new Set(words(q));
    return rows
      .map((x: any) => ({ x, s: words(`${x.category} ${x.problem}`).filter((t) => w.has(t)).length }))
      .filter((o: any) => o.s > 0)
      .sort((a: any, b: any) => b.s - a.s)
      .slice(0, 3)
      .map((o: any) => o.x);
  } catch {
    return [];
  }
}

const SYSTEM = `You are Support Buddy inside Anonymous, an app where people send anonymous songs and messages. You give first-line emotional support.
Style: warm, calm, natural, respectful, never judgmental. Reply in the user's language (Taglish is fine). Keep replies short, 2 to 5 sentences. Name the feeling you notice, then offer one gentle suggestion or one question. Do not lecture or dump long lists.
Limits: you are an AI, not a therapist or doctor. Never diagnose, never prescribe, never promise outcomes or that you can fix things. Never claim to be human.
Safety: if the person may be in danger, or mentions suicide, self-harm, abuse or violence, respond with care, encourage them to contact a trusted adult, a professional, or local emergency services now, and set "crisis" to true.
Human help: if you are not confident you can help, or the person asks for a human, set "escalate" to true. Offer to pass a short summary to the admin team ONLY if they agree, and write "summary": 1 to 3 sentences in third person with no names, places, handles or contact details. Never say an admin has replied or will reply by a certain time.
Team notes (if any) are anonymized guidance approved by the admin team. Use them only if relevant, in your own words. Never mention other users or that notes exist.
Output: reply with ONLY a JSON object: {"reply": string, "crisis": boolean, "escalate": boolean, "summary": string}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!KEY) return json({ error: "not_configured" }, 503);

  const ip = (req.headers.get("x-forwarded-for") ?? "x").split(",")[0].trim();
  if (limited(ip)) return json({ error: "slow_down" }, 429);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }

  // Clean the history: last 10 turns, 1000 chars each, alternating roles, starting with the user
  const msgs: { role: string; content: string }[] = [];
  for (const m of (Array.isArray(body.messages) ? body.messages.slice(-10) : [])) {
    const role = m?.role === "assistant" ? "assistant" : "user";
    const content = String(m?.content ?? "").slice(0, 1000).trim();
    if (!content) continue;
    if (msgs.length && msgs[msgs.length - 1].role === role) msgs[msgs.length - 1].content += "\n" + content;
    else msgs.push({ role, content });
  }
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") return json({ error: "no_message" }, 400);

  const userText = msgs.filter((m) => m.role === "user").map((m) => m.content).join(" ");
  const crisisHit = CRISIS.test(userText);
  const notes = await approvedNotes(msgs[msgs.length - 1].content);
  const system = SYSTEM +
    (notes.length ? "\n\nTeam notes:\n" + notes.map((n: any) => `- [${n.category}] ${n.problem} => ${n.response}`).join("\n") : "") +
    (crisisHit ? "\n\nThe user's words suggest a possible crisis. Set crisis to true." : "");

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 500, system, messages: msgs }),
  });
  if (!r.ok) return json({ error: "ai_error" }, 502);
  const d = await r.json();
  const text = (d.content ?? []).map((c: any) => c.text ?? "").join("").trim();
  let out: any;
  try { out = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim()); }
  catch { out = { reply: text, crisis: false, escalate: false, summary: "" }; }

  return json({
    reply: String(out.reply ?? "").slice(0, 1500) || "I'm here. Do you want to tell me more?",
    crisis: !!out.crisis || crisisHit,
    escalate: !!out.escalate,
    summary: String(out.summary ?? "").slice(0, 600),
  });
});
