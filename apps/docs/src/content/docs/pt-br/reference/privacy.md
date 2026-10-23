---
title: Privacidade
description: O que o Atomic guarda, onde, por quanto tempo e quem trata — papéis na LGPD, retenção, a política de IA, criptografia e a chave Sincronizar diário.
sidebar:
  order: 3
---

Esta página descreve como o software do Atomic trata dados pessoais, no aparelho e num servidor.
Ela é a base técnica de uma política de privacidade, não a política em si: a política de um
servidor é a página que o operador define em `PRIVACY_URL`, e os apps mostram esse link.

## Em poucas palavras

- **Sem conta, nada sai do seu aparelho.** Sem analytics, sem rastreamento, sem anúncios.
- Com uma conta, seus dados são copiados para o servidor que você escolheu (o Atomic Cloud por
  padrão) para ter backup e sincronizar. No servidor eles **não têm criptografia de ponta a ponta**.
- **O diário pode ficar só no aparelho:** desligue **Sincronizar diário**.
- **A IA é opcional.** Só o texto sobre o qual você pede ajuda é enviado, nada é guardado e o
  **diário nunca é enviado**.
- Você pode baixar tudo (um .zip com as fotos) e excluir sua conta quando quiser.

## Quem é responsável (LGPD)

| Papel | Quem |
| --- | --- |
| **Controlador** | Quem opera o servidor: no **Atomic Cloud**, o operador indicado na política de privacidade dele; num **servidor próprio**, quem o roda. Sem conta não há controlador: os dados nunca saem do aparelho |
| **Operadores** do Atomic Cloud | Os provedores da tabela abaixo, cada um limitado ao que o seu serviço precisa |

