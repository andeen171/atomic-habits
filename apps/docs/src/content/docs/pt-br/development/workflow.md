---
title: Fluxo, CI e releases
description: Comandos do dia a dia, checagens, worktrees em paralelo, pipelines de CI, releases de prévia, deploys e a ordem de lançamento.
sidebar:
  order: 5
---

## Preparação

Requisitos: [Bun](https://bun.sh) 1.4+ (fixado em `package.json` → `packageManager`). O app
desktop também precisa de Rust. Builds nativos locais precisam do Android SDK (ou do Xcode para
iOS). Docker só é necessário para testar a stack de produção de `deploy/`.

```bash
bun install          # instala todos os workspaces (hoisted, veja bunfig.toml)
```

## Comandos do dia a dia

| Comando | O que faz |
| --- | --- |
| `bun dev:web` | App web em http://localhost:3001 |
| `bun dev:native` | Servidor de desenvolvimento do Expo (Metro) para o APK dev-client, um simulador ou `w` para web |
| `bun dev:server` | Servidor de sync em http://localhost:3000 (hot reload, sem configuração) |
| `cd apps/web && bun desktop:dev` | App desktop Tauri em volta do servidor de desenvolvimento web |
| `cd apps/docs && bun dev` | Este site de documentação |
| `bun run lint` / `bun check` | Checagem de lint + formatação do Biome / aplica correções no **repositório inteiro** |
| `bunx biome check --write <caminhos>` | Aplica correções só nos arquivos que você mudou |
| `bun check-types` | `tsc --noEmit` no núcleo, web, nativo e servidor |
| `bun run test` | Suítes de teste do núcleo e do servidor |
| `bun run build` | Build de todos os apps |
| `bun run build:artifact` | Build web em arquivo único (`apps/web/dist-artifact/atomic.html`; `ARTIFACT_OUT_DIR` muda o destino) |

Um hook de pre-commit do Husky roda o Biome nos arquivos em stage (`lint-staged`). Estilo de
código: tabs, 100 colunas, regras recomendadas do Biome (`biome.json`); as convenções estão em
`docs/standards.md`.

## Antes de dar push

```bash
bun run lint && bun check-types && bun run test
```

É exatamente o que o CI roda primeiro, então uma execução local verde significa CI verde (a menos
que um build quebre). Numa mudança nos apps, gere também o build web e exporte o bundle nativo:

```bash
cd apps/web && bunx vite build --outDir /tmp/web-check
cd apps/web && ARTIFACT_OUT_DIR=/tmp/artifact-check bun run build:artifact
cd apps/native && bunx expo export --platform android --output-dir /tmp/expo-check
```

## Trabalho em paralelo: worktrees

A v2 foi construída por várias frentes ao mesmo tempo (hábitos, tarefas, diário, registros,
cliente da nuvem, servidor), cada uma dona de um conjunto de arquivos (spec §8.3). Há dois jeitos
de fazer isso sem uma atrapalhar a outra:

**Preferido: uma worktree por frente.** Depois de um commit de fundação comum, o integrador cria uma
worktree e um branch para cada frente e faz o merge a cada entrega de marco:

```bash
git worktree add ../atomic-T3 -b v2/T3
cd ../atomic-T3 && bun install --frozen-lockfile
# … trabalha, verifica, entrega …
git worktree remove ../atomic-T3      # depois do merge
```

Como cada arquivo tem um único dono, os merges não dão conflito. Os agentes das frentes nunca criam
branches, fazem commit ou push por conta própria; isso é com o integrador.

**Alternativa: uma árvore compartilhada.**

- Gere builds em pastas temporárias (`vite build --outDir <tmp>/web-<frente>`,
  `ARTIFACT_OUT_DIR=<tmp>/artifact-<frente>`), para que builds em paralelo não apaguem o `dist` uns
  dos outros.
- Rode `bunx biome check --write` só nos seus caminhos. Nunca `bun check`: ele reescreve todos os
  arquivos do repositório, inclusive os que outra frente está editando.
- O integrador faz um commit `wip:` de checkpoint a cada entrega.
- Edite em trechos pequenos, releia o arquivo antes de editar e nunca sobrescreva um arquivo que
  não é seu.

**Arquivos compartilhados.** A camada de dados (`model`, `store`, `sync`, `storage`,
`persist-layout`, `upgrade`, `indexes`, `primitives`, `text`, `dates`), os catálogos base de i18n,
`package.json`, `bun.lock`, `app.json` e `eas.json` ficam congelados depois da fundação: para um bug
na camada de dados, escreva um teste que falha no seu próprio arquivo de teste e entregue ao dono
da fundação. Textos novos vão no arquivo da sua área em `src/i18n/v2/<área>.*.ts`. Preferências do
aparelho usam chaves com o prefixo `atomic-habits:`.

## Pipelines de CI

Todos os workflows rodam em pushes para `master`, `main` e `claude/**`. O `ci.yml` também roda em
pull requests.

| Workflow | Quando roda | O que faz |
| --- | --- | --- |
| `ci.yml` (CI) | Todo push e PR | Biome, `tsc` no núcleo, servidor, web e nativo, testes do núcleo e do servidor, build web e build do artifact. Publica o `atomic-web` |
| `android.yml` (APK Android) | Mudanças em `apps/native`, `packages/core` ou `bun.lock` | Checagens do núcleo → `expo prebuild` → Gradle `assembleRelease` + `assembleDebug` (arm64) → pré-release contínua `android-preview` |
| `desktop.yml` (Desktop) | Mudanças em `apps/web`, `packages/core` ou `bun.lock` | Builds Tauri no Ubuntu, Windows e macOS → pré-release contínua `desktop-preview` |

Os dois workflows de release também podem ser disparados à mão pela aba Actions
(`workflow_dispatch`). Eles embutem a URL do servidor oficial no build a partir da variável do
repositório `ATOMIC_SERVER_URL` (`EXPO_PUBLIC_SERVER_URL` / `VITE_SERVER_URL`). Enquanto ela não
existir, os apps não têm o padrão "Atomic Cloud" e pedem a URL de um servidor.

## Releases de prévia

- [`android-preview`](https://github.com/andeen171/atomic-habits/releases/tag/android-preview)
  - `atomic-<sha>.apk`: o app completo.
  - `atomic-dev-client-<sha>.apk`: um build `expo-dev-client`. Instale, rode `bun dev:native` num
    computador na mesma rede e abra o app para carregar o JavaScript do Metro com hot reload.
  - Os dois são assinados com a keystore de debug. A assinatura de produção passa pelo EAS
    (`apps/native/eas.json` → `production`).
- [`desktop-preview`](https://github.com/andeen171/atomic-habits/releases/tag/desktop-preview):
  `.exe` / `.msi` (Windows), `.dmg` (macOS Apple Silicon), `.AppImage` / `.deb` / `.rpm` (Linux).
  Os instaladores não são assinados.

Cada execução substitui os arquivos, então as releases sempre apontam para o build mais recente do
último branch que rodou. APKs instalados por fora da loja ficam sabendo de versões novas pelo
servidor: com `ANDROID_LATEST_VERSION` e `ANDROID_DOWNLOAD_URL` definidos, o app mostra o aviso
"O Atomic {versão} está disponível", com um botão "Baixar".

## EAS Build (opcional)

O `apps/native/eas.json` tem os perfis `development`, `preview` e `production`:

```bash
cd apps/native
bunx eas-cli build --profile preview --platform android
```

`EXPO_PUBLIC_BILLING_UI` vale `external` nos builds de desenvolvimento e de prévia (o checkout do
Stripe abre no navegador) e `status` nos builds de produção para as lojas (o plano aparece, nada é
vendido, como as regras das lojas exigem). O id e o dono do projeto Expo estão em `app.json`.

## Deploys

| O quê | Onde | Observações |
| --- | --- | --- |
| App web (`apps/web`, estático) | Vercel `atomic-habits-web` → https://atomic-habits-web.vercel.app | Vai para o Cloudflare Pages antes de o Stripe entrar em produção (o plano Hobby da Vercel proíbe uso comercial) |
| Docs (`apps/docs`, Astro) | Vercel `atomic-habits-docs` → https://atomic-habits-docs.vercel.app | |
| Atomic Cloud (`apps/server`) | Docker Compose numa VM, conforme o [`deploy/README.md`](https://github.com/andeen171/atomic-habits/blob/claude/wizardly-davinci-dcrnwc/deploy/README.md) | Veja [Hospedar o servidor](/pt-br/guides/self-hosting/) |

- Todo branch enviado ganha deploys de prévia na Vercel. O merge no `master` atualiza a produção.
- A Vercel pula um projeto quando o commit não mexe nele, e esses deploys aparecem como
  *Canceled*. É esperado, não é falha.
- As prévias ficam atrás do Vercel Authentication. Os domínios de produção são públicos.

## Ordem de lançamento

**Primeiro o servidor, depois web e desktop, depois Android.**

1. **Publique o servidor** (Atomic Cloud). O lançamento da v2.0 fica bloqueado até ele estar no ar,
   o simulado de restauração ter rodado uma vez e o monitor de disponibilidade estar ligado.
2. **Lance web e desktop.**
3. **Lance o Android.**

Por que essa ordem: um cliente só envia uma coleção que o servidor lista em `GET /trpc/meta` e
deixa o resto pendente. Um cliente lançado antes do servidor não perde nada (a pessoa vê "servidor
desatualizado"), mas não consegue fazer backup dos dados novos até o servidor alcançá-lo. Com o
servidor primeiro, todo cliente sincroniza tudo desde a primeira rodada. A mesma regra vale para
toda mudança futura que crie uma coleção ou amplie um schema (um novo `SCHEMA_REV`): publique o
servidor, depois os clientes. Quem hospeda o próprio servidor e atualiza tarde fica coberto pelas
regras de pendência ([Protocolo de sincronização](/pt-br/development/sync/#compatibilidade)).

Antes de o Stripe receber pagamentos reais, o app web muda para o Cloudflare Pages.

## Testes

| Suíte | Onde | Cobre |
| --- | --- | --- |
| Núcleo | `packages/core/test` | Datas, regras de hábito, metas do mês e subir de nível, recorrência, tarefas de preparo, diário, registros (todos os tipos), dinheiro, store e cada módulo de ações, persistência (layout dividido, migração para IndexedDB, entre abas, recuperação de dados corrompidos), hidratação (normalização e o limite de 50 ms), validação do protocolo por coleção, motor e controlador de sync (novo pull, superados, pendências mantidas, empates), sugestões de palavras, tradução, cliente de IA, sync de fotos, paridade de i18n, o grafo de imports sem React |
| Servidor | `apps/server/test` | Configuração, `meta`, sync (códigos, cota, empates, limites de taxa), autenticação (rotas desligadas, proteção do Google, redefinição, exclusão), limites de e-mail, conta (sessões, ZIP de exportação, limpeza), cobrança e direitos do plano (Stripe falso), IA (servidor de modelo falso; "conteúdo nunca registrado"), fotos (S3 falso), logs, manutenção, migrações, os arquivos de deploy e execuções ponta a ponta com dois clientes reais do núcleo |

As suítes do servidor usam dublês locais de Resend, Google, Stripe, servidor de modelo e S3; não
precisam de rede. As interfaces não têm testes automatizados; foram verificadas à mão e com
scripts do Playwright (a web e o export web do app nativo em tamanho de celular), nos temas claro
e escuro, em inglês e português.
