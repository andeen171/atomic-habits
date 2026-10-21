---
title: Guia de revisão — Atomic v2
description: O que a v2 mudou em cada um dos doze pedidos, onde fica, onde olhar com atenção e como verificar.
sidebar:
  order: 1
  label: Guia de revisão
---

O Atomic v2 entrega doze pedidos de produto na web, no desktop (Tauri) e no Android, mais um
servidor de produção (o "Atomic Cloud"). Ele parte da reescrita incorporada no
[#2](https://github.com/andeen171/atomic-habits/pull/2). Tudo o que veio depois desse merge está no
branch `claude/wizardly-davinci-dcrnwc`:

```bash
git diff --stat 7055f82..HEAD          # 7055f82 = o merge do #2
```

É grande (uns 640 arquivos alterados), mas o tamanho é desigual: metade são testes e duas
interfaces paralelas. As partes que pedem revisão cuidadosa são a camada de dados (persistência,
sync) e o código de segurança e privacidade do servidor, e as duas são pequenas perto do resto.

**O desenho está escrito.** O [`docs/specs/atomic-v2.md`](https://github.com/andeen171/atomic-habits/blob/claude/wizardly-davinci-dcrnwc/docs/specs/atomic-v2.md)
é normativo, com um anexo por área (`annex-h` hábitos, `annex-t` tarefas, `annex-j` diário,
`annex-k` registros, `annex-c` nuvem). A última seção, *Implementation notes*, lista cada desvio
deliberado feito na construção; leia antes de apontar uma divergência.

## Antes e depois

| | v1 (depois do #2) | v2 |
| --- | --- | --- |
| Coleções | 5 (`habits`, `logs`, `tasks`, `identities`, `scorecard`) | 9: mais `taskLogs`, `journal`, `trackerEntries`, `translations` |
| Armazenamento local | Uma chave no `localStorage` na web | IndexedDB com layout dividido por ano; mesclagem entre abas; aviso de falha ao salvar |
| Sync | Push/pull, a última escrita vence, URL do servidor digitada à mão | Protocolo v2: handshake `meta`, novo pull por `SCHEMA_REV`, documentos superados, códigos que mantêm pendência, lotes por bytes, cota, correção de relógio; Atomic Cloud por padrão |
| Contas | E-mail + senha | Mais verificação e redefinição por e-mail, Google, aparelhos, link de exportação, exclusão com limpeza completa |
| Negócio | — | Planos Grátis/Pro, Stripe (desligado se não configurado), IA beta, backup de fotos |
| Operação | Um Dockerfile | `deploy/`: Compose com Caddy, Litestream para o R2, llama.cpp, runbook, backups, simulado de restauração |
| Docs | Guia de desenvolvimento | Mais guias do diário, dos registros e da conta, uma referência de privacidade e a receita de hospedagem a custo zero |

## Ordem de leitura sugerida

1. **A tabela do §1 da spec** (uma linha por pedido) e o §2 (modelo de dados). Dez minutos aqui
   poupam uma hora no código.
2. **Fundação:** `packages/core/src/model.ts` (coleções, campos novos), `primitives.ts`,
   `upgrade.ts`, depois `persist-layout.ts` e `store.ts` (hidratação, `commit`, `stamp`). Veja
   [O motor do núcleo](/pt-br/development/core/).
3. **Sync:** `sync.ts` (protocolo, `validateWireRecord`, `compareVersions`), `sync-engine.ts`,
   `sync-controller.ts`, depois `apps/server/src/sync/service.ts`. Veja
   [Protocolo de sincronização](/pt-br/development/sync/).
4. **Uma área de cada vez**, núcleo primeiro, depois web, depois nativo, seguindo a lista abaixo.
5. **Servidor:** `apps/server/src/{config,server,app}.ts`, depois `lib/auth.ts`, `account/`, `ai/`,
   `blobs/`, `billing/`. O `apps/server/README.md` explica cada um.
6. **Deploy:** `deploy/README.md` (runbook) e `docker-compose.yml`.

Os commits `wip:` são checkpoints que commits posteriores substituem; fazer squash no merge não tem
problema.

## O que mudou, pedido por pedido

Os caminhos são relativos a `packages/core/src` (núcleo), `apps/web/src` (web) e `apps/native`
(nativo).

### 1. Meta do mês, compensar dias perdidos, subir de nível

- **O quê:** todo hábito ganha uma meta mensal derivada da meta diária e da frequência. Dias
  parciais contam o que foi feito, e um dia conta até **2×** a meta, então repetições extras
  compensam dias curtos. Estados: adiantado, no ritmo, atrasado (com o ritmo necessário), fora de
  alcance, conquistado, perdido, sem nada previsto. Depois de um mês forte, um cartão de **subir de
  nível** sugere uma meta maior e cita a evidência ("Você passou de 10 páginas em 24 de 30 dias em
  setembro"). "+1" visível quando a meta é atingida, e "Registrar quantidade…". Os meses
  conquistados aparecem nos Insights.
- **Onde:** núcleo `month.ts`, `month-events.ts`, `react-month.ts`, `today-cards.ts`,
  `actions/habits-v2.ts`; web e nativo `components/habit/{month-goal-card,month-bars,level-up-card,month-behind-card,log-amount-*}`.
- **Olhe com atenção:** `goalHistory` (meses passados mantêm a meta da época), o teto de 2×, hábitos
  semanais (a semana pertence ao mês do seu 4º dia) e que hábitos com registro medidos em dias não
  passam da meta (spec §9 D8, D8b, D10, D11).
- **Verifique:** `test/month.test.ts`, `month-events.test.ts`, `today-cards.test.ts`. Os dados de
  exemplo têm um mês digno de subir de nível no hábito "Ler".

### 2. Identidade primeiro; o hábito usa o ícone da identidade

- **O quê:** o editor começa por "Quem você quer se tornar?". O ícone do hábito segue o emoji da
  identidade (🌱 / 🚫 por padrão); o emoji de um modelo aparece como um atalho "Usar 📖" em vez de
  substituí-lo. Hábitos antigos com o "✨" padrão da v1 passam a ser automáticos.
- **Onde:** núcleo `content.ts` (`autoHabitEmoji`, `matchIdentityTemplate`), `upgrade.ts`,
  propagação de emoji no store; web `components/editor/*`, `routes/onboarding.tsx`; nativo
  `app/habit/editor.tsx`, `components/editor/fields.tsx`, `app/onboarding.tsx`.
- **Olhe com atenção:** `deriveAutoEmojis` **não** carimba nem marca pendência (todo aparelho deriva
  o mesmo valor), enquanto mudar o emoji de uma identidade **é** propagado e carimbado, para que
  clientes v1 também vejam.
- **Verifique:** `test/content.test.ts`, `hydration.test.ts`, `schema-v2.test.ts`. Crie um hábito
  numa identidade e depois troque o emoji da identidade.

### 3. Tarefas de preparo criadas junto com o hábito

- **O quê:** ao criar um hábito, o campo de ambiente (e, nos hábitos a abandonar, os de atrito e
  recompensa) também pode virar uma tarefa, única ou recorrente; tarefas de preparo livres podem
  ser adicionadas em todas as leis. A página do hábito tem o cartão "Tarefas de preparo", o quadro
  da planta tem o atalho "Transformar em tarefa", e mudar um campo vinculado oferece renomear a
  tarefa.
- **Onde:** núcleo `setup.ts`, `actions/tasks.ts` (`createSetupTasks`); `components/editor/setup-*`
  e `components/habit/setup-*` nos dois apps.
- **Olhe com atenção:** tarefas de preparo nunca votam; excluir o hábito as marca como excluídas com
  o **mesmo** timestamp, então restaurar traz exatamente elas de volta; renomear é sempre uma
  oferta, nunca automático.
- **Verifique:** `test/setup.test.ts`, `store-tasks-v2.test.ts`.

### 4. Tarefas recorrentes

- **O quê:** tarefas se repetem em dias fixos ou "após concluir", com data final ou número de
  vezes. Cada conclusão é um documento `taskLogs` com id determinístico (`taskId:date`), então dois
  aparelhos offline concluindo a mesma ocorrência geram um único log. Ocorrências perdidas viram
  uma só linha. Histórico da série. Lembretes no celular.
- **Onde:** núcleo `recurrence.ts`, `tasks.ts`, `repeat-labels.ts`, `react-tasks.ts`,
  `actions/tasks.ts`; web `components/tasks/*`, `routes/_app/tasks.tsx`; nativo
  `components/tasks/*`, `app/task/[id].tsx`, `lib/reminder-sources/tasks.ts`.
- **Olhe com atenção:** no modo "após concluir", o piso é o máximo entre **todos** os logs vivos,
  então uma mesclagem só pode empurrá-lo para a frente; "termina após N" conta logs concluídos; uma
  série marcada como concluída por um cliente v1 vira uma ocorrência concluída
  (`reconcileLegacySeries`).
- **Verifique:** `test/recurrence.test.ts`, `tasks.test.ts`, `series-sync.test.ts`,
  `wire-tasks.test.ts` e o `e2e.test.ts` do servidor (celular e notebook concluindo a mesma
  ocorrência offline).

### 5. Uma planta do hábito em destaque, editável no lugar

- **O quê:** o `BlueprintBoard` da página do hábito mostra quatro colunas de leis ("Torne-o óbvio ·
  Deixa"; nos hábitos a abandonar, os nomes invertidos, como "Torne-o invisível · Deixa"). Cada
  espaço mostra o texto da pessoa como título e o conceito do livro ("Intenção de implementação ·
  quando") como subtítulo, ou só o conceito quando vazio. Edição no lugar; "Preencher o próximo";
  cabeçalhos das leis fixos no celular.
- **Onde:** núcleo `blueprint.ts` (`blueprintPatch`, espaços, `weakestLaw`),
  `actions/habits-v2.ts` (`setBlueprintField`); `components/habit/blueprint-board.tsx` mais o editor
  do espaço (popover/diálogo na web, sheet no nativo).
- **Verifique:** `test/blueprint.test.ts`. Abra um hábito e preencha espaços pelo teclado (Enter
  salva, Esc cancela).

### 6. O diário de identidade

- **O quê:** um diário guiado, baseado no livro: nove tipos (evidência, perceber um hábito, plano
  de retomada, check-in Cachinhos Dourados, contrato de hábito, reescrever uma crença, revisão,
  Relatório de Integridade, nota livre), convites em Hoje, planos ligados ao "nunca falhe duas
  vezes", notas do dia na mesma linha do tempo, lembrete de revisão no celular e uma chave
  **Sincronizar diário** por aparelho. Veja o [guia do Diário](/pt-br/guides/journal/).
- **Onde:** núcleo `journal.ts`, `journal-review.ts`, `react-journal.ts`, `actions/journal.ts`; web
  `routes/_app/journal/*`, `routes/journal/*`, `components/journal/*`; nativo `app/journal/*`,
  `components/journal/*`, `lib/reminder-sources/review.ts`.
- **Olhe com atenção:** o diário **nunca** vai para a IA, para a tradução nem para o vocabulário de
  sugestões; evidências não somam votos; o editor salva sozinho e só cria a entrada na primeira
  mudança (abrir não grava nada); a resposta "fácil demais" do Cachinhos Dourados usa o valor de
  subir de nível quando ele existe (D9).
- **Verifique:** `test/journal.test.ts`, `journal-review.test.ts`, `store-journal.test.ts`,
  `wire-journal.test.ts`.

### 7. Os Insights mostram a estagnação

- **O quê:** o gráfico do 1% desenha três séries: 1% melhor, **ficar igual (uma linha tracejada em
  1,0×)** e 1% pior, com escala de raiz quadrada quando a curva de cima passa de 8×.
- **Onde:** núcleo `habits.ts` (`compounding().same`); `components/insights/compound-chart.tsx`
  (web), `components/charts/compound-chart.tsx` (nativo).
- **Verifique:** `test/habits.test.ts`; Insights com o período de 365 dias nos dados de exemplo.

### 8. O princípio do dia no topo

- **O quê:** um `PrincipleHero` logo abaixo do cabeçalho de Hoje (compacto no celular, dá para
  esconder no dia) e um `PrincipleQuote` no topo de Identidade e do Diário e no cabeçalho da planta
  (o princípio da lei mais fraca).
- **Onde:** núcleo `content.ts` (`principleById`, `lawPrinciple`);
  `components/today/principle-card.tsx`, `components/principles/principle-quote.tsx`.
- **Verifique:** `test/content.test.ts`.

### 9. O platô do potencial latente, perto do topo dos Insights

- **O quê:** um `PlateauCard` logo abaixo do gráfico do 1%, com uma frase pessoal.
- **Onde:** web `components/insights/plateau-card.tsx`; nativo `app/insights.tsx`. Só interface.

### 10. Os hábitos mais fortes são os bons

- **O quê:** "Hábitos mais fortes" lista só hábitos a construir, com uma lista separada
  "Libertando-se"; hábitos a abandonar mostram **Liberdade** em vez de Força em todo lugar.
- **Onde:** núcleo `agenda.ts` (`strongestHabits`, `breakingFreeHabits`);
  `components/insights/strongest-habits.tsx`, cartão do hábito e estatísticas do detalhe.
- **Verifique:** `test/agenda.test.ts`.

### 11. Hábitos feitos dentro do app

- **O quê:** uma estrutura de registros com 12 tipos (registro de gastos com orçamento, diário de
  leitura e estante, registro de treinos, timer, bloco de escrita, check-in ao acordar, registro de
  sono, planejar o amanhã, registro de conexões, diário de recaídas, diário de fotos, registro
  numérico). Todo modelo de identidade tem pelo menos um hábito com registro. As entradas escrevem a
  contagem do dia no log no mesmo commit, então streaks, metas e votos continuam funcionando. Fotos
  locais (obrigatórias) e backup de fotos. Veja o [guia dos Registros](/pt-br/guides/trackers/).
- **Onde:** núcleo `trackers/*`, `money.ts`, `attachments.ts`; web `components/trackers/*`,
  `routes/habits/$habitId.{timer,write}.tsx`, `lib/{blob-store,image}.ts`; nativo
  `components/trackers/*`, `app/habit/{timer,write}.tsx`; servidor `src/blobs/`.
- **Olhe com atenção:** registro estrito (um dia com registro só se conclui por entradas; o anel
  abre o registro), reconciliação que só escreve quando há diferença (sem pingue-pongue entre
  aparelhos), tipos desconhecidos de registro ou entrada ficam só leitura e são preservados, fotos
  são recodificadas (sem EXIF nem GPS) e só sobem depois que a entrada foi aceita.
- **Verifique:** `test/trackers.*.test.ts`, `store-trackers.test.ts`, `wire-trackers.test.ts`,
  `money.test.ts`, `timer.test.ts`; no servidor, `blobs.test.ts`.

### 12. Nuvem: sync local-first, backups, IA, usuários e pagamentos

- **O quê:** contas (verificação, redefinição, Google, aparelhos, exclusão, exportação), o servidor
  oficial por padrão, protocolo de sync v2, IndexedDB e persistência dividida, planos Grátis/Pro com
  Stripe, uma IA beta (sugestões e tradução, com o selo "Beta"), sugestões de palavras no próprio
  aparelho, um glossário para o texto dos modelos, backup de fotos e o deploy de produção. Veja o
  [guia da Conta](/pt-br/guides/account/) e [Privacidade](/pt-br/reference/privacy/).
- **Onde:** núcleo `sync*.ts`, `persist-layout.ts`, `storage.ts`, `upgrade.ts`, `account*.ts`,
  `ai*.ts`, `complete.ts`, `translate.ts`, `blob-sync.ts`, `remote*.ts`, `react-cloud.ts`,
  `actions/cloud.ts`; web `routes/_app/account.tsx`, `components/{account,ai}/*`; nativo
  `app/account.tsx`, `components/{account,ai}/*`; todo o `apps/server` e o `deploy/`.
- **Verifique:** no núcleo, `persistence.test.ts`, `hydration.test.ts`, `sync-robustness.test.ts`,
  `sync-controller.test.ts`, `store-cloud.test.ts`, `remote.test.ts`, `complete.test.ts`,
  `translate.test.ts`, `ai-client.test.ts`, `blob-sync.test.ts`; todas as suítes de
  `apps/server/test` (com dublês de Resend, Google, Stripe, servidor de modelo e S3; sem rede).

## Onde olhar com atenção

**Segurança dos dados** (onde um bug faz a pessoa perder dados):

- O `STORE_VERSION` continua 1. O zustand 5 hidrataria `undefined` numa troca de versão sem função
  `migrate`. A evolução do schema usa `SCHEMA_REV` / `dataRev`.
- A hidratação só normaliza quando o `dataRev` mudou, mantém registros inválidos crus e preserva
  coleções desconhecidas (`foreign`) e chaves de fatia desconhecidas.
- A migração do localStorage para o IndexedDB só remove a chave antiga depois que a nova gravação
  deu certo, migra um ano por vez e sobrevive a uma cota cheia.
- Uma chave corrompida é guardada como backup, dispara um novo pull e segura as escritas derivadas
  até ele terminar.
- Exportação v2: um cliente v1 recusa um backup v2 em vez de descartar os campos da v2 em silêncio;
  substituir a partir de um backup v1 só substitui as coleções da v1.

**Convergência do sync:** a regra de empate (`compareVersions`, idêntica no cliente e no servidor),
o novo pull, os documentos superados, os códigos que mantêm pendência, a reconciliação dos
registros que converge em duas rodadas e os ids determinísticos de ocorrências e entradas diárias.
O `apps/server/test/e2e.test.ts`, o `e2e-v2.test.ts` e o `sync-tie.test.ts` rodam dois clientes
reais do núcleo contra um servidor real.

**Privacidade e segurança** (`apps/server`):

- Os logs não têm conteúdo: só modelos de rota, sem corpos, tokens, IPs ou e-mails
  (`logging.test.ts` passa um texto-canário por todos os caminhos de falha da IA).
- IA: consentimento opcional guardado no servidor, só POST, nada é registrado, guardado em cache ou
  armazenado; o diário nunca é enviado.
- Reforço da autenticação: sessões revogadas ao redefinir a senha, sessão recente de 10 minutos
  para excluir a conta, proteção do vínculo com o Google contra contas pré-cadastradas, corpo JSON
  obrigatório nas rotas de autenticação, limites de taxa.
- Excluir a conta limpa Stripe, fotos e todas as linhas, e um registro de exclusões apaga de novo
  uma conta que um backup restaurado traga de volta. O SQLite roda com `secure_delete`.
- Algumas decisões de produto estão marcadas como **Product to confirm** nas notas de implementação
  da spec (a regra de recuperação via Google, as opções contra contas "posseiras" verificadas).

**Acessibilidade e paridade:** todo texto novo existe em inglês e português (há testes), o
contraste não mudou (nenhum token novo), e as diferenças intencionais entre plataformas estão no
§1.3 da spec (lembretes de tarefas e de revisão só no celular, sem Google no desktop, o artifact do
claude.ai sem fotos, conta nem IA, builds da Play Store sem tela de compra).

## Como verificar

```bash
bun install
bun run lint && bun check-types && bun run test
bun dev:web        # http://localhost:3001 → "Explorar com dados de exemplo"
```

- **Dados de exemplo** cobrem todos os pedidos: um mês para subir de nível em Ler, tarefas
  recorrentes e de preparo, entradas de todos os tipos no diário, hábitos com registro e entradas
  para cada identidade.
- **Dois aparelhos:** rode `bun dev:server`, abra o app web em dois perfis do navegador, informe
  `http://localhost:3000` como servidor na tela de login (um build de desenvolvimento não tem
  servidor padrão, então o campo aparece direto; num build de lançamento ele fica em *Avançado ·
  servidor próprio*), crie a conta num perfil e entre no outro. Edite nos dois, com e sem conexão.
- **Duas abas:** abra o app web duas vezes no mesmo perfil e edite nas duas (mesclagem por
  BroadcastChannel).
- **Migração de um perfil v1:** abra um build v1, adicione dados e depois carregue o build v2 no
  mesmo perfil.
- **Android:** instale o `atomic-dev-client-<sha>.apk` da
  [release `android-preview`](https://github.com/andeen171/atomic-habits/releases/tag/android-preview),
  rode `bun dev:native` e abra o app para conectar ao Metro.
- **Desktop:** instaladores na
  [release `desktop-preview`](https://github.com/andeen171/atomic-habits/releases/tag/desktop-preview).
- **Recursos do servidor:** `cd apps/server && bun test` exercita e-mail, Google, Stripe, IA e
  backup de fotos contra dublês locais. Para testar a IA à mão, aponte `AI_BASE_URL` para um Ollama
  local ou para o perfil `ai` do Compose (veja [Hospedar o servidor](/pt-br/guides/self-hosting/)).

## Lacunas conhecidas

- **O Atomic Cloud ainda não está no ar.** O lançamento está bloqueado até que esteja (spec §4.7).
  O pacote de deploy está pronto; comprar o domínio, criar as contas nos provedores, fazer o deploy
  e rodar o simulado de restauração uma vez são tarefas do dono (`deploy/README.md`).
- A stack do Docker Compose (Caddy, Litestream, llama.cpp) é verificada de forma estática
  (`docker compose config`, `deploy.test.ts`), mas nunca subiu: o ambiente de build não tem Docker.
- Os builds de lançamento só vão embutir a URL oficial quando o domínio existir; os workflows leem
  a variável do repositório `ATOMIC_SERVER_URL`.
- O APK e os instaladores desktop são gerados no CI e foram testados em emuladores e no navegador,
  não em aparelhos reais. O iOS está configurado, mas não roda no CI.
- Excluir um documento ainda não libera cota de sync (não há compactação de tombstones).
