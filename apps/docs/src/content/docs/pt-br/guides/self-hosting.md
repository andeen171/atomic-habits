---
title: Hospedar o servidor
description: Rode seu próprio servidor do Atomic — de um teste local em uma linha à receita de produção a custo zero por trás do Atomic Cloud.
sidebar:
  order: 6
---

O Atomic funciona totalmente offline. Um servidor acrescenta backup e sincronização entre
aparelhos e, se você quiser, e-mail, login com Google, cobrança, backup de fotos e a IA beta. O
servidor em `apps/server` (Bun, Hono, tRPC, Better Auth, SQLite ou Turso) é o mesmo que roda o
**Atomic Cloud**, então você pode rodar o seu e apontar os apps para ele em **Avançado · servidor
próprio**, na tela de login.

## Testando localmente

```bash
# na raiz do repositório
bun install
bun dev:server        # http://localhost:3000, sem configuração
```

Sem **nenhuma variável**, o servidor é um servidor de sincronização simples: contas com e-mail e
senha, sincronização de todas as coleções e backup de fotos no disco local. As migrações rodam na
inicialização; os dados vão para `apps/server/local.db`. Sem `BETTER_AUTH_SECRET`, ele inventa um
segredo para aquela execução (todo mundo é desconectado ao reiniciar); em produção ele se recusa a
subir sem um.

## Um contêiner

A imagem é gerada a partir da raiz do repositório, porque o servidor importa o `@atomic/core`:

```bash
docker build -f apps/server/Dockerfile -t atomic-server .
docker run -d --name atomic -p 3000:3000 \
  -e BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  -v atomic-data:/data atomic-server
```

O banco fica em `/data/atomic.db` e as fotos em `/data/blobs`; mantenha `/data` num volume. Coloque
TLS na frente e defina `BETTER_AUTH_URL` com o endereço público `https://`. Fly.io, Railway e Render
também funcionam (`apps/server/README.md`, *Deploying*).

## Configuração

Cada recurso só liga quando **todas** as suas variáveis estão definidas. Se só algumas estiverem, a
inicialização em produção para e lista cada variável que falta; em desenvolvimento, ela registra um
aviso e deixa o recurso desligado.

| Recurso | Variáveis | Sem elas |
| --- | --- | --- |
| Núcleo | `BETTER_AUTH_SECRET` (obrigatória em produção), `BETTER_AUTH_URL`, `DATABASE_URL` + `DATABASE_AUTH_TOKEN` (Turso), `CORS_ORIGINS`, `CLIENT_IP_HEADER` (atrás de um proxy), `APP_WEB_URL`, `PRIVACY_URL`, `TERMS_URL`, `METRICS_TOKEN` | Um arquivo SQLite local, qualquer origem, sem métricas |
| E-mail | `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_DAILY_CAP` (90) | Sem verificação nem redefinição de senha |
| Login com Google | `GOOGLE_CLIENT_IDS`, `GOOGLE_WEB_ORIGINS` | Só e-mail e senha |
| Cobrança | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_MONTHLY` (+ `_YEARLY`, `STRIPE_TRIAL_DAYS`, `BILLING_GRACE_DAYS`) | Todo mundo fica com o `DEFAULT_PLAN` (Pro) |
| Limites dos planos | `LIMIT_FREE_*` / `LIMIT_PRO_*` para pedidos de IA, caracteres traduzidos, MB de fotos e MB de sincronização; `BLOB_MAX_FILE_BYTES` | 10 / 150 pedidos, 2.000 / 40.000 caracteres, 100 / 5.120 MB de fotos, 50 / 500 MB de sincronização |
| IA beta | `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`, `AI_JSON_MODE`, `AI_TIMEOUT_MS`, `AI_TRANSLATE_TIMEOUT_MS`, `AI_MAX_CONCURRENCY`, `AI_QUEUE_MAX`, `AI_FEATURES`, `AI_HOSTING` + `AI_PROVIDER_NAME`, `AI_REQUIRE_VERIFIED_EMAIL`, `AI_GLOBAL_DAILY_REQUESTS` | A IA fica escondida nos apps |
| Backup de fotos | `BLOB_STORAGE=disk\|s3\|off`, `BLOB_DIR`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` | Fotos no disco do servidor |
| Atualizações do Android | `ANDROID_LATEST_VERSION` + `ANDROID_DOWNLOAD_URL` | Sem o aviso de versão nova |

Regras que vale conhecer:

- **Cobrança exige e-mail** em produção: quem paga precisa conseguir redefinir a senha.
- **`AI_FEATURES=` (definida, mas vazia) é o desligamento de emergência da IA.** Os apps descobrem
  os recursos do servidor em `GET /trpc/meta` e guardam em cache por uma hora, então a IA some de
  todos os apps em até uma hora; nesse meio-tempo as chamadas recebem "não disponível".
- Com e-mail ligado, a IA é só para endereços confirmados (`AI_REQUIRE_VERIFIED_EMAIL`; endereços
  verificados pelo Google contam).
