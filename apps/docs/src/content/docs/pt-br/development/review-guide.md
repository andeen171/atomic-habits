---
title: Guia de revisão — a reescrita do Atomic
description: O que o pull request da reescrita mudou, em que ordem ler e como verificar.
sidebar:
  order: 1
  label: Guia de revisão
---

A reescrita ([andeen171/atomic-habits#2](https://github.com/andeen171/atomic-habits/pull/2))
substitui o protótipo abandonado do `master` por um produto funcionando. O PR é grande (cerca de
420 arquivos), mas a maior parte é interface. As partes que pedem revisão cuidadosa são pequenas
e bem testadas.

## Antes e depois

| | `master` antes | Depois da reescrita |
| --- | --- | --- |
| Lógica compartilhada | Nenhuma; cada app tinha seus próprios tipos | `packages/core` (`@atomic/core`) concentra modelo, regras, store, i18n, tokens de design e sync |
| Web | Protótipo Vite + TanStack Router (visões diária/semanal de hábitos, todos, login) | App completo: Hoje, Hábitos, editor, Tarefas, Identidade, Insights, Scorecard, Ajustes, onboarding, paleta de comandos, PWA e desktop Tauri |
| Mobile | Template Expo 54 (drawer + abas) | App Expo SDK 57 com as mesmas funções, sheets nativos, vibração, lembretes e backups |
| Servidor | Starter Hono + tRPC + Better Auth com um router de todos | Servidor de sync opcional: Better Auth (bearer) + push/pull via tRPC + SQLite/libSQL |
| Docs | Páginas de exemplo do Starlight | Este site, em inglês e português |
| CI | Nenhum | Lint, typecheck, testes e builds; APKs Android e instaladores desktop a cada push |

## Ordem de leitura sugerida

Leia de dentro para fora: o núcleo decide o comportamento, e os apps só mostram o resultado.

1. **Modelo de dados:** `packages/core/src/model.ts`. Todas as entidades, validadas com zod.
   Comece aqui para aprender o vocabulário (hábito, log, identidade, tarefa, item do scorecard,
   configurações).
2. **Regras dos hábitos:** `packages/core/src/habits.ts` e `dates.ts`. Streaks, nunca falhar
   duas vezes, força do hábito, metas semanais e hábitos a abandonar. O arquivo
   `test/habits.test.ts` documenta as regras em forma de exemplos.
3. **Store:** `packages/core/src/store.ts` e `storage.ts`. Toda escrita passa por
   `store.getState().actions`. Leia `stamp()`, os tombstones e `importData`.
4. **Sync:** `packages/core/src/sync.ts` (protocolo), `sync-engine.ts` (uma rodada),
   `sync-controller.ts` (sessão e timers) e depois `apps/server/src/sync/service.ts`. Veja
   [Protocolo de sincronização](/pt-br/development/sync/).
5. **Web:** `apps/web/src/routes/_app/index.tsx` (Hoje) é a melhor porta de entrada. Siga os
   componentes até `components/today` e `components/habit`.
6. **Mobile:** `apps/native/app/(tabs)/index.tsx` é a mesma tela no Expo. Compare com a versão
   web para ver o que é compartilhado e o que é nativo.
7. **CI:** `.github/workflows/*.yml`. Veja [Fluxo, CI e releases](/pt-br/development/workflow/).

Os commits `wip:` podem ser lidos por cima; são checkpoints que commits posteriores substituem.
Fazer squash no merge não tem problema.

## Onde olhar com atenção

- **Segurança dos dados.** `storage.ts` nunca sobrescreve dados que não conseguiu ler. Um conteúdo
  corrompido é guardado como backup em `atomic-habits:corrupt:<hora>`. Importações são validadas
  antes de substituir qualquer coisa.
- **Convergência do sync.** Last-write-wins por documento, com tombstones para exclusões.
  Edições feitas durante uma rodada continuam pendentes, e em caso de conflito o servidor devolve
  a versão vencedora. `test/store.test.ts`, `test/regressions.test.ts` e
  `apps/server/test/*.test.ts` cobrem esses caminhos.
- **Segurança do servidor.** Só tokens bearer (sem cookies), por isso a checagem de CSRF fica
  desligada de propósito. Os endpoints do Better Auth que os apps não usam (verificação de e-mail,
  redefinição de senha, login social) estão desativados, erros internos não vazam e o tamanho das
  requisições é limitado. Veja `apps/server/src/lib/auth.ts` e `src/app.ts`.
- **Acessibilidade.** O contraste é testado em `packages/core/test/regressions.test.ts` ("theme
  contrast"). A gestão de foco na web fica em `apps/web/src/lib/focus.ts`.

## Como verificar

```bash
bun install
bun run lint && bun check-types && bun run test
bun dev:web        # http://localhost:3001 → "Explorar com dados de exemplo"
```

- **Android:** instale o `atomic-dev-client-<sha>.apk` da
  [release `android-preview`](https://github.com/andeen171/atomic-habits/releases/tag/android-preview),
  rode `bun dev:native` e abra o app para conectar ao Metro.
- **Desktop:** instaladores na
  [release `desktop-preview`](https://github.com/andeen171/atomic-habits/releases/tag/desktop-preview).
- **Sync:** rode `bun dev:server` e crie uma conta em **Ajustes → Sincronização** em dois
  aparelhos (ou dois perfis do navegador) apontando para a mesma URL de servidor.

## Lacunas conhecidas

- O APK e os instaladores desktop são gerados no CI, mas não foram rodados em aparelhos reais.
- Ainda não há servidor de sync hospedado. Veja
  [Hospedar a sincronização](/pt-br/guides/self-hosting/).
- O build iOS está configurado (`app.json`, `eas.json`), mas não roda no CI.
