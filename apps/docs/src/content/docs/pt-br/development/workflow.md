---
title: Fluxo, CI e releases
description: Comandos do dia a dia, checagens, pipelines de CI, releases de prévia e deploys.
sidebar:
  order: 5
---

## Preparação

Requisitos: [Bun](https://bun.sh) 1.4+ (fixado em `package.json` → `packageManager`). O app
desktop também precisa de Rust. Builds nativos locais precisam do Android SDK (ou do Xcode para
iOS).

```bash
bun install          # instala todos os workspaces (hoisted, veja bunfig.toml)
```

## Comandos do dia a dia

| Comando | O que faz |
| --- | --- |
| `bun dev:web` | App web em http://localhost:3001 |
| `bun dev:native` | Servidor Expo (Metro) para o APK dev-client, um simulador ou `w` para web |
| `bun dev:server` | Servidor de sync em http://localhost:3000 (hot reload) |
| `cd apps/web && bun desktop:dev` | App desktop Tauri em volta do servidor de dev web |
| `cd apps/docs && bun dev` | Este site de documentação |
| `bun run lint` / `bun check` | Checagem de lint e formatação do Biome / aplica as correções |
| `bun check-types` | `tsc --noEmit` no núcleo, web, native e servidor |
| `bun run test` | Testes do núcleo e do servidor |
| `bun run build` | Build de todos os apps |
| `bun run build:artifact` | Build web em arquivo único (`apps/web/dist-artifact/atomic.html`) |

Um hook de pre-commit do Husky roda o Biome nos arquivos em stage (`lint-staged`). Estilo do
código: tabs, 100 colunas, regras recomendadas do Biome (`biome.json`); as convenções estão em
`docs/standards.md`.

## Antes de dar push

```bash
bun run lint && bun check-types && bun run test
```

É exatamente o que o CI roda primeiro, então passar localmente significa passar no CI (a menos
que algum build quebre).

## Pipelines de CI

Todos os workflows rodam em pushes para `master`, `main` e `claude/**`. O `ci.yml` também roda em
pull requests.

| Workflow | Quando roda | O que faz |
| --- | --- | --- |
| `ci.yml` (CI) | Todo push e PR | Biome, `tsc` no núcleo, servidor, web e native, testes do núcleo e do servidor, build web e build do artefato. Publica o artefato `atomic-web` |
| `android.yml` (Android APK) | Mudou `apps/native`, `packages/core` ou `bun.lock` | Checagens do núcleo → `expo prebuild` → Gradle `assembleRelease` + `assembleDebug` (arm64) → pre-release contínua `android-preview` |
| `desktop.yml` (Desktop) | Mudou `apps/web`, `packages/core` ou `bun.lock` | Builds Tauri no Ubuntu, Windows e macOS → pre-release contínua `desktop-preview` |

Os dois workflows de release também podem ser disparados à mão pela aba Actions
(`workflow_dispatch`).

## Releases de prévia

- [`android-preview`](https://github.com/andeen171/atomic-habits/releases/tag/android-preview)
  - `atomic-<sha>.apk`: o app completo.
  - `atomic-dev-client-<sha>.apk`: um build com `expo-dev-client`. Instale, rode
    `bun dev:native` num computador na mesma rede e abra o app para carregar o JavaScript do Metro
    com hot reload.
  - Os dois são assinados com a keystore de debug. A assinatura de produção passa pelo EAS
    (`apps/native/eas.json` → `production`).
- [`desktop-preview`](https://github.com/andeen171/atomic-habits/releases/tag/desktop-preview):
  `.exe` / `.msi` (Windows), `.dmg` (macOS Apple Silicon), `.AppImage` / `.deb` / `.rpm` (Linux).
  Os instaladores não são assinados.

Cada execução substitui os arquivos, então as releases sempre apontam para o build mais recente
da última branch que rodou.

## EAS Build (opcional)

`apps/native/eas.json` tem os perfis `development`, `preview` e `production`:

```bash
cd apps/native
bunx eas-cli build --profile preview --platform android
```

O id do projeto Expo e o dono estão em `app.json`.

## Deploys

Os projetos da Vercel estão ligados a este repositório:

| Projeto | App | URL de produção |
| --- | --- | --- |
| `atomic-habits-web` | `apps/web` (Vite, `dist/`) | https://atomic-habits-web.vercel.app |
| `atomic-habits-docs` | `apps/docs` (Astro) | https://atomic-habits-docs.vercel.app |

- Toda branch enviada ganha deploys de preview. Um merge no `master` atualiza a produção.
- A Vercel pula um projeto quando o commit não mexe nele, e esses deploys aparecem como
  *Canceled*. Isso é esperado, não é falha.
- Os previews ficam atrás do Vercel Authentication. Os domínios de produção são públicos.

O build web é estático. O app guarda os dados no aparelho, então nenhuma variável de ambiente é
necessária. O servidor de sync não é publicado por esses projetos; veja
[Hospedar a sincronização](/pt-br/guides/self-hosting/).

## Testes

| Suíte | Onde | Cobre |
| --- | --- | --- |
| Núcleo | `packages/core/test` | Datas, regras dos hábitos, store, persistência, importar/exportar, i18n, cliente HTTP, regressões (convergência do sync, contraste) |
| Servidor | `apps/server/test` | Auth (só bearer, endpoints desativados), push/pull, conflitos, limites, sync ponta a ponta pelo cliente do núcleo |

As interfaces ainda não têm testes automatizados. Mudanças nelas foram conferidas à mão e com
scripts Playwright durante a reescrita.
