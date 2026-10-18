---
title: Primeiros passos
description: Instale o Atomic na web, no desktop ou no Android e crie seu primeiro hábito.
sidebar:
  order: 1
---

O Atomic roda em todo lugar a partir de um único código. Seus dados ficam primeiro no seu
aparelho — não é preciso criar conta.

## Web e desktop

- **Web:** abra a versão hospedada ou rode localmente com `bun dev:web` (http://localhost:3001).
  É um Progressive Web App: dá para *Instalar* pelo menu do navegador e usar offline.
- **Desktop:** baixe o instalador na
  [release `desktop-preview`](https://github.com/andeen171/atomic-habits/releases/tag/desktop-preview)
  (Windows, macOS, Linux) ou rode `cd apps/web && bun desktop:dev` com Rust instalado.

## Android

Baixe o APK na
[release `android-preview`](https://github.com/andeen171/atomic-habits/releases/tag/android-preview):

- `atomic-<sha>.apk` — o app completo. Instale e abra.
- `atomic-dev-client-<sha>.apk` — build de desenvolvimento. Rode `bun dev:native` no computador e
  abra o app para carregar o JavaScript do Metro com hot reload.

Os dois são assinados com chave de debug, então o Android vai pedir para permitir instalações de
fontes desconhecidas.

## Seu primeiro hábito

1. Na primeira abertura, escolha quem você quer se tornar (por exemplo, *Eu sou um leitor*).
2. Escolha até três hábitos iniciais — eles vêm com **versões de dois minutos** para que começar
   seja fácil.
3. Em **Hoje**, toque no anel de um hábito para registrá-lo. Hábitos com contagem (8 copos de
   água) aumentam a cada toque; pressione e segure (ou clique com o botão direito) para mais ações,
   como pular o dia, adicionar uma nota ou zerar o dia.

Quer explorar antes? Escolha **Explorar com dados de exemplo** na tela de boas-vindas.

## Atalhos de teclado (web e desktop)

| Atalho | Ação |
| --- | --- |
| `⌘K` / `Ctrl K` | Paleta de comandos |
| `H` | Novo hábito |
| `N` | Nova tarefa |
| `G` e depois `T` / `H` / `K` | Ir para Hoje / Hábitos / Tarefas |
| `←` / `→` | Dia anterior / próximo dia em Hoje |
| `?` | Mostrar todos os atalhos |
