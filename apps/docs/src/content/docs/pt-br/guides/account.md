---
title: Conta, sincronização e IA
description: Contas, sincronização entre aparelhos, planos, a IA beta, tradução e seus controles de privacidade.
sidebar:
  order: 5
---

**Você não precisa de conta.** Tudo no Atomic funciona offline num aparelho, e sem conta nada sai
dele. Uma conta acrescenta três coisas: um backup num servidor, os mesmos dados em todos os seus
aparelhos e a IA beta, opcional.

## Onde fica

- **Ajustes → Conta e sincronização** em todos os apps, com um link para a página completa da
  **Conta**.
- No celular, a linha da conta no topo de **Você**. Na web e no desktop, o indicador de
  sincronização na barra lateral também abre a página da Conta.

## Atomic Cloud ou o seu próprio servidor

Os apps entram no **Atomic Cloud**, o servidor oficial, por padrão. Para usar um servidor que você
mesmo roda, abra **Avançado · servidor próprio** na tela de login e informe a URL (veja
[Hospedar o servidor](/pt-br/guides/self-hosting/)). Tudo nesta página funciona igual nos dois,
com uma diferença: cada servidor decide quais extras oferece. E-mail, login com Google, cobrança,
IA e backup de fotos podem ser desligados um a um.

## Entrando

- **E-mail e senha** (de 8 a 128 caracteres). Quando o servidor envia e-mails, você recebe um link
  para confirmar o endereço, e **Esqueceu a senha?** manda um link de redefinição. Redefinir a
  senha desconecta todos os aparelhos.
- **Continuar com o Google** na web e no Android, quando o servidor oferece. Não está disponível no
  app desktop.
- **Primeiro login num aparelho que já tem dados.** Se a sua conta também tem dados, o Atomic
  pergunta o que fazer: **Juntar os dois** (tudo é mantido; quando o mesmo item foi editado dos dois
  lados, vence a edição mais recente), **Usar só os dados da conta** (os dados deste aparelho são
  trocados pelos da conta; seus ajustes ficam) ou **Não entrar**.

## Como a sincronização funciona

- Toda mudança é salva primeiro no aparelho e enviada alguns segundos depois, a cada cinco minutos
  e sempre que o aparelho volta a ter conexão. **Sincronizar agora** força uma rodada.
- O status mostra "Backup feito {hora}" ou "{count} alterações aguardando sincronização". Nada se
  perde enquanto você está offline; as mudanças esperam.
- Quando o mesmo hábito, tarefa ou entrada mudou em dois aparelhos, a edição mais recente vence para
  o item inteiro.
- **Sair** mantém seus dados no aparelho. Entrar de novo pergunta se você quer juntar.
- Avisos que você pode ver: *seu servidor é mais antigo que este app* (alguns dados novos esperam
  até o servidor ser atualizado), *o relógio do aparelho está fora* (acerte o relógio; enquanto
  isso, o Atomic corrige os horários que salva), *o armazenamento de sincronização está cheio* (as
  novas alterações ficam no aparelho), *editado numa versão mais nova do Atomic — atualize para
  editar* (um item alterado por uma versão mais nova fica só para leitura até você atualizar).

### Duas chaves, por aparelho

- **Sincronizar diário** (ligada por padrão). Desligada: as entradas do diário escritas neste
  aparelho ficam nele; as dos seus outros aparelhos continuam chegando. Útil num aparelho
  compartilhado ou do trabalho, ou se você prefere que o diário nunca chegue a um servidor.
- **Fazer backup das fotos** (ligada por padrão, aparece quando o servidor oferece backup de fotos).
  Desligada: as fotos deste aparelho ficam nele.

## Seus aparelhos e a segurança

