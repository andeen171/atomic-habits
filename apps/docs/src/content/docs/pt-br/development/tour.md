---
title: Tour pelo código
description: Onde cada funcionalidade mora no monorepo do Atomic, incluindo os módulos e telas da v2.
sidebar:
  order: 2
---

O Atomic é um monorepo Bun + Turborepo. Um pacote TypeScript guarda a lógica do produto; quatro
apps a colocam na tela, mantêm tudo sincronizado ou documentam.

```text
packages/core/   @atomic/core: modelo, regras, store, persistência, i18n, conteúdo, tokens, cliente de sync
apps/web/        App web React, PWA, casca desktop Tauri, build de artifact do claude.ai
apps/native/     App Expo para Android e iOS
apps/server/     Servidor de sync e Atomic Cloud (Hono, tRPC, Better Auth, Drizzle, libSQL)
apps/docs/       Este site (Astro Starlight)
deploy/          Receita de produção: Docker Compose, Caddy, Litestream, llama.cpp, runbook
assets/brand/    Fontes do logo e dos ícones
docs/            Docs internas: spec de design, spec da v2 e anexos, arquitetura, padrões
.github/         Workflows de CI, Android e desktop
```

## Como os dados fluem

```text
Evento da UI → store.actions.* → commit (um set, origem local|remote|derived)
                 ├─→ hooks (@atomic/core/react) → UI
                 ├─→ persist (com debounce, chaves divididas) → IndexedDB / kv do SQLite
                 ├─→ sync.pending (com login) → controlador de sync → servidor
                 └─→ subscribeCommits → comemorações, vibração (só commits locais)
```

Os apps nunca escrevem estado por conta própria; eles chamam ações e leem por hooks e seletores. É
por isso que a web e o celular se comportam igual.

## `packages/core/src`

| Arquivo | O que guarda |
| --- | --- |
| `model.ts`, `primitives.ts` | Schemas zod de todas as entidades, configurações, o arquivo de exportação, `COLLECTIONS`, `SCHEMA_REV` |
| `upgrade.ts` | `upgradeRecord`: atualizações de dados antigos, registro a registro, antes do parse |
| `dates.ts`, `text.ts` | Chaves de dia locais, contas de semana e mês; normalização de texto segura no Hermes |
| `habits.ts`, `agenda.ts` | Streaks, força, votos, estatísticas, a agenda de Hoje, resumo dos Insights, mais fortes / libertando-se |
| `month.ts`, `month-events.ts` | Metas do mês, ritmo, meses conquistados, sugestões de subir de nível, o evento de mês conquistado |
| `today-cards.ts` | Quais cartões Hoje mostra, em que ordem, acima ou abaixo dos hábitos |
| `blueprint.ts`, `content.ts` | Frases da planta e espaços do quadro; princípios, modelos, ícones automáticos |
| `recurrence.ts`, `tasks.ts`, `repeat-labels.ts`, `setup.ts` | Tarefas recorrentes, agenda e grupos de tarefas, rótulos de repetição, tarefas de preparo |
| `journal.ts`, `journal-review.ts` | Tipos de entrada do diário, perguntas, busca, convites, revisões, Cachinhos Dourados, contratos |
| `trackers/` | A estrutura de registros: `schema`, `meta`, `registry`, `defs/<tipo>.ts` (12 registros), `forms`, `summary`, `measure`, `reconcile`, `normalize`, `actions`, `timer`, `suggest`, `react` |
| `money.ts`, `attachments.ts` | Moedas e leitura de valores; referências de fotos e contratos de blobs |
| `actions/` | Ações do store da v2 por área: `habits-v2`, `tasks`, `journal`, `cloud` |
| `store.ts` | O store zustand: commit, ligação com a persistência, importação/exportação, `applyRemote` |
| `storage.ts`, `persist-layout.ts`, `indexes.ts` | Backends de armazenamento (IndexedDB, localStorage, memória), o layout dividido e a hidratação, índices compartilhados |
| `sync.ts`, `sync-engine.ts`, `sync-controller.ts` | Protocolo v2, uma rodada de sync, a sessão (timers, nova tentativa, relógio, decisão de mesclagem) |
| `remote.ts`, `remote-account.ts`, `account.ts`, `account-controller.ts` | Clientes HTTP e os contratos e fluxos de conta |
| `ai.ts`, `ai-client.ts`, `complete.ts`, `translate.ts` | Contratos e cliente de IA, sugestões de palavras no aparelho, glossário e tradução |
| `blob-sync.ts` | Backup de fotos (envio, download, limpeza local) |
| `demo.ts`, `flags.ts` | Dados de exemplo; flags de funcionalidade |
| `i18n/` | `en.ts`, `pt-BR.ts`, os catálogos por área em `v2/` e o tradutor |
| `theme.ts` | Paletas, cores dos hábitos, contraste, escala tipográfica, espaçamento, movimento |
| `react.ts`, `react-*.ts` | `AtomicProvider` e todos os hooks (o único ponto de entrada React) |

