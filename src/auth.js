// Login com Google (verificação do token) e sessão assinada por cookie.

const enc = new TextEncoder();

const b64u = {
  enc(buf) {
    let s = "";
    new Uint8Array(buf).forEach(b => { s += String.fromCharCode(b); });
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  dec(str) {
    str = String(str).replace(/-/g, "+").replace(/_/g, "/");
    while (str.length % 4) str += "=";
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
};

const paraB64 = obj => b64u.enc(enc.encode(JSON.stringify(obj)));
const deB64 = s => JSON.parse(new TextDecoder().decode(b64u.dec(s)));

export const URL_CHAVES_GOOGLE = "https://www.googleapis.com/oauth2/v3/certs";

let cache = { em: 0, chaves: null };

async function chavesGoogle(fetchFn, forcar) {
  if (!forcar && cache.chaves && Date.now() - cache.em < 3600 * 1000) return cache.chaves;
  const r = await fetchFn(URL_CHAVES_GOOGLE);
  if (!r.ok) throw new Error("chaves do Google indisponíveis");
  const d = await r.json();
  cache = { em: Date.now(), chaves: d.keys || [] };
  return cache.chaves;
}

export function limpaCacheChaves() { cache = { em: 0, chaves: null }; }

// Confere assinatura, emissor, público (clientId), validade e e-mail verificado.
export async function verificaGoogle(token, clientId, fetchFn) {
  fetchFn = fetchFn || fetch;
  const partes = String(token || "").split(".");
  if (partes.length !== 3) throw new Error("token inválido");
  let cab, p;
  try { cab = deB64(partes[0]); p = deB64(partes[1]); } catch (e) { throw new Error("token inválido"); }
  if (cab.alg !== "RS256") throw new Error("token inválido");

  let jwk = (await chavesGoogle(fetchFn, false)).find(k => k.kid === cab.kid);
  if (!jwk && Date.now() - cache.em > 60 * 1000) jwk = (await chavesGoogle(fetchFn, true)).find(k => k.kid === cab.kid);
  if (!jwk) throw new Error("token inválido");

  const chave = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", chave, b64u.dec(partes[2]), enc.encode(partes[0] + "." + partes[1]));
  if (!ok) throw new Error("token inválido");

  const agora = Math.floor(Date.now() / 1000);
  if (p.iss !== "https://accounts.google.com" && p.iss !== "accounts.google.com") throw new Error("token inválido");
  if (!clientId || p.aud !== clientId) throw new Error("token inválido");
  if (!(p.exp > agora - 60)) throw new Error("login expirado, tente de novo");
  if (!(p.email_verified === true || p.email_verified === "true") || !p.email || !p.sub) throw new Error("e-mail da conta Google não verificado");
  return { sub: String(p.sub), email: String(p.email).toLowerCase(), nome: String(p.name || "").slice(0, 80) };
}

export function novoSegredo() {
  return b64u.enc(crypto.getRandomValues(new Uint8Array(32)));
}

const chaveHmac = segredo => crypto.subtle.importKey("raw", b64u.dec(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

export async function assinaSessao(dados, segredo) {
  const corpo = paraB64(dados);
  const sig = await crypto.subtle.sign("HMAC", await chaveHmac(segredo), enc.encode(corpo));
  return corpo + "." + b64u.enc(sig);
}

export async function leSessao(valor, segredo) {
  const [corpo, sig] = String(valor || "").split(".");
  if (!corpo || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await chaveHmac(segredo), b64u.dec(sig), enc.encode(corpo));
    if (!ok) return null;
    const d = deB64(corpo);
    return d && d.x > Date.now() / 1000 ? d : null;
  } catch (e) { return null; }
}
