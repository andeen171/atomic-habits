# Monorepo Architecture

This project is organized as a monorepo using **Turborepo** and **Bun Workspaces**. This structure allows for shared types, configurations, and efficient task execution across multiple applications.

## Directory Structure

```text
.
├── apps/
│   ├── web/          # React + TanStack Router (Web & Desktop)
│   ├── native/       # React Native + Expo (Mobile)
│   ├── server/       # Hono + tRPC + Drizzle (Backend)
│   └── docs/         # Astro + Starlight (Public Docs)
├── docs/             # Internal Developer Documentation (this folder)
├── package.json      # Root dependencies and workspace scripts
├── turbo.json        # Turborepo configuration
└── biome.json        # Shared linting and formatting rules
```

## Task Orchestration (Turborepo)

Turborepo (`turbo.json`) manages the build pipeline and development workflow. It ensures that tasks are run in the correct order and leverages caching to speed up repeated operations.

### Key Scripts (Root)
- `bun dev`: Runs `turbo dev`, starting all applications in development mode simultaneously.
- `bun build`: Runs `turbo build`, building all applications for production.
- `bun check`: Runs Biome linting and formatting across the entire repo.
- `bun check-types`: Runs TypeScript type checking across all packages.

## Shared Configurations

- **TypeScript:** Each app has its own `tsconfig.json` but can extend a shared base if defined (currently they are mostly independent but follow the same standards).
- **Biome:** The root `biome.json` defines the linting and formatting standards for all files in the monorepo.
- **Environment Variables:** Each app typically manages its own `.env` file, but some variables (like API URLs) must be coordinated.

## Cross-Application Integration

The primary mechanism for integration is **tRPC**. 

1. **Schema Definition:** The `apps/server` defines the API schema and procedures.
2. **Type Export:** The server exports the `AppRouter` type.
3. **Type Consumption:** Both `apps/web` and `apps/native` import this type to create their tRPC clients.
4. **End-to-End Safety:** Any change in the server's API will immediately cause type errors in the web or native apps if they are not updated accordingly.

## Workflow Best Practices

1. **Atomic Changes:** When adding a new feature that requires API changes, update the server first, then the clients. tRPC ensures you don't forget any parts.
2. **Global Checks:** Always run `bun check` and `bun check-types` from the root before committing to ensure no regressions were introduced in other apps.
3. **Scoped Commands:** You can run commands for specific apps using `turbo -F <app-name> <command>` (e.g., `turbo -F web dev`).
