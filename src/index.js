// Agenda de Cílios — Cloudflare Worker
// Precisa de: banco D1 ligado como "DB" (wrangler.jsonc) e o segredo "SENHA".
const SEED = [
  ["2026-11-03", "10:00", "Letícia", "henna", 30, 60],
  ["2026-11-03", "17:40", "Gio", "manu", 50, 200],
  ["2026-11-03", "18:30", "Sabrina", "henna", 30, 60],
  ["2026-11-03", "19:00", "Estephany", "manu", 60, 225],
  ["2026-11-04", "10:00", "Júlia", "manu", 60, 100],
  ["2026-11-04", "18:00", "Cleide", "colo", 120, 200],
  ["2026-11-05", "18:00", "Dani", "design", 30, 50],
  ["2026-11-05", "18:30", "Maiandra", "colo", 120, 270],
  ["2026-11-06", "10:30", "Emily", "manu", 60, 125],
  ["2026-11-06", "18:30", "Joice", "henna", 30, 60],
  ["2026-11-06", "19:00", "Filha", "design", 30, 50],
  ["2026-11-06", "19:30", "Filha", "design", 30, 50],
  ["2026-11-07", "10:00", "Fernanda", "design", 30, 50],
  ["2026-11-07", "10:30", "Tifani", "manu", 60, 130],
  ["2026-11-07", "13:30", "Djeni", "colo", 120, 195],
  ["2026-11-07", "15:30", "Rosa", "design", 30, 50],
  ["2026-11-09", "18:30", "Vivi", "henna", 30, null],
  ["2026-11-10", "17:40", "Gio", "manu", 60, null],
  ["2026-11-11", "14:00", "Letícia", "design", 30, 50],
  ["2026-11-13", "10:00", "Vane", "manu", 60, 115],
  ["2026-11-14", "12:00", "Laser", "laser", 30, 0],
  ["2026-11-17", "17:40", "Gio", "manu", 60, null],
  ["2026-11-23", "10:00", "Djeni", "manu", 60, 95],
  ["2026-11-24", "17:40", "Gio", "manu", 60, null]
];

const DDL = [
  "CREATE TABLE IF NOT EXISTS agendamentos (id TEXT PRIMARY KEY, cliente TEXT NOT NULL, servico TEXT NOT NULL, dia TEXT NOT NULL, hora TEXT NOT NULL, duracao INTEGER NOT NULL, valor REAL, obs TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'agendado')",
  "CREATE INDEX IF NOT EXISTS idx_agendamentos_dia ON agendamentos (dia)",
  "CREATE TABLE IF NOT EXISTS servicos (id TEXT PRIMARY KEY, nome TEXT NOT NULL, duracao INTEGER NOT NULL, valor REAL)",
  "CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)"
];

const UPSERT =
  "INSERT INTO agendamentos (id, cliente, servico, dia, hora, duracao, valor, obs, status) VALUES (?,?,?,?,?,?,?,?,?) " +
  "ON CONFLICT(id) DO UPDATE SET cliente=excluded.cliente, servico=excluded.servico, dia=excluded.dia, hora=excluded.hora, " +
  "duracao=excluded.duracao, valor=excluded.valor, obs=excluded.obs, status=excluded.status";

let ready = null;

function init(env) {
  if (!ready) {
    ready = (async () => {
      await env.DB.batch(DDL.map(q => env.DB.prepare(q)));
      const feito = await env.DB.prepare("SELECT v FROM meta WHERE k = 'seed'").first();
      if (!feito) {
        const ins = env.DB.prepare(
          "INSERT OR IGNORE INTO agendamentos (id, cliente, servico, dia, hora, duracao, valor, obs, status) VALUES (?,?,?,?,?,?,?,?,?)"
        );
        const lote = SEED.map(r =>
          ins.bind("a-" + r[0].replace(/-/g, "") + "-" + r[1].replace(":", ""), r[2], r[3], r[0], r[1], r[4], r[5], "", "agendado")
        );
        lote.push(env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES ('seed', '1')"));
        await env.DB.batch(lote);
      }
    })().catch(e => { ready = null; throw e; });
  }
  return ready;
}

const json = (obj, status) =>
  new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });

function igual(a, b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] || 0) ^ (y[i] || 0);
  return d === 0;
}

