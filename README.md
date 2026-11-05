# Agenda de Cílios

Agenda de horários para cílios e sobrancelhas: aviso de conflito, horários livres do dia,
histórico de procedimentos e ganho mensal. Login com Google, uma agenda por usuário e
convite de outros e-mails para a mesma agenda (Cloudflare Worker + D1).

- `public/index.html`: a página
- `src/index.js`: API (`/api/*`) com sessão por cookie e banco D1
- `src/auth.js`: confere o login do Google e assina a sessão
- `wrangler.jsonc`: nome do Worker, pasta da página, banco `agenda` e `GOOGLE_CLIENT_ID`

## Login com Google

1. No Google Cloud Console, crie um **ID do cliente OAuth** do tipo *Aplicativo da Web*.
2. Em *Origens JavaScript autorizadas*, coloque o endereço do Worker (ex.: `https://agenda.SEU-USUARIO.workers.dev`).
3. Cole o ID do cliente em `GOOGLE_CLIENT_ID` no `wrangler.jsonc` e faça commit.

Não precisa de segredo: o ID do cliente é público. A chave que assina a sessão é criada sozinha no banco.

A primeira conta que entrar recebe os horários iniciais de novembro. Quem não tiver convite só vê a própria agenda.

## Permissões e pedidos

- Contas novas começam com a agenda vazia. O dono pode carregar a lista de novembro pelo botão da tela inicial (só funciona com a agenda vazia).
- Ao compartilhar, cada e-mail recebe uma permissão: **Pode editar** (vê e altera tudo) ou **Só ver e pedir horário** (não vê valores, não edita; envia pedidos que o dono/editor aceita ou recusa na aba Pedidos).