Operadores na montagem do Atomic Cloud ([`deploy/`](/pt-br/guides/self-hosting/#a-receita-de-custo-zero-atomic-cloud)):

| Provedor | Serviço | Dados pessoais que trata |
| --- | --- | --- |
| Oracle Cloud | A máquina virtual (região de São Paulo) que roda o servidor, o banco e o modelo de IA | Tudo o que o servidor guarda (abaixo) |
| Cloudflare | Armazenamento R2 para fotos e backups do banco; DNS; hospedagem do app web estático | Fotos e backups do banco (criptografados em repouso pelo provedor); metadados das requisições |
| Resend | Envio de e-mails | Seu endereço de e-mail e a mensagem (links de confirmação e de redefinição de senha) |
| Stripe | Pagamentos, só se você assinar | Seu e-mail, a assinatura e os dados de pagamento. O Stripe guarda as notas fiscais como a lei tributária exige, inclusive depois que você exclui a conta |
| Google | "Continuar com o Google", só se você usar | Seu login com o Google; o servidor só confere o token com as chaves públicas do Google |
| UptimeRobot | Monitor de disponibilidade | Nenhum (ele só lê o `/healthz`) |

O modelo de IA do Atomic Cloud roda **no próprio servidor**, então nenhum provedor de IA recebe o
seu texto. Um servidor próprio que use um provedor de IA hospedado precisa informar qual; a tela de
consentimento mostra o nome. Vários desses provedores operam fora do Brasil; a política de
privacidade do operador informa as garantias dessas transferências (LGPD art. 33).

## O que fica guardado onde

**No seu aparelho:** tudo o que você cria (hábitos, registros diários, tarefas, identidades,
Scorecard, diário, entradas dos registros, fotos), seus ajustes e pequenas preferências, como
cartões dispensados e rascunhos. Fica lá até você apagar, zerar o app ou desinstalá-lo. **Exportar
backup** grava tudo num arquivo JSON (sem as fotos).

**No servidor, com uma conta:**

| Dado | Para quê | Guardado até |
| --- | --- | --- |
| Nome, e-mail, hash da senha, se o e-mail foi confirmado | Sua conta | A exclusão da conta |
| Tudo o que você sincroniza (como documentos JSON) | Backup e sincronização | A exclusão da conta. Itens excluídos ficam como marcadores de exclusão que ainda guardam o último conteúdo (ainda não há compactação) |
| Fotos das entradas dos registros (recodificadas no aparelho, sem localização nem outros metadados) | Backup de fotos | Apagadas 7 dias depois que nenhuma entrada aponta para elas (entradas excluídas nos últimos 30 dias ainda contam); todas de uma vez na exclusão da conta |
| Aparelhos conectados: um rótulo do aparelho ("Atomic Android · Pixel 8"), o endereço IP e datas | Sua lista de aparelhos e segurança | A sessão expira (30 dias sem uso) ou é desconectada |
| Consentimento para a IA (data) e a chave de tradução | Comprovar e respeitar a sua escolha | Você retirar, ou a exclusão da conta |
| Contagens diárias da IA (pedidos, caracteres, tokens de saída) | Cotas | 40 dias |
| Plano, assinatura e concessões de plano | Cobrança | A exclusão da conta (o Stripe guarda os próprios registros) |
| Links de download de uso único (como hashes) | Baixar dados da conta | Usados ou expirados (10 minutos), depois apagados |

Os **logs** nunca têm conteúdo: uma linha por requisição com o *modelo* da rota (nunca uma query
string, um token ou o hash de uma foto), o status e a duração. Nada de corpos, e-mails, ids de
usuário ou endereços IP. O log de acesso do proxy TLS mascara os endereços (/24 no IPv4, /48 no
IPv6) e descarta tokens. Os logs são rotacionados (o Docker guarda 5 × 10 MB por serviço). As
**métricas** são contadores por rota e resultado, nunca ids ou textos.

## Criptografia

- **Em trânsito:** HTTPS (TLS) entre os apps e o servidor.
- **Em repouso:** o servidor guarda os documentos como JSON comum no SQLite. Os provedores de
  hospedagem criptografam seus discos e buckets, mas o próprio servidor, e portanto quem o opera,
  consegue ler o que você sincroniza. **Não há criptografia de ponta a ponta na v2.**
- **A chave Sincronizar diário** é o controle de privacidade da parte mais pessoal do app: com ela
  desligada, as entradas do diário escritas naquele aparelho nunca são enviadas. As entradas que já
  sincronizaram continuam no servidor até você excluí-las (e, como marcadores de exclusão, até você
  excluir a conta). A chave vale por aparelho; desligue em cada aparelho onde você escreve.

## A política de IA

- **Opcional, por conta.** O consentimento fica registrado no servidor (data e escolha), então ele
  acompanha você nos outros aparelhos e pode ser comprovado e retirado. A tradução é uma chave à
  parte, desligada por padrão.
- **Mínimo de dados.** Um pedido leva só o texto em questão e o campo a que ele pertence (por
  exemplo, o nome do hábito e a frase da identidade), nunca o seu histórico.
- **Nunca o diário.** Entradas do diário, notas do dia e entradas dos registros nunca vão para a IA,
  nunca são traduzidas e nunca alimentam as sugestões ao digitar, que rodam no aparelho.
- **Sem retenção.** Pedidos e respostas nunca são registrados em log, guardados em cache ou
  armazenados, e nunca são usados para treinar modelos. Só ficam as contagens diárias acima.
- **Beta.** Todo lugar com IA avisa; as respostas podem estar erradas e você escolhe o que manter.
- **Desligamento de emergência.** O operador pode desligar a IA para todos (`AI_FEATURES=`); os apps
  a escondem em até uma hora.
- Retirar o consentimento interrompe a IA na hora; desligar a tradução apaga as traduções guardadas.

## Seus direitos (LGPD art. 18)

| Direito | Como |
| --- | --- |
| Confirmação e acesso | **Baixar dados da conta**: um .zip com todos os documentos e todas as fotos das suas entradas vivas |
| Portabilidade | O mesmo .zip (formato de exportação v2) e o **Exportar backup** em qualquer aparelho |
| Correção | Edite qualquer coisa no app; as mudanças sincronizam |
| Eliminação | **Excluir conta** apaga na hora a conta, todos os documentos, todas as fotos e o cliente no Stripe |
| Revogação do consentimento | Desligue as sugestões e a tradução por IA |
| Informação | Esta página e a política de privacidade do operador |

**Backups e eliminação.** Uma conta excluída some do banco em uso na hora, e o banco zera o que
apaga. Backups feitos antes da exclusão a mantêm até expirarem: no Atomic Cloud, 7 dias no backup
contínuo do banco e nos snapshots noturnos (as fotos no R2 são apagadas na hora). Se um backup for
restaurado, o servidor exclui essas contas de novo a partir de um registro de exclusões que guarda
só um hash do id de cada conta excluída.

## No aparelho

- As fotos são recodificadas antes de ser guardadas, o que remove a localização e os metadados da
  câmera.
- As sugestões ao digitar e a tradução dos modelos rodam inteiramente no aparelho.
- A versão de artifact do claude.ai guarda os dados de cada pessoa num espaço privado do
  armazenamento do próprio artifact no claude.ai, e não tem conta, IA, fotos nem sincronização com
  servidor.
