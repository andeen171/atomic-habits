# Server Application (`apps/server`)

The server is built with **Hono**, **tRPC**, and **Drizzle ORM**, running on the **Bun** runtime.

## Technologies
- **Hono:** Web framework used as the base for the server.
- **tRPC:** Handles API requests with full type safety.
- **Drizzle ORM:** TypeScript-first ORM for database interactions.
- **Better Auth:** Authentication framework.
- **SQLite:** Local database.

## Directory Structure
- `src/index.ts`: Entry point of the server. Sets up Hono and tRPC middleware.
- `src/db/`: Database configuration and schema.
    - `index.ts`: Drizzle client initialization.
    - `schema/`: Table definitions (e.g., `auth.ts`, `todo.ts`).
- `src/routers/`: tRPC router definitions.
    - `index.ts`: Root router that combines all sub-routers.
    - `todo.ts`: Routes for todo/habit management.
- `src/lib/`: Shared utilities and initializations.
    - `auth.ts`: Better Auth configuration.
    - `trpc.ts`: tRPC initialization (router, public/protected procedures).
    - `context.ts`: tRPC context setup (database, auth, etc.).

## Key Commands
- `bun dev`: Starts the server in development mode.
- `bun db:push`: Pushes schema changes to the SQLite database.
- `bun db:studio`: Opens Drizzle Studio to view/edit data.
- `bun db:generate`: Generates migrations.
- `bun db:migrate`: Runs migrations.

## Integration with Clients
The server exports the `AppRouter` type from `src/routers/index.ts`, which is consumed by the web and native applications to provide end-to-end type safety.
