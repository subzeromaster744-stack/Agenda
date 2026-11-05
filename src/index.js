// Agenda de Cílios — Cloudflare Worker
// Precisa de: banco D1 ligado como "DB" e a variável GOOGLE_CLIENT_ID (wrangler.jsonc).
// Cada conta Google tem a sua agenda; o dono pode convidar outros e-mails.

import { verificaGoogle, assinaSessao, leSessao, novoSegredo } from "./auth.js";

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
  "CREATE TABLE IF NOT EXISTS ag_usuarios (sub TEXT PRIMARY KEY, email TEXT NOT NULL, nome TEXT NOT NULL DEFAULT '', criado INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS ag_itens (agenda TEXT NOT NULL, id TEXT NOT NULL, cliente TEXT NOT NULL, servico TEXT NOT NULL, dia TEXT NOT NULL, hora TEXT NOT NULL, duracao INTEGER NOT NULL, valor REAL, obs TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'agendado', PRIMARY KEY (agenda, id))",
  "CREATE INDEX IF NOT EXISTS idx_ag_itens_dia ON ag_itens (agenda, dia)",
  "CREATE TABLE IF NOT EXISTS ag_servicos (agenda TEXT NOT NULL, id TEXT NOT NULL, nome TEXT NOT NULL, duracao INTEGER NOT NULL, valor REAL, renda INTEGER NOT NULL DEFAULT 1, cor TEXT NOT NULL DEFAULT '', removido INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (agenda, id))",
  "CREATE TABLE IF NOT EXISTS ag_acessos (agenda TEXT NOT NULL, email TEXT NOT NULL, papel TEXT NOT NULL DEFAULT 'editar', PRIMARY KEY (agenda, email))",
  "CREATE TABLE IF NOT EXISTS ag_pedidos (agenda TEXT NOT NULL, id TEXT NOT NULL, de_email TEXT NOT NULL, de_nome TEXT NOT NULL DEFAULT '', cliente TEXT NOT NULL, servico TEXT NOT NULL, dia TEXT NOT NULL, hora TEXT NOT NULL, duracao INTEGER NOT NULL, obs TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendente', criado INTEGER NOT NULL, PRIMARY KEY (agenda, id))",
  "CREATE TABLE IF NOT EXISTS ag_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)"
];

const UPSERT =
  "INSERT INTO ag_itens (agenda, id, cliente, servico, dia, hora, duracao, valor, obs, status) VALUES (?,?,?,?,?,?,?,?,?,?) " +
  "ON CONFLICT(agenda, id) DO UPDATE SET cliente=excluded.cliente, servico=excluded.servico, dia=excluded.dia, hora=excluded.hora, " +
  "duracao=excluded.duracao, valor=excluded.valor, obs=excluded.obs, status=excluded.status";

const SESSAO_DIAS = 30;

let pronto = null;
let segredo = null;

function init(env) {
  if (!pronto) {
    pronto = (async () => {
      await env.DB.batch(DDL.map(q => env.DB.prepare(q)));
      // bancos criados antes da coluna "papel"
      for (const q of [
        "ALTER TABLE ag_acessos ADD COLUMN papel TEXT NOT NULL DEFAULT 'editar'",
        "ALTER TABLE ag_servicos ADD COLUMN renda INTEGER NOT NULL DEFAULT 1",
        "ALTER TABLE ag_servicos ADD COLUMN cor TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE ag_servicos ADD COLUMN removido INTEGER NOT NULL DEFAULT 0"
      ]) { try { await env.DB.prepare(q).run(); } catch (e) {} }
      let r = await env.DB.prepare("SELECT v FROM ag_meta WHERE k = 'sess_key'").first();
      if (!r) {
        await env.DB.prepare("INSERT OR IGNORE INTO ag_meta (k, v) VALUES ('sess_key', ?)").bind(novoSegredo()).run();
        r = await env.DB.prepare("SELECT v FROM ag_meta WHERE k = 'sess_key'").first();
      }
      segredo = r.v;
    })().catch(e => { pronto = null; throw e; });
  }
  return pronto;
}

