# Agenda de Cílios

Agenda de horários para cílios e sobrancelhas: aviso de conflito, horários livres do dia,
histórico de procedimentos e ganho mensal. Compartilhada entre aparelhos (Cloudflare Worker + D1).

- `public/index.html`: a página
- `src/index.js`: API (`/api/*`) protegida por senha, usando o banco D1
- `wrangler.jsonc`: nome do Worker, pasta da página e ligação com o banco `agenda`

## Configuração

No Worker `agenda` (Settings → Variables and Secrets), crie o segredo `SENHA` com a senha de acesso.
As tabelas e os horários iniciais de novembro são criados sozinhos no primeiro acesso.
Cada commit na `main` publica uma nova versão.