Pontos de entrada do pacote: `@atomic/core`, `@atomic/core/react`, `@atomic/core/sync` e
`@atomic/core/theme`. Os testes ficam em `packages/core/test`. Mais detalhes em
[O motor do núcleo](/pt-br/development/core/).

## `apps/web`

- `src/main.tsx` cria o roteador (histórico por hash; em memória no build de artifact) e inicia o
  controlador de sync, a tradução e o sync de fotos (nunca no artifact).
- `src/routes/` (TanStack Router, por arquivos):
  - `_app.tsx` é a casca (barra lateral no desktop, abas embaixo no celular).
  - `_app/index.tsx` Hoje, `_app/habits/` lista e detalhe, `_app/tasks.tsx`,
    `_app/journal/index.tsx`, `_app/identity.tsx`, `_app/insights.tsx`, `_app/scorecard.tsx`,
    `_app/account.tsx`, `_app/settings.tsx`, `_app/you.tsx`.
  - Rotas em tela cheia: `habits/new.tsx` e `habits/$habitId.edit.tsx` (editor),
    `habits/$habitId.timer.tsx` e `habits/$habitId.write.tsx` (timer e bloco de escrita dos
    registros), `journal/new.tsx` e `journal/$entryId.tsx` (editor do diário), `onboarding.tsx`.
- `src/components/`, por área:

  | Pasta | Destaques da v2 |
  | --- | --- |
  | `today/` | `principle-card.tsx` (PrincipleHero), `banners.tsx`, `status-cards.tsx`, `today-tasks.tsx` |
  | `habit/` | `blueprint-board.tsx` + `blueprint-slot-editor.tsx`, `month-goal-card.tsx`, `month-bars.tsx`, `level-up-card.tsx`, `month-behind-card.tsx`, `log-amount-dialog.tsx`, `setup-tasks-card.tsx` |
  | `editor/` | Passos com a identidade primeiro (`draft.ts`, `editor-steps.tsx`), `setup-task-{toggle,adder}.tsx`, `setup-tasks-review.tsx` |
  | `tasks/` | `task-row.tsx`, `repeat-field.tsx`, `series-history.tsx`, `habit-link-field.tsx`, o diálogo da tarefa |
  | `journal/` | Escolha do tipo, editor e blocos, linha do tempo, filtros, cartões de entrada e de nota do dia, cartão de convite, seções do hábito e da identidade |
  | `trackers/` | Compositor de entradas, campos, painel do registro e resumos, gráficos, lista de entradas, estante, aviso de timer, campo / miniatura / visualizador de fotos, escolha e ajustes do registro |
  | `account/` | Diálogos de login e de mesclagem, plano, uso, perfil, segurança, aparelhos, dados, exclusão, ajustes de IA, avisos da nuvem |
  | `ai/` | `ai-suggest.tsx`, `ai-consent-dialog.tsx`, `translated-text.tsx` |
  | `principles/`, `insights/`, `identity/`, `layout/`, `settings/`, `dialogs/`, `ui/` | Citação de princípio; gráfico composto, cartão do platô, hábitos mais fortes; cartões de identidade; casca e navegação; linhas de ajustes; componentes base (`ui/smart-input.tsx` traz as sugestões de palavras) |
- `src/lib/`: `store.ts` (store no IndexedDB, mesclagem entre abas), `sync.ts`, `account.ts`,
  `ai.ts`, `blob-store.ts` e `image.ts` (fotos), `timer-store.ts` e `bell.ts`,
  `use-tracker-actions.ts`, `use-habit-logger.ts`, `use-month-celebration.ts`,
  `journal-dismissals.ts`, `prefs.ts`, `artifact-cloud.ts` (armazenamento do build do claude.ai),
  `pwa.ts`, `use-shortcuts.ts`, `focus.ts`.
- `plugins/atomic-tokens.ts` transforma os tokens de design do núcleo em variáveis CSS no build.
- `src-tauri/` é a casca desktop (Tauri 2). Ela carrega o mesmo `dist/`.
- `scripts/artifact-page.ts` transforma o build de arquivo único numa página de artifact do
  claude.ai.

## `apps/native`