function json(obj, status, extra) {
  const h = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  if (extra) Object.entries(extra).forEach(([k, v]) => h.append(k, v));
  return new Response(JSON.stringify(obj), { status: status || 200, headers: h });
}

const falha = (msg, status) => json({ error: msg }, status);

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
  const id = typeof o.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(o.id) ? o.id : "a-" + crypto.randomUUID().slice(0, 12);
  if (!cliente || !/^[a-z0-9_-]{1,20}$/.test(servico) || !dataValida(o.dia) || !hm || !(duracao >= 5 && duracao <= 720)) return null;
  return {
    id, cliente, servico, dia: o.dia, hora: hm[1].padStart(2, "0") + ":" + hm[2], duracao, valor,
    obs: typeof o.obs === "string" ? o.obs.trim().slice(0, 300) : "", status
  };
}

const bindItem = (stmt, agenda, i) => stmt.bind(agenda, i.id, i.cliente, i.servico, i.dia, i.hora, i.duracao, i.valor, i.obs, i.status);

function cookieDeSessao(valor, https, maxAge) {
  return "agenda_sess=" + valor + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + maxAge + (https ? "; Secure" : "");
}

async function usuarioDe(request) {
  const m = (request.headers.get("cookie") || "").match(/(?:^|;\s*)agenda_sess=([^;]+)/);
  if (!m) return null;
  const d = await leSessao(m[1], segredo);
  return d ? { sub: d.s, email: d.e, nome: d.n || "" } : null;
}

// Devolve { id, papel } com papel "dono", "editar" ou "ver"; null se não tem acesso.
async function agendaPermitida(env, user, id) {
  if (!id || id === user.sub) return { id: user.sub, papel: "dono" };
  const r = await env.DB.prepare("SELECT papel FROM ag_acessos WHERE agenda = ? AND email = ?").bind(id, user.email).first();
  return r ? { id, papel: r.papel === "ver" ? "ver" : "editar" } : null;
}

function limpaPedido(o) {
  if (!o || typeof o !== "object") return null;
  const i = limpaItem(Object.assign({}, o, { duracao: o.duracao || 30, valor: null }));
  return i;
}

async function semeia(env, sub) {
  const ins = env.DB.prepare(UPSERT);
  const lote = SEED.map(r =>
    bindItem(ins, sub, {
      id: "a-" + r[0].replace(/-/g, "") + "-" + r[1].replace(":", ""),
      cliente: r[2], servico: r[3], dia: r[0], hora: r[1], duracao: r[4], valor: r[5], obs: "", status: "agendado"
    })
  );
  await env.DB.batch(lote);
}

