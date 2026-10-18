---
title: Protocolo de sincronização
description: Como os aparelhos trocam dados pelo servidor opcional.
sidebar:
  order: 4
---

A sincronização é opcional e só acrescenta: os apps estão completos sem ela. Quando alguém entra
pela tela **Ajustes → Sincronização**, o aparelho continua funcionando localmente e troca
documentos com o servidor em segundo plano.

## Modelo

- Toda entidade é um **documento** identificado por `(coleção, id)` e transportado inteiro, em
  JSON.
- O servidor guarda, por usuário, a versão com o maior `updatedAt` (**last write wins**) e carimba
  cada escrita aceita com um **número de sequência** crescente por usuário.
- Exclusões são documentos com `deletedAt` preenchido (**tombstones**), então sincronizam como
  edições.
- As configurações (nome, tema, idioma, início da semana) ficam em cada aparelho e não são
  sincronizadas.

O protocolo é código compartilhado: os schemas zod e os limites ficam em
`packages/core/src/sync.ts`, e tanto o cliente quanto o `apps/server` os importam.

## Endpoints

| Endpoint | Para quê |
| --- | --- |
| `POST /api/auth/sign-up/email`, `/sign-in/email`, `/sign-out`, `GET /api/auth/get-session` | Better Auth, com token bearer no `Authorization` |
| `POST /trpc/sync.push` | Enviar documentos alterados |
| `GET /trpc/sync.pull?input=…` | Baixar documentos depois de um cursor |

O tRPC roda em modo HTTP simples (sem batching, sem transformer). Por isso o cliente em
`packages/core/src/remote.ts` é um pequeno wrapper de `fetch`, sem dependência do tRPC.

## Push

```ts
push({ records: SyncRecord[] })   // até 500 por chamada
  → { accepted, cursor, rejected?, conflicts? }
```

- Cada registro é validado com o mesmo schema dos clientes e limitado a 64 KB. Registros
  inválidos voltam em `rejected` com o motivo, e o cliente os descarta.
- Um registro mais antigo que a versão guardada não é gravado. A versão guardada volta em
  `conflicts`, e o cliente a adota na hora.
- Todos os registros aceitos são gravados em **uma única transação**, com seus novos números de
  sequência.

## Pull

```ts
pull({ cursor, limit? })          // padrão 500, máximo 1000 registros, ~4 MB por página
  → { records, cursor, hasMore, reset? }
```

O cliente puxa até `hasMore` ser falso e guarda o último `cursor`. Se o cursor do cliente estiver
**à frente** do servidor (por exemplo, depois que o banco foi restaurado de um backup), o servidor
responde `reset: true`. O cliente então marca tudo como pendente, recomeça do cursor 0 e reenvia
os dados.

## Uma rodada de sync (cliente)

`runSync()` em `packages/core/src/sync-engine.ts`:

1. Espera o store hidratar.
2. **Push** de cada chave em `sync.pending`, em lotes. O motor lembra o `updatedAt` enviado; um
   documento editado de novo durante a rodada continua pendente para a próxima.
3. Aplica `conflicts`, descarta `rejected` e limpa as pendências do que foi aceito.
4. **Pull** de páginas até ficar em dia, mesclando com `applyRemote()` (vence o `updatedAt` mais
   novo, e campos desconhecidos de clientes mais novos são preservados).
5. Trata o `reset` como descrito acima.

Chamadas feitas durante uma rodada enfileiram **uma** rodada seguinte, compartilhada por todos que
chamaram.

## Quando roda

`createSyncController()` (`packages/core/src/sync-controller.ts`) cuida da sessão:

- 2,5 s depois de uma alteração local (agrupada), a cada 5 minutos e no botão
  **Sincronizar agora**.
- Ao entrar numa conta nova, tudo o que já está no aparelho é marcado como pendente e mesclado
  com essa conta.
- Antes de trocar de conta ou sair, o controlador espera a rodada em andamento terminar.
- O token da sessão fica no `localStorage` na web e no SecureStore no celular.
- O status (`signed-out`, `idle`, `syncing`, `error`) e o tipo de erro (`auth`, `network`,
  `server`) alimentam o indicador de sincronização na interface.

## Armazenamento no servidor

`apps/server/src/db/schema/sync.ts`:

- `sync_record`: usuário, coleção, id, dados em JSON, `updated_at`, `deleted_at` e `seq`. A chave
  primária é (usuário, coleção, id).
- `sync_cursor`: o último número de sequência por usuário.

As tabelas de autenticação são as do próprio Better Auth (`user`, `session`, `account`,
`verification`). Para rodar um servidor, veja
[Hospedar a sincronização](/pt-br/guides/self-hosting/).
