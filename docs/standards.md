# Standards & Best Practices

To maintain code quality and developer productivity, we adhere to the following standards.

## Code Style & Quality
- **Biome:** We use Biome for linting and formatting. It is faster than Prettier/ESLint and provides a unified configuration (`biome.json`). 
- **Command:** Run `bun check` to lint and format the entire project.
- **Rules:** No `any` types unless strictly necessary. Favor functional programming patterns.

## Type Safety
- **Strict Mode:** TypeScript `strict` mode is enabled.
- **End-to-End Safety:** Use tRPC for all server-client communication. Avoid manual `fetch` calls unless interacting with external APIs.
- **Zod:** Use Zod for schema validation at the API boundaries (tRPC inputs) and environment variables.

## Routing
- **TanStack Router (Web):** Use file-based routing. All routes should be type-safe.
- **Native Navigation:** Follow standard Expo Router or React Navigation patterns as configured in `apps/native`.

## Database
- **Migrations:** All schema changes must be handled via Drizzle migrations or `db:push` for rapid prototyping.
- **Queries:** Use the Drizzle relational API for complex queries and the raw SQL-like API for performance-critical operations.

## Component Development
- **Tailwind CSS:** Use utility classes for styling. Follow the "Mobile First" approach.
- **Accessibility (A11y):** Ensure components are accessible (ARIA labels, keyboard navigation).
- **Reusable Components:** Leverage `shadcn/ui` components located in `apps/web/src/components/ui`.

## Monorepo Workflow
- **Dependency Management:** Use `bun install` at the root. Do not run `npm install` or `yarn` in sub-folders.
- **Cross-App Testing:** When changing the server, ensure both `web` and `native` apps still compile.
- **Shared Code:** If logic needs to be shared between `web` and `native` (beyond API types), consider moving it to a shared package in `packages/` or a shared utility folder in the server.

## Git Workflow
- **Commit Messages:** Use conventional commits (`feat:`, `fix:`, `docs:`, `chore:`).
- **Pre-commit Hooks:** Husky ensures that code passes Biome checks before it can be committed.