function valorServico(v) {
  if (v === "" || v === undefined || v === null) return null;
  v = Number(v);
  return isFinite(v) && v >= 0 && v <= 1000000 ? v : null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    const p = url.pathname, m = request.method;
    const https = url.protocol === "https:";
    const clientId = String(env.GOOGLE_CLIENT_ID || "").trim();

    if (p === "/api/config" && m === "GET") return json({ clientId: clientId || null });
    if (!env.DB) return falha("o banco D1 não está ligado ao projeto (nome DB)", 500);
    if (m !== "GET" && request.headers.get("x-agenda") !== "1") return falha("pedido não permitido", 403);

    try {
      await init(env);

      if (p === "/api/login" && m === "POST") {
        if (!clientId) return falha("o login com Google ainda não foi configurado", 500);
        const b = await request.json().catch(() => null);
        let g;
        try { g = await verificaGoogle(b && b.credential, clientId); }
        catch (e) { return falha(e.message || "não foi possível validar o login", 401); }
        await env.DB.prepare(
          "INSERT INTO ag_usuarios (sub, email, nome, criado) VALUES (?,?,?,?) ON CONFLICT(sub) DO UPDATE SET email=excluded.email, nome=excluded.nome"
        ).bind(g.sub, g.email, g.nome, Date.now()).run();
        const maxAge = SESSAO_DIAS * 86400;
        const valor = await assinaSessao({ s: g.sub, e: g.email, n: g.nome, x: Math.floor(Date.now() / 1000) + maxAge }, segredo);
        return json({ user: { sub: g.sub, email: g.email, nome: g.nome } }, 200, { "set-cookie": cookieDeSessao(valor, https, maxAge) });
      }

      if (p === "/api/logout" && m === "POST") {
        return json({ ok: true }, 200, { "set-cookie": cookieDeSessao("", https, 0) });
      }

      const user = await usuarioDe(request);
      if (!user) return falha("entre com sua conta Google", 401);

      if (p === "/api/sessao" && m === "GET") {
        const rs = await env.DB.prepare(
          "SELECT a.agenda AS id, a.papel AS papel, u.nome AS nome, u.email AS email FROM ag_acessos a JOIN ag_usuarios u ON u.sub = a.agenda WHERE a.email = ? ORDER BY u.nome, u.email"
        ).bind(user.email).all();
        const agendas = [{ id: user.sub, nome: "Minha agenda", dono: true, papel: "dono" }].concat(
          rs.results.map(r => ({ id: r.id, nome: "Agenda de " + (r.nome || r.email), dono: false, papel: r.papel === "ver" ? "ver" : "editar" }))
        );
        return json({ user, agendas });
      }

      // Convites: só o dono mexe na própria lista.
      if (p === "/api/convidados" && m === "GET") {
        const rs = await env.DB.prepare("SELECT email, papel FROM ag_acessos WHERE agenda = ? ORDER BY email").bind(user.sub).all();
        return json({ convidados: rs.results.map(r => ({ email: r.email, papel: r.papel === "ver" ? "ver" : "editar" })) });
      }
      if (p === "/api/convidar" && m === "POST") {
        const b = await request.json().catch(() => null);
        const email = String((b && b.email) || "").trim().toLowerCase();
        if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email)) return falha("e-mail inválido", 400);
        if (email === user.email) return falha("esse é o seu próprio e-mail", 400);
        const papel = b && b.papel === "ver" ? "ver" : "editar";
        const ja = await env.DB.prepare("SELECT 1 AS ok FROM ag_acessos WHERE agenda = ? AND email = ?").bind(user.sub, email).first();
        if (!ja) {
          const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM ag_acessos WHERE agenda = ?").bind(user.sub).first();
          if (n.n >= 10) return falha("limite de 10 convidados", 400);
        }
        await env.DB.prepare("INSERT INTO ag_acessos (agenda, email, papel) VALUES (?,?,?) ON CONFLICT(agenda, email) DO UPDATE SET papel=excluded.papel").bind(user.sub, email, papel).run();
        return json({ ok: true });
      }
      if (p === "/api/convidar" && m === "DELETE") {
        const email = String(url.searchParams.get("email") || "").trim().toLowerCase();
        await env.DB.prepare("DELETE FROM ag_acessos WHERE agenda = ? AND email = ?").bind(user.sub, email).run();
        return json({ ok: true });
      }

      const perm = await agendaPermitida(env, user, url.searchParams.get("agenda"));
      if (!perm) return falha("sem acesso", 403);
      const agenda = perm.id;
      const veSo = perm.papel === "ver";
      const podeEditar = !veSo;
      const SO_VER = "você só tem permissão para ver esta agenda";

      if (p === "/api/dados" && m === "GET") {
        const a = await env.DB.prepare(
          "SELECT id, cliente, servico, dia, hora, duracao, valor, obs, status FROM ag_itens WHERE agenda = ? ORDER BY dia, hora"
        ).bind(agenda).all();
        const s = await env.DB.prepare("SELECT id, nome, duracao, valor, renda, cor, removido FROM ag_servicos WHERE agenda = ?").bind(agenda).all();
        const svcOver = {};
        s.results.forEach(r => { svcOver[r.id] = { nome: r.nome, duracao: r.duracao, valor: r.valor, renda: r.renda ? 1 : 0, cor: r.cor || "", removido: r.removido ? 1 : 0 }; });
        let items = a.results, over = svcOver;
        let pq;
        if (veSo) {
          // quem só vê não enxerga valores, nomes nem procedimentos: só que o horário está ocupado
          items = items.filter(i => i.status !== "cancelado").map(i => ({ id: i.id, cliente: "Agendado", servico: "ocupado", dia: i.dia, hora: i.hora, duracao: i.duracao, valor: null, obs: "", status: i.status === "concluido" ? "concluido" : "agendado" }));
          over = {};
          Object.entries(svcOver).forEach(([k, o]) => { over[k] = Object.assign({}, o, { valor: null }); });
          pq = await env.DB.prepare(
            "SELECT id, de_email, de_nome, cliente, servico, dia, hora, duracao, obs, status, criado FROM ag_pedidos WHERE agenda = ? AND de_email = ? ORDER BY criado DESC LIMIT 30"
          ).bind(agenda, user.email).all();
        } else {
          pq = await env.DB.prepare(
            "SELECT id, de_email, de_nome, cliente, servico, dia, hora, duracao, obs, status, criado FROM ag_pedidos WHERE agenda = ? ORDER BY (status = 'pendente') DESC, criado DESC LIMIT 60"
          ).bind(agenda).all();
        }
        return json({ items, svcOver: over, papel: perm.papel, pedidos: pq.results });
      }

      // Pedido de horário (feito por quem tem acesso; o dono ou editor aceita ou recusa)
      if (p === "/api/pedido" && m === "POST") {
        const i = limpaPedido(await request.json().catch(() => null));
        if (!i) return falha("dados inválidos", 400);
        const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM ag_pedidos WHERE agenda = ? AND de_email = ? AND status = 'pendente'").bind(agenda, user.email).first();
        if (n.n >= 10) return falha("você já tem 10 pedidos aguardando resposta", 400);
        const id = "p-" + crypto.randomUUID().slice(0, 12);
        await env.DB.prepare(
          "INSERT INTO ag_pedidos (agenda, id, de_email, de_nome, cliente, servico, dia, hora, duracao, obs, status, criado) VALUES (?,?,?,?,?,?,?,?,?,?,'pendente',?)"
        ).bind(agenda, id, user.email, user.nome || "", i.cliente, i.servico, i.dia, i.hora, i.duracao, i.obs, Date.now()).run();
        return json({ ok: true, id });
      }
      if (p === "/api/pedido" && m === "DELETE") {
        const id = url.searchParams.get("id") || "";
        // quem pediu cancela o próprio pedido pendente; dono/editor apaga qualquer um
        if (podeEditar) await env.DB.prepare("DELETE FROM ag_pedidos WHERE agenda = ? AND id = ?").bind(agenda, id).run();
        else await env.DB.prepare("DELETE FROM ag_pedidos WHERE agenda = ? AND id = ? AND de_email = ?").bind(agenda, id, user.email).run();
        return json({ ok: true });
      }
      if (p === "/api/pedido/resolver" && m === "POST") {
        if (!podeEditar) return falha(SO_VER, 403);
        const b = await request.json().catch(() => null);
        const status = b && b.status === "aceito" ? "aceito" : (b && b.status === "recusado" ? "recusado" : null);
        if (!status || !/^[A-Za-z0-9_-]{1,64}$/.test((b && b.id) || "")) return falha("dados inválidos", 400);
        await env.DB.prepare("UPDATE ag_pedidos SET status = ? WHERE agenda = ? AND id = ?").bind(status, agenda, b.id).run();
        return json({ ok: true });
      }

      // Carrega a lista de novembro (só dono, só se a agenda estiver vazia)
      if (p === "/api/exemplo" && m === "POST") {
        if (perm.papel !== "dono") return falha("só o dono da agenda pode fazer isso", 403);
        const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM ag_itens WHERE agenda = ?").bind(agenda).first();
        if (n.n > 0) return falha("a agenda já tem horários", 400);
        await semeia(env, agenda);
        return json({ ok: true, total: SEED.length });
      }

      if (["/api/item", "/api/servico", "/api/importar"].includes(p) && m !== "GET" && !podeEditar) return falha(SO_VER, 403);

      if (p === "/api/item" && m === "POST") {
        const item = limpaItem(await request.json().catch(() => null));
        if (!item) return falha("dados inválidos", 400);
        await bindItem(env.DB.prepare(UPSERT), agenda, item).run();
        return json(item);
      }

      if (p === "/api/item" && m === "DELETE") {
        const id = url.searchParams.get("id") || "";
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return falha("id inválido", 400);
        await env.DB.prepare("DELETE FROM ag_itens WHERE agenda = ? AND id = ?").bind(agenda, id).run();
        return json({ ok: true });
      }

      if (p === "/api/servico" && m === "PUT") {
        const b = await request.json().catch(() => null);
        const duracao = Math.round(Number(b && b.duracao));
        if (!b || !/^[a-z0-9_-]{1,20}$/.test(b.id || "") || !(duracao >= 5 && duracao <= 720)) return falha("dados inválidos", 400);
        const valor = valorServico(b.valor);
        const nome = String(b.nome || b.id).trim().slice(0, 40) || b.id;
        const renda = b.renda === 0 || b.renda === false ? 0 : 1;
        const cor = /^c[0-5]$/.test(b.cor || "") ? b.cor : "";
        const removido = b.removido ? 1 : 0;
        await env.DB.prepare(
          "INSERT INTO ag_servicos (agenda, id, nome, duracao, valor, renda, cor, removido) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(agenda, id) DO UPDATE SET nome=excluded.nome, duracao=excluded.duracao, valor=excluded.valor, renda=excluded.renda, cor=excluded.cor, removido=excluded.removido"
        ).bind(agenda, b.id, nome, duracao, valor, renda, cor, removido).run();
        return json({ id: b.id, nome, duracao, valor, renda, cor, removido });
      }

      if (p === "/api/importar" && m === "POST") {
        const b = await request.json().catch(() => null);
        if (!b || !Array.isArray(b.items) || b.items.length > 2000) return falha("backup inválido", 400);
        const itens = b.items.map(limpaItem);
        if (itens.some(i => !i)) return falha("backup inválido", 400);
        const lote = [
          env.DB.prepare("DELETE FROM ag_itens WHERE agenda = ?").bind(agenda),
          env.DB.prepare("DELETE FROM ag_servicos WHERE agenda = ?").bind(agenda)
        ];
        const up = env.DB.prepare(UPSERT);
        itens.forEach(i => lote.push(bindItem(up, agenda, i)));
        Object.entries(b.svcOver || {}).forEach(([id, o]) => {
          const duracao = Math.round(Number(o && o.duracao));
          if (!/^[a-z0-9_-]{1,20}$/.test(id) || !(duracao >= 5 && duracao <= 720)) return;
          lote.push(env.DB.prepare("INSERT OR REPLACE INTO ag_servicos (agenda, id, nome, duracao, valor, renda, cor, removido) VALUES (?,?,?,?,?,?,?,?)")
            .bind(agenda, id, String(o.nome || id).slice(0, 40), duracao, valorServico(o.valor), o.renda === 0 ? 0 : 1, /^c[0-5]$/.test(o.cor || "") ? o.cor : "", o.removido ? 1 : 0));
        });
        await env.DB.batch(lote);
        return json({ ok: true, total: itens.length });
      }

      return falha("não encontrado", 404);
    } catch (e) {
      return falha("erro no servidor", 500);
    }
  }
};