- `app/` (Expo Router):
  - `(tabs)/` tem Hoje (`index`), Hábitos, Tarefas e Você.
  - `habit/[id]`, `habit/editor`, `habit/timer`, `habit/write`, `task/[id]`, `journal/index`,
    `journal/editor`, `identity`, `insights`, `scorecard`, `account`, `settings`, `onboarding`.
- `components/`: as mesmas áreas do app web, feitas com primitivos do React Native. Sheets
  (`components/sheet/`) substituem os diálogos da web, por exemplo `blueprint-slot-sheet.tsx`,
  `log-amount-sheet.tsx`, `entry-composer-sheet.tsx`, `auth-sheet.tsx`.
  `account/update-banner.tsx` avisa instalações por fora da loja sobre um APK mais novo.
- `lib/`
  - `store.ts`: o store sobre o `expo-sqlite/kv-store` (`kv.ts`), com os idiomas do aparelho.
  - `sync.ts`, `account.ts`, `ai.ts`, `google.ts`, `blob-transport.ts`: o cliente da nuvem; a
    sessão fica no SecureStore (`secure-kv.ts`).
  - `reminders.ts` com `reminder-sources/{tasks,review}.ts`: notificações de hábitos, tarefas e
    revisões semanais/mensais (identificadores `habit:`, `task:`, `review:`; `timer:` fica
    intocado).
  - `timer-store.ts`, `timer-notify.ts`, `blob-store.ts`, `image.ts`: registros e fotos.
  - `backup.ts`, `lifecycle.ts`, `haptics.ts`, `ui-store.ts`, `prefs.ts`.
- Arquivos `*.web.ts` são alternativas para o app também rodar com `expo start --web`.
- `app.json` e `eas.json` guardam o id do app (`dev.andeen.atomic`), ícones, splash, plugins
  (seletor de imagens, login com Google) e perfis de build.

## `apps/server`

- `src/index.ts`: `loadConfig(env)` → `createServer(config)` → migrações → `Bun.serve`.
- `src/config.ts`: todas as variáveis de ambiente, chaves de funcionalidade e travas de produção.
- `src/app.ts`: o app Hono: log de requisições sem conteúdo, CORS, limites de corpo por rota,
  Better Auth em `/api/auth/*`, tRPC em `/trpc/*`, rotas de fotos, páginas de conta e de cobrança.
- `src/meta.ts`: o handshake de capacidades `GET /trpc/meta`.
- `src/lib/auth.ts`: Better Auth (e-mail/senha, ID tokens do Google, bearer), rotas desligadas,
  limites de taxa; `src/account/`: proteção do vínculo com o Google, sessões, ZIP de exportação,
  limpeza da conta, páginas.
- `src/sync/service.ts`: push (upsert com a última escrita vencendo, regra de empate, cota de sync)
  e pull.
- `src/billing/`, `src/ai/`, `src/blobs/`, `src/email/`: Stripe e direitos do plano, o pipeline de
  IA, armazenamento de fotos (disco ou S3) e coleta de lixo, modelos de e-mail.
- `src/jobs/maintenance.ts`, `src/ops/`, `src/admin/` + `scripts/`: manutenção de hora em hora,
  `/healthz` e métricas, concessão de planos, backups, checagens de restauração, avaliação da IA.
- `src/db/`: o schema Drizzle e as migrações SQL (`0000_init.sql`, `0001_v2.sql`).
- `test/`: um servidor por suíte, com dublês locais de cada provedor.

A referência completa (cada variável, endpoint e regra) está no
[`apps/server/README.md`](https://github.com/andeen171/atomic-habits/blob/claude/wizardly-davinci-dcrnwc/apps/server/README.md).

## `deploy/`

`docker-compose.yml` (o servidor mais os perfis `tls`, `backup` e `ai`), `Caddyfile`,
`litestream.yml`, `.env.example`, `backup.sh`, `restore.sh` e o runbook `README.md`. Veja
[Hospedar o servidor](/pt-br/guides/self-hosting/).

## `docs/`

- `design.md`: a spec de produto e design (princípios, tokens, componentes, telas).
- `specs/atomic-v2.md` e `specs/annex-*.md`: a spec de implementação da v2, normativa para o
  comportamento descrito nestas páginas.
- `monorepo.md`, `stack.md`, `standards.md`: arquitetura, stack e convenções de código.

## `apps/docs`

Conteúdo Starlight em `src/content/docs/`. As páginas em inglês ficam na raiz e as em português em
`pt-br/`, com os mesmos nomes de arquivo. A barra lateral é definida em `astro.config.mjs`.