function dataValida(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function limpaItem(o) {
  if (!o || typeof o !== "object") return null;
  const cliente = typeof o.cliente === "string" ? o.cliente.trim().slice(0, 80) : "";
  const servico = typeof o.servico === "string" ? o.servico : "";
  const hm = typeof o.hora === "string" ? o.hora.match(/^([01]?\d|2[0-3]):([0-5]\d)$/) : null;
  const duracao = Math.round(Number(o.duracao));
  let valor = o.valor;
  if (valor === "" || valor === undefined) valor = null;
  if (valor !== null) { valor = Number(valor); if (!isFinite(valor) || valor < 0 || valor > 1000000) return null; }
  const status = ["agendado", "concluido", "cancelado"].includes(o.status) ? o.status : "agendado";
  let id = typeof o.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(o.id) ? o.id : "a-" + crypto.randomUUID().slice(0, 12);
  if (!cliente || !/^[a-z0-9_-]{1,20}$/.test(servico) || !dataValida(o.dia) || !hm || !(duracao >= 5 && duracao <= 720)) return null;
  return {
    id, cliente, servico, dia: o.dia, hora: hm[1].padStart(2, "0") + ":" + hm[2], duracao, valor,
    obs: typeof o.obs === "string" ? o.obs.trim().slice(0, 300) : "", status
  };
}

const bindItem = (stmt, i) => stmt.bind(i.id, i.cliente, i.servico, i.dia, i.hora, i.duracao, i.valor, i.obs, i.status);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    if (!env.SENHA) return json({ error: "a variável SENHA não foi configurada no Cloudflare" }, 500);
    if (!env.DB) return json({ error: "o banco D1 não está ligado ao projeto (nome DB)" }, 500);
    let enviada = "";
    try { enviada = decodeURIComponent(request.headers.get("x-senha") || ""); } catch (e) {}
    if (!igual(enviada, String(env.SENHA))) return json({ error: "senha" }, 401);

    try {
      await init(env);
      const m = request.method, p = url.pathname;

      if (p === "/api/dados" && m === "GET") {
        const a = await env.DB.prepare("SELECT id, cliente, servico, dia, hora, duracao, valor, obs, status FROM agendamentos ORDER BY dia, hora").all();
        const s = await env.DB.prepare("SELECT id, nome, duracao, valor FROM servicos").all();
        const svcOver = {};
        s.results.forEach(r => { svcOver[r.id] = { nome: r.nome, duracao: r.duracao, valor: r.valor }; });
        return json({ items: a.results, svcOver });
      }

      if (p === "/api/item" && m === "POST") {
        const item = limpaItem(await request.json());
        if (!item) return json({ error: "dados inválidos" }, 400);
        await bindItem(env.DB.prepare(UPSERT), item).run();
        return json(item);
      }

      if (p === "/api/item" && m === "DELETE") {
        const id = url.searchParams.get("id") || "";
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return json({ error: "id inválido" }, 400);
        await env.DB.prepare("DELETE FROM agendamentos WHERE id = ?").bind(id).run();
        return json({ ok: true });
      }

      if (p === "/api/servico" && m === "PUT") {
        const b = await request.json();
        const duracao = Math.round(Number(b && b.duracao));
        let valor = b && b.valor;
        if (valor === "" || valor === undefined) valor = null;
        if (valor !== null) { valor = Number(valor); if (!isFinite(valor) || valor < 0 || valor > 1000000) valor = null; }
        if (!b || !/^[a-z0-9_-]{1,20}$/.test(b.id || "") || !(duracao >= 5 && duracao <= 720)) return json({ error: "dados inválidos" }, 400);
        const nome = String(b.nome || b.id).slice(0, 60);
        await env.DB.prepare(
          "INSERT INTO servicos (id, nome, duracao, valor) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET nome=excluded.nome, duracao=excluded.duracao, valor=excluded.valor"
        ).bind(b.id, nome, duracao, valor).run();
        return json({ id: b.id, nome, duracao, valor });
      }

      if (p === "/api/importar" && m === "POST") {
        const b = await request.json();
        if (!b || !Array.isArray(b.items) || b.items.length > 2000) return json({ error: "backup inválido" }, 400);
        const itens = b.items.map(limpaItem);
        if (itens.some(i => !i)) return json({ error: "backup inválido" }, 400);
        const lote = [env.DB.prepare("DELETE FROM agendamentos"), env.DB.prepare("DELETE FROM servicos")];
        const up = env.DB.prepare(UPSERT);
        itens.forEach(i => lote.push(bindItem(up, i)));
        Object.entries(b.svcOver || {}).forEach(([id, o]) => {
          const duracao = Math.round(Number(o && o.duracao));
          if (!/^[a-z0-9_-]{1,20}$/.test(id) || !(duracao >= 5 && duracao <= 720)) return;
          let valor = o.valor === "" || o.valor === undefined ? null : Number(o.valor);
          if (valor !== null && (!isFinite(valor) || valor < 0)) valor = null;
          lote.push(env.DB.prepare("INSERT OR REPLACE INTO servicos (id, nome, duracao, valor) VALUES (?,?,?,?)").bind(id, String(o.nome || id).slice(0, 60), duracao, valor));
        });
        lote.push(env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES ('seed', '1')"));
        await env.DB.batch(lote);
        return json({ ok: true, total: itens.length });
      }

      return json({ error: "não encontrado" }, 404);
    } catch (e) {
      return json({ error: "erro no servidor" }, 500);
    }
  }
};
