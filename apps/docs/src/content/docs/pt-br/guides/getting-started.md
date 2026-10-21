---
title: Primeiros passos
description: Instale o Atomic na web, no desktop ou no Android, crie seu primeiro hábito e conheça a tela Hoje.
sidebar:
  order: 1
---

O Atomic roda em todo lugar a partir de um único código. Seus dados ficam primeiro no seu
aparelho: não é preciso criar conta. Quando quiser um backup ou um segundo aparelho, entre no
Atomic Cloud (ou no seu próprio servidor).

## Web e desktop

- **Web:** abra a versão hospedada ou rode localmente com `bun dev:web` (http://localhost:3001).
  É um Progressive Web App: dá para *Instalar* pelo menu do navegador e usar offline.
- **Desktop:** baixe o instalador na
  [release `desktop-preview`](https://github.com/andeen171/atomic-habits/releases/tag/desktop-preview)
  (Windows, macOS, Linux) ou rode `cd apps/web && bun desktop:dev` com Rust instalado.

## Android

Baixe o APK na
[release `android-preview`](https://github.com/andeen171/atomic-habits/releases/tag/android-preview):

- `atomic-<sha>.apk`: o app completo. Instale e abra.
- `atomic-dev-client-<sha>.apk`: build de desenvolvimento. Rode `bun dev:native` no computador e
  abra o app para carregar o JavaScript do Metro com hot reload.

Os dois são assinados com chave de debug, então o Android vai pedir para permitir instalações de
fontes desconhecidas. Quando sai um APK mais novo, o app avisa ("O Atomic {versão} está disponível ·
Baixar").

## Seu primeiro hábito

1. Na primeira abertura, escolha quem você quer se tornar (por exemplo, *Sou uma pessoa que lê
   todos os dias*). Já usa o Atomic em outro aparelho? Toque em **Entrar** na tela de boas-vindas,
   e seus dados vêm junto.
2. Escolha até três hábitos iniciais. Eles vêm com **versões de dois minutos**, para que começar
   seja fácil, e usam o ícone da sua identidade. Os marcados como **Registrado no app** são feitos
   dentro do Atomic: um diário de leitura, um timer, um registro de gastos (veja
   [Registros](/pt-br/guides/trackers/)).
3. Em **Hoje**, toque no anel de um hábito para registrá-lo. Hábitos com contagem (8 copos de
   água) sobem um a cada toque até a meta diária; passou dela, um botão **+1** registra repetições
   extras, que contam para a meta do mês. Pressione e segure (ou clique com o botão direito) para
   mais: **Registrar quantidade…**, pular o dia, adicionar uma nota.

Quer explorar antes? Escolha **Explorar com dados de exemplo** na tela de boas-vindas: quatro meses
de histórico, com entradas no diário, tarefas recorrentes e hábitos com registro.

## A tela Hoje num relance

- **O princípio do dia** fica no topo, uma ideia curta do livro. Dá para ocultar por hoje.
- **Seus hábitos**, agrupados por período do dia. Hábitos com registro abrem o registro quando você
  toca no anel. Quando a meta do mês precisa de um empurrão, a linha avisa ("+3 páginas/dia garante
  outubro").
- **No máximo um ou dois cartões** acima dos hábitos, na ordem do que mais importa: um timer
  rodando, *nunca falhe duas vezes* depois de um dia perdido (com o seu plano de retomada, se você
  escreveu um), uma sugestão para **subir de nível** na primeira semana do mês depois de um mês
  forte, um convite do diário para refletir, ou um cartão de *meta do mês atrasada* na última semana
  do mês.
- **As tarefas do dia**, incluindo as recorrentes e as tarefas de preparo criadas junto com os
  hábitos.

## Criando mais

O botão **⊕ Criar** oferece **Novo hábito**, **Nova tarefa** e **Entrada no diário**.

- **Novo hábito** começa com *Quem você quer se tornar?*, depois *O que você vai fazer?* e então as
  quatro leis: torne-o óbvio, atraente, fácil e satisfatório (ou as versões invertidas, para
  abandonar um hábito). No caminho, você pode transformar o seu plano em **tarefas de preparo**
  ("Deixar o livro no travesseiro"), escolher **como vai registrar** e, com login, pedir ideias à IA
  beta. Veja [O método](/pt-br/guides/method/).
- **Nova tarefa** pode se repetir: em dias fixos ou "após concluir" (regar as plantas 7 dias depois
  da última vez).
- **Entrada no diário** abre o [diário](/pt-br/guides/journal/): uma evidência, um plano de
  retomada, uma revisão…

## Atalhos de teclado (web e desktop)

| Atalho | Ação |
| --- | --- |
| `⌘K` / `Ctrl K` | Paleta de comandos |
| `H` | Novo hábito |
| `N` | Nova tarefa |
| `J` | Nova entrada no diário |
| `G` e depois `T` / `H` / `K` / `J` | Ir para Hoje / Hábitos / Tarefas / Diário |
| `←` / `→` | Dia anterior / próximo dia em Hoje |
| `?` | Mostrar todos os atalhos |

## E agora

- [O método](/pt-br/guides/method/): como as ideias do livro aparecem no app.
- [O diário](/pt-br/guides/journal/) e [Registros](/pt-br/guides/trackers/).
- [Conta, sincronização e IA](/pt-br/guides/account/): backups, aparelhos, planos e controles de
  privacidade.