- **Aparelhos** lista cada aparelho conectado ("Atomic Web · Chrome (macOS)", "Atomic Android ·
  Pixel 8") com a última atividade. Desconecte um, ou **Desconectar todos os outros aparelhos**.
- **Alterar senha** (contas com senha) pode desconectar os outros aparelhos ao mesmo tempo.

## Planos

| | Sem conta | Grátis | Pro |
| --- | --- | --- | --- |
| Hábitos, tarefas, identidades, diário, registros, insights, fotos no aparelho | ✓ | ✓ | ✓ |
| Sincronização e backup em todos os aparelhos | — | ✓ (50 MB) | ✓ (500 MB) |
| Baixar dados da conta (.zip) | — | ✓ | ✓ |
| Sugestões ao digitar e tradução dos modelos (no aparelho) | ✓ | ✓ | ✓ |
| Backup de fotos | — | 100 MB | 5 GB |
| Sugestões de IA por dia | — | 10 | 150 |
| Tradução por IA por dia | — | 2.000 caracteres | 40.000 caracteres |

- Hábitos, tarefas, o diário, os registros, a sincronização e a exportação são grátis para
  sempre. O Pro compra capacidade de IA, espaço para fotos e folga na sincronização.
- **Assinar** abre um checkout seguro do Stripe no navegador; **Gerenciar assinatura** abre o portal
  do Stripe para trocar o cartão, mudar entre mensal e anual ou cancelar. Cancelar mantém o Pro até
  o fim do período pago. Se um pagamento falhar, o Pro continua por um período de carência enquanto
  você atualiza o cartão.
- Num servidor sem cobrança (a maioria dos servidores próprios), todo mundo tem tudo: "Tudo está
  incluído neste servidor."
- Os builds do app Android distribuídos pelas lojas mostram o seu plano, mas não o vendem.
- **Rebaixar o plano nunca prende os seus dados**: acima do limite de fotos, as fotos continuam
  visíveis e as novas ficam no aparelho; acima do limite de sincronização, as mudanças novas esperam
  no aparelho.

## Assistente de IA (beta)

A IA fica **desligada até você ligar**, precisa de uma conta, e todo lugar com IA tem o selo
**Beta**. O botão de brilho sugere, e você sempre escolhe o que manter:

- nomes de hábitos, versões de dois minutos, quando e onde (intenções de implementação) e
  empilhamentos;
- **Preencher as quatro leis** de um hábito novo, e tarefas de preparo;
- frases de identidade e o primeiro passo de uma tarefa.

O que acontece quando você pede:

- Só o texto sobre o qual você pede ajuda é enviado (por exemplo, o nome do hábito e a identidade
  dele), nunca o seu histórico. **O seu diário nunca é enviado**, nem notas ou entradas de
  registros.
- No Atomic Cloud, o modelo roda no próprio servidor do Atomic. Um servidor que usa um provedor
  externo informa o nome dele na tela de consentimento.
- Nada é guardado, registrado em log ou usado para treinar modelos: as solicitações são processadas
  e descartadas. O servidor guarda só a contagem diária de pedidos, para a sua cota (que zera às
  00:00 UTC).
- Quando o servidor envia e-mails, a IA exige um endereço confirmado.
- Você pode desligar a IA quando quiser em **Ajustes → Assistente de IA**.

## Sugestões ao digitar e tradução

- **Sugestões enquanto digita** completa palavras e frases a partir dos modelos e dos seus próprios
  hábitos e tarefas. Roda inteiro no aparelho, funciona offline e nunca usa o seu diário. Dá para
  desligar nos Ajustes.
- **O texto dos modelos segue o idioma do app.** Um hábito criado a partir de um modelo em português
  aparece em inglês quando você muda para inglês, offline, sem IA.
- **Traduzir meu conteúdo para o idioma do app** (uma opção da IA, desligada por padrão) traduz os
  seus próprios hábitos, identidades, tarefas em aberto e linhas do Scorecard. O texto traduzido
  mostra "Traduzido do …" com **Ver original**; editar sempre muda o original. Entradas do diário,
  notas e entradas de registros nunca são traduzidas. Desligar a opção apaga as traduções.
- **Mostrar meus hábitos no idioma do app** pode ser desligado para ver sempre o texto como você
  escreveu.

## Seus dados

- **Exportar backup** (Ajustes → Seus dados) salva tudo o que está neste aparelho num arquivo JSON
  que você pode importar em qualquer lugar. Ele não inclui fotos.
- **Baixar dados da conta** (página da Conta) entrega um .zip com tudo o que está guardado no
  servidor, fotos incluídas. O link funciona uma vez e expira em 10 minutos.
- **Excluir conta** apaga de forma permanente a sua conta e tudo o que está no servidor, cancela na
  hora uma assinatura Pro e desconecta seus outros aparelhos. Você escolhe **Manter meus dados neste
  aparelho** ou **Apagar também deste aparelho**. É preciso digitar a senha, ou entrar de novo com o
  Google nas contas sem senha.

O que fica guardado onde, por quanto tempo e com quem: [Privacidade](/pt-br/reference/privacy/).
