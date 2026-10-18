---
title: Arquitetura
description: Como o monorepo do Atomic é organizado.
---

```text
apps/
  web/      React 19 + Vite + TanStack Router + Tailwind v4 (também o app desktop Tauri e a PWA)
  native/   Expo SDK 57 + Expo Router (Android / iOS)
  server/   Bun + Hono + tRPC + Drizzle + Better Auth (sync opcional)
  docs/     Este site (Astro Starlight)
packages/
  core/     Motor compartilhado usado por todos os apps
```

O `@atomic/core` guarda tudo o que precisa se comportar igual em todas as plataformas:

- o modelo de domínio e a validação (Zod),
- as contas de calendário e a ciência dos hábitos (sequências, força, votos, metas semanais),
- o store zustand com persistência, exportação/importação e dados de exemplo,
- as traduções (inglês e português do Brasil) e o conteúdo inspirado no livro,
- os tokens de design (cores, tipografia, espaçamentos, movimento),
- o protocolo, o motor e o cliente HTTP da sincronização.

Os apps são interfaces finas e nativas de cada plataforma por cima dele. Rode `bun test` em
`packages/core` para a suíte de testes da lógica. Para um passeio arquivo por arquivo, veja
[Tour pelo código](/pt-br/development/tour/).
