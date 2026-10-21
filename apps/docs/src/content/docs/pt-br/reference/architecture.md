---
title: Arquitetura
description: Como o monorepo do Atomic é organizado.
sidebar:
  order: 1
---

```text
apps/
  web/      React 19 + Vite + TanStack Router + Tailwind v4 (também o app desktop Tauri e a PWA)
  native/   Expo SDK 57 + Expo Router (Android / iOS)
  server/   Bun + Hono + tRPC + Drizzle + Better Auth: sync, contas, cobrança, IA beta, fotos
  docs/     Este site (Astro Starlight)
packages/
  core/     Motor compartilhado usado por todos os apps
deploy/     Receita de produção do Atomic Cloud (Docker Compose, Caddy, Litestream, llama.cpp)
```

O `@atomic/core` guarda tudo o que precisa se comportar igual em todas as plataformas:

- o modelo de domínio e a validação (Zod), com nove coleções sincronizadas,
- as contas de calendário e a ciência dos hábitos (sequências, força, votos, metas do mês, subir de
  nível),
- tarefas recorrentes, o diário e os doze registros,
- o store zustand com persistência dividida (IndexedDB na web, SQLite no celular),
  exportação/importação e dados de exemplo,
- as traduções (inglês e português do Brasil), o conteúdo inspirado no livro, as sugestões ao
  digitar e o glossário dos modelos,
- os tokens de design (cores, tipografia, espaçamentos, movimento),
- o protocolo e o motor de sincronização e os clientes de conta e de IA.

O ponto de entrada principal não usa React (o servidor o importa); os hooks ficam em
`@atomic/core/react`.

Os apps são interfaces finas e nativas de cada plataforma por cima dele. O servidor é opcional para
os apps e roda sem nenhuma configuração como um servidor de sincronização simples; e-mail, login
com Google, cobrança, IA e backup de fotos ligam cada um com as suas variáveis de ambiente.

```text
 aparelho                                      servidor (opcional)
┌───────────────────────────────┐   HTTPS    ┌──────────────────────────────┐
│ UI → ações → store → persist. │  push/pull │ Better Auth · tRPC · /blobs  │
│ dividida (IndexedDB/SQLite)   │ ─────────► │ SQLite / Turso · disco / S3  │
│ controlador de sync · fotos   │ ◄───────── │ pipeline de IA (llama.cpp)   │
└───────────────────────────────┘   meta     └──────────────────────────────┘
```

Rode `bun test` em `packages/core` para a suíte de testes da lógica. Para um passeio arquivo por
arquivo, veja [Tour pelo código](/pt-br/development/tour/); para a camada de dados,
[O motor do núcleo](/pt-br/development/core/); para o protocolo,
[Protocolo de sincronização](/pt-br/development/sync/).
