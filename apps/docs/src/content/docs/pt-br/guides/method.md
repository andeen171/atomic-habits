---
title: O método
description: Como o Atomic transforma as ideias de Hábitos Atômicos em funcionalidades.
sidebar:
  order: 2
---

O Atomic é construído em torno de algumas ideias de *Hábitos Atômicos*, de James Clear. Esta
página explica como cada uma aparece no app.

## Hábitos baseados em identidade

> Cada ação que você realiza é um voto no tipo de pessoa que deseja se tornar.

As identidades ("Eu sou uma pessoa que nunca perde um treino") ficam no topo do seu sistema. Cada
hábito pode votar em uma identidade:

- **Hábitos a construir** ganham um voto por repetição, até a meta diária.
- **Hábitos a abandonar** ganham um voto por dia limpo.

A tela **Identidade** mostra o total de votos e o ritmo recente de cada identidade.

## As quatro leis da mudança de comportamento

O editor de hábitos segue as quatro leis — e as versões invertidas quando você quer abandonar um
hábito.

| Lei | Construir um hábito | Abandonar um hábito |
| --- | --- | --- |
| 1ª — Deixa | **Torne-o óbvio**: intenção de implementação (hora + local), empilhamento de hábitos ("Depois de servir o café…"), design do ambiente | **Torne-o invisível**: identifique o gatilho e tire-o do ambiente |
| 2ª — Desejo | **Torne-o atraente**: agrupamento de tentações, a mudança de mentalidade "Eu tenho a oportunidade de…" | **Torne-o pouco atraente**: explicite o custo real |
| 3ª — Resposta | **Torne-o fácil**: a versão de dois minutos | **Torne-o difícil**: adicione atrito |
| 4ª — Recompensa | **Torne-o satisfatório**: recompensa imediata, acompanhamento | **Torne-o insatisfatório**: responsabilidade |

Cada hábito ganha um **Blueprint** legível montado a partir das suas respostas, por exemplo:

> Vou ler 10 páginas às 21:30 na cama. Depois de escovar os dentes, vou ler 10 páginas.
> Versão de dois minutos: ler uma página.

## Nunca falhe duas vezes

Falhar uma vez é um acidente; falhar duas vezes é o começo de um novo hábito. As sequências do
Atomic seguem essa regra:

- Uma única falha em um dia programado **não zera** a sequência (só não soma), e a tela Hoje
  mostra o lembrete *Nunca falhe duas vezes*.
- Duas falhas seguidas encerram a sequência.
- Dias **pulados** (descanso intencional) são neutros.
- Hábitos semanais ("3 vezes por semana") contam sequências em semanas.
- **Hábitos a abandonar** contam dias limpos: uma recaída reinicia a contagem.

## Força do hábito

Sequências são frágeis; hábitos são feitos de repetições. A **força do hábito** é uma média móvel
exponencial dos resultados recentes, com meia-vida de 14 dias programados (3 semanas para hábitos
semanais; hábitos a abandonar contam todos os dias do calendário). Cerca de 66 dias consistentes
levam a ~96% — uma referência às pesquisas sobre quanto tempo um hábito leva para ficar
automático.

## 1% melhor a cada dia

Os Insights comparam 1,01ⁿ com 0,99ⁿ ao longo dos dias em que você constrói seu sistema — os
juros compostos do autoaperfeiçoamento — junto com sua consistência real, dias perfeitos e votos.

## Scorecard de hábitos

Antes de mudar hábitos, é preciso percebê-los. O **Scorecard** lista o que você faz em um dia
normal, cada item avaliado como positivo, neutro ou negativo, e transforma qualquer linha em um
hábito para construir ou abandonar.
