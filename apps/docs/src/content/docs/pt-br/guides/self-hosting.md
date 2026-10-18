---
title: Hospedar a sincronização
description: Rode seu próprio servidor do Atomic para sincronizar hábitos entre aparelhos.
sidebar:
  order: 3
---

O Atomic funciona totalmente offline. Para usar os mesmos dados no celular e no computador, rode o
pequeno servidor de sincronização em `apps/server` (Bun + Hono + SQLite/libSQL) e entre pela tela
**Ajustes → Sincronização** em cada aparelho.

## Rodando

```bash
# na raiz do repositório
bun install
cp apps/server/.env.example apps/server/.env   # defina BETTER_AUTH_SECRET
bun dev:server                                  # http://localhost:3000
```

As migrações rodam sozinhas na inicialização. Por padrão os dados ficam em `apps/server/local.db`;
aponte `DATABASE_URL` (e `DATABASE_AUTH_TOKEN`) para o [Turso](https://turso.tech) se quiser um
banco hospedado.

## Docker

```bash
# na raiz do repositório
docker build -f apps/server/Dockerfile -t atomic-server .
docker run -p 3000:3000 -e BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  -v atomic-data:/data atomic-server
```

## Como a sincronização funciona

- O login usa e-mail + senha com tokens bearer, então funciona igual no navegador, no app desktop
  e no app mobile.
- Cada hábito, registro, tarefa, identidade e item do scorecard é um documento. Os aparelhos enviam
  os documentos que mudaram e baixam tudo o que for mais novo que a última sequência que viram.
- Conflitos se resolvem com **last write wins** por documento; exclusões são sincronizadas como
  tombstones.
- Na primeira vez que você entra, tudo o que já está no aparelho é enviado e mesclado.

O protocolo completo está em [Protocolo de sincronização](/pt-br/development/sync/). Veja
`apps/server/README.md` para todas as variáveis de ambiente e notas de deploy.