- A lista completa, com padrões e todas as regras, está no
  [`apps/server/README.md`](https://github.com/andeen171/atomic-habits/blob/claude/wizardly-davinci-dcrnwc/apps/server/README.md#configuration).

## A receita de custo zero (Atomic Cloud)

O `deploy/` guarda a configuração de produção usada no Atomic Cloud: Docker Compose numa VM
gratuita. O único custo fixo é um domínio.

| Peça | Onde | Custo |
| --- | --- | --- |
| Servidor, banco, modelo de IA, TLS | Uma VM Ampere A1 *Always Free* da Oracle Cloud (4 OCPU, 24 GB de RAM) | US$ 0 |
| Banco de dados | Um arquivo SQLite na VM, transmitido para o Cloudflare R2 pelo Litestream (ou o plano grátis do Turso) | US$ 0 |
| Fotos | Um bucket do Cloudflare R2 (10 GB grátis, sem taxa de saída) | US$ 0 até 10 GB |
| E-mail | O plano grátis do Resend (100/dia; o Atomic fica abaixo disso com `EMAIL_DAILY_CAP=90`) | US$ 0 |
| App web e DNS | Cloudflare Pages e o DNS da Cloudflare | US$ 0 |
| Alertas de disponibilidade | UptimeRobot no `/healthz` | US$ 0 |
| Domínio | Qualquer registrador | cerca de US$ 10/ano |
| Pagamentos (opcional) | Stripe | taxas por transação |

### Perfis do Compose

O servidor sempre roda; o resto são perfis, escolhidos em `COMPOSE_PROFILES` no `deploy/.env`:

| Perfil | Serviço | Faz |
| --- | --- | --- |
| `tls` | Caddy | HTTPS com certificados automáticos; logs de acesso sem tokens, query strings nem hashes de fotos |
| `backup` | Litestream | Replicação contínua do banco para o R2, com 7 dias de pontos de restauração |
| `ai` | llama.cpp | Qwen2.5-1.5B-Instruct (Q4_K_M, cerca de 1,1 GB de RAM) só na rede interna; de 5 a 15 s por sugestão em 4 núcleos ARM |

```bash
cd deploy
cp .env.example .env && chmod 600 .env    # segredos, domínio, provedores
docker compose up -d --build              # perfis vindos de COMPOSE_PROFILES
curl -s https://sync.example.com/healthz  # {"ok":true,"db":"ok","ai":"ok",…}
```

O contêiner do servidor recebe uma lista fechada das variáveis que lê, nunca o `.env` inteiro, então
as chaves do Litestream (que podem sobrescrever os backups) nunca chegam ao processo da API.

### Os passos, em resumo

1. **Contas** (tarefa do dono): o domínio no DNS da Cloudflare, a Oracle Cloud (escolha a região
   principal com cuidado; `sa-saopaulo-1` para o Brasil), dois buckets no R2 com um token cada, o
   Resend com o domínio verificado, opcionalmente os client ids OAuth do Google e o Stripe, e o
   UptimeRobot.
2. **A VM**: abra as portas 80 e 443, instale o Docker, aponte `sync.<domínio>` para ela (só DNS).
3. **Configure** o `deploy/.env` e **suba** tudo.
4. **Aponte os apps**: a variável do repositório `ATOMIC_SERVER_URL` para os builds Android e
   desktop, `VITE_SERVER_URL` para o build web, `EXPO_PUBLIC_SERVER_URL` em `apps/native/eas.json`.
5. **Monitore** o `/healthz` com o UptimeRobot (palavra-chave `"ok":true`).
6. **Faça backup**: o Litestream continuamente, mais um snapshot noturno com o `backup.sh` copiado
   para fora da máquina.
7. **Rode o simulado de restauração uma vez** (`restore.sh`) e registre o resultado; depois, a cada
   três meses.

O runbook completo, com comandos, solução de problemas e passos de atualização, está no
[`deploy/README.md`](https://github.com/andeen171/atomic-habits/blob/claude/wizardly-davinci-dcrnwc/deploy/README.md)
(em inglês).

### Outras montagens

- **Turso em vez do arquivo SQLite:** defina `DATABASE_URL=libsql://…` e `DATABASE_AUTH_TOKEN` e tire
  `backup` dos perfis (o Turso tem a própria restauração a qualquer momento). Serve também para
  hospedagens sem disco persistente.
- **Fotos no volume em vez do R2:** `BLOB_STORAGE=disk` (com backup pelo `backup.sh`, não pelo
  Litestream).
- **Um provedor de IA hospedado** em vez do llama.cpp: qualquer endpoint compatível com a OpenAI,
  com `AI_HOSTING=hosted` e `AI_PROVIDER_NAME` (a tela de consentimento informa o nome). Escolha um
  com contrato de retenção zero. O Ollama também funciona (`AI_BASE_URL=http://ollama:11434/v1`).
- **Uma alternativa paga:** uma VM ARM pequena (Hetzner CAX21, cerca de € 7/mês) roda o mesmo arquivo
  do Compose.

## Uma instância por banco

Rode **um** processo de servidor por banco de dados, nunca dois atrás de um balanceador de carga e
nunca dois contêineres no mesmo volume ou no mesmo banco Turso. Os números de sequência e a cota de
sincronização ficam no banco, mas os limites de taxa, a fila e o teto diário da IA, a trava de fotos
por usuário e a manutenção de hora em hora ficam na memória do servidor: uma segunda instância
dobraria todos eles, e dois processos fariam a limpeza das mesmas fotos.

## Atualizando

```bash
cd /opt/atomic && git pull
cd deploy && ./backup.sh
docker compose up -d --build     # as migrações rodam na inicialização
```

Atualize o **servidor antes dos apps**: um app mais novo deixa no aparelho, esperando, os dados que
o servidor ainda não conhece ("Seu servidor é mais antigo que este app") até o servidor alcançá-lo.
Nada se perde, mas também não ganha backup. As migrações só andam para a frente; voltar atrás exige
a versão anterior **e** o snapshot tirado antes da atualização.

## Suas responsabilidades

Se outras pessoas usam o seu servidor, você responde pelos dados delas. Defina `PRIVACY_URL` e
`TERMS_URL` (os apps mostram os links), informe por quanto tempo os backups guardam contas
excluídas e leia [Privacidade](/pt-br/reference/privacy/) para saber o que o servidor guarda e o
que ele nunca registra.

O protocolo em si está descrito em [Protocolo de sincronização](/pt-br/development/sync/).
