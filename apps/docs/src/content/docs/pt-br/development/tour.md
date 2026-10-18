---
title: Tour pelo código
description: Onde fica cada funcionalidade no monorepo do Atomic.
sidebar:
  order: 2
---

O Atomic é um monorepo Bun + Turborepo. Um pacote TypeScript guarda a lógica do produto, e quatro
apps a mostram na tela ou a mantêm sincronizada.

```text
packages/core/   @atomic/core: modelo, regras, store, i18n, conteúdo, tokens, sync
apps/web/        App web React, PWA, casca desktop Tauri e build de artefato do claude.ai
apps/native/     App Expo para Android e iOS
apps/server/     Servidor de sync opcional (Hono, tRPC, Better Auth, Drizzle, libSQL)
apps/docs/       Este site (Astro Starlight)
assets/brand/    Fontes do logo e dos ícones
docs/            Docs internas: especificação de design, arquitetura, padrões
.github/         Workflows de CI, Android e desktop
```

## Como os dados fluem

```text
evento na UI → store.actions.* → estado zustand ─┬─→ hooks (@atomic/core/react) → UI
                                                 ├─→ persistência (em lote) → localStorage / SQLite
                                                 └─→ sync.pending → controlador de sync → servidor
```

Os apps nunca escrevem o estado por conta própria: chamam actions e leem por hooks e seletores.
Por isso web e mobile se comportam igual.

## `packages/core`

| Arquivo | O que contém |
| --- | --- |
| `model.ts` | Schemas zod de cada entidade, configurações, arquivo de exportação e `COLLECTIONS` |
| `dates.ts` | Chaves de dia locais (`YYYY-MM-DD`), contas de semana/mês, leitura de horários |
| `habits.ts` | Streaks (nunca falhar duas vezes), força, taxas de conclusão, votos, progresso semanal, estatísticas |
| `agenda.ts` | O que a tela Hoje mostra em um dia, estatísticas de identidade, resumo dos Insights |
| `tasks.ts` | Grupos de tarefas (atrasadas, hoje, amanhã, próximas, algum dia, concluídas) e ordenação |
| `blueprint.ts` | O blueprint legível do hábito e os rótulos de frequência, progresso e streak |
| `content.ts` | Princípios do livro, modelos de hábito e identidade, opções de emoji |
| `demo.ts` | Quatro meses de dados de exemplo ("Explorar com dados de exemplo") |
| `store.ts` | O store zustand: actions, persistência, importar/exportar, `applyRemote` |
| `storage.ts` | Adaptadores chave/valor e a persistência em lote com flush |
| `sync.ts`, `sync-engine.ts`, `sync-controller.ts`, `remote.ts` | Protocolo, rodadas, sessão e cliente HTTP do sync |
| `i18n/` | `en.ts`, `pt-BR.ts` e o tradutor (plurais, interpolação) |
| `theme.ts` | Paletas, cores de hábito, helpers de contraste, escala tipográfica, espaçamentos, movimento |
| `react.ts` | `AtomicProvider` e hooks como `useHabits` e `useDayAgenda` |

Pontos de entrada do pacote: `@atomic/core`, `@atomic/core/react`, `@atomic/core/sync` e
`@atomic/core/theme`. Os testes ficam em `packages/core/test`. Mais detalhes em
[O motor do núcleo](/pt-br/development/core/).

## `apps/web`

- `src/main.tsx` cria o router (histórico por hash; histórico em memória no build de artefato).
- `src/routes/`: rotas do TanStack Router baseadas em arquivos. `_app.tsx` é a casca (barra
  lateral no desktop, abas embaixo no celular). `_app/index.tsx` é a tela Hoje; ao lado ficam
  `habits`, `tasks`, `identity`, `insights`, `scorecard`, `settings` e `you`. O editor fica em
  `habits/new.tsx` e `habits/$habitId.edit.tsx`, e a primeira execução em `onboarding.tsx`.
- `src/components/`: agrupados por área (`today`, `habit`, `editor`, `tasks`, `identity`,
  `insights`, `settings`, `layout`, `dialogs`, `ui`).
- `src/lib/`
  - `store.ts`: o store em localStorage.
  - `sync.ts`: o controlador de sync.
  - `theme.tsx`: claro/escuro.
  - `focus.ts`: devolve o foco ao fechar diálogos e em listas.
  - `use-shortcuts.ts`: atalhos de teclado.
  - `artifact-cloud.ts`: armazenamento do build do claude.ai.
  - `pwa.ts`: registro do service worker.
- `plugins/atomic-tokens.ts` transforma os tokens de design do núcleo em variáveis CSS no build.
- `src-tauri/` é a casca desktop (Tauri 2). Ela carrega o mesmo `dist/`.
- `scripts/artifact-page.ts` transforma o build de arquivo único numa página de artefato do
  claude.ai.

## `apps/native`

- `app/`: telas do Expo Router. `(tabs)/` tem Hoje (`index`), Hábitos, Tarefas e Você. Ao lado
  ficam `habit/[id]` e `habit/editor`, `task/[id]`, `identity`, `insights`, `scorecard`,
  `settings` e `onboarding`.
- `components/`: as mesmas áreas do web, feitas com primitivas do React Native. Sheets
  (`components/sheet/`) substituem os diálogos da web.
- `lib/`
  - `store.ts`: o store em `expo-sqlite/kv-store` (`kv.ts`).
  - `sync.ts`: o controlador de sync; a sessão fica no SecureStore (`secure-kv.ts`).
  - `reminders.ts`: expo-notifications.
  - `backup.ts`: exportar/importar pela folha de compartilhamento e pelo seletor de documentos.
  - `lifecycle.ts`: salva ao ir para segundo plano e inicia o sync e os lembretes.
  - `theme.tsx`, `haptics.ts`, `ui-store.ts`: estado só de interface, como os toasts.
- Os arquivos `*.web.ts` são alternativas para o app rodar também com `expo start --web`.
- `app.json` e `eas.json` guardam o id do app (`dev.andeen.atomic`), ícones, splash e perfis de
  build.

## `apps/server`

- `src/index.ts` inicia o Bun, roda as migrações e serve o `src/app.ts`.
- `src/app.ts` é o app Hono: CORS, IP do cliente, limites de tamanho, Better Auth em
  `/api/auth/*` e tRPC em `/trpc/*`.
- `src/lib/auth.ts` configura o Better Auth (e-mail + senha, plugin bearer, endpoints não usados
  desativados).
- `src/trpc/routers/sync.ts` expõe `sync.push` (mutation) e `sync.pull` (query), implementados em
  `src/sync/service.ts`.
- `src/db/` tem o schema Drizzle (`auth.ts`, `sync.ts`) e as migrações SQL.
- `test/` tem testes unitários de auth e sync e um teste ponta a ponta que usa o cliente real do
  núcleo.

## `apps/docs`

Conteúdo Starlight em `src/content/docs/`. As páginas em inglês ficam na raiz e as em português
em `pt-br/`, com os mesmos nomes de arquivo. O menu lateral é definido em `astro.config.mjs`.
