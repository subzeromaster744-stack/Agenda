# Agenda de Cílios

Agenda de horários para cílios e sobrancelhas: aviso de conflito, horários livres do dia,
histórico de procedimentos e ganho mensal. Compartilhada entre aparelhos (Cloudflare Pages + D1).

## Configuração no Cloudflare Pages

- **Build command:** (vazio)
- **Build output directory:** `public`
- **Bindings** (Settings → Bindings): D1 database com o nome de variável `DB`
- **Variables and secrets:** segredo `SENHA` com a senha de acesso

As tabelas e os horários iniciais de novembro são criados sozinhos no primeiro acesso.
Depois de criar o binding e a senha, faça uma nova implantação (Deployments → Retry).
