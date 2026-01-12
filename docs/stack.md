# Technology Stack

This project uses the **Better-T-Stack**, a high-performance, type-safe full-stack architecture designed for modern application development.

## Frontend (Web & Desktop)
- **Framework:** [React](https://react.dev/)
- **Routing:** [TanStack Router](https://tanstack.com/router) - Type-safe, file-based routing.
- **State Management & Data Fetching:** [TanStack Query](https://tanstack.com/query) & [tRPC](https://trpc.io/).
- **Styling:** [Tailwind CSS](https://tailwindcss.com/) with [shadcn/ui](https://ui.shadcn.com/) components.
- **Desktop Wrapper:** [Tauri](https://tauri.app/) - Builds native desktop apps from the web codebase.
- **PWA:** Support for Progressive Web Apps.

## Mobile (Native)
- **Framework:** [React Native](https://reactnative.dev/) via [Expo](https://expo.dev/).
- **Data Fetching:** [tRPC](https://trpc.io/) for shared type safety with the server.
- **Styling:** Tailwind CSS (via NativeWind or similar integration).

## Backend (Server)
- **Runtime:** [Bun](https://bun.sh/) - Fast JavaScript/TypeScript runtime and package manager.
- **Framework:** [Hono](https://hono.dev/) - Ultrafast web framework for the edge.
- **API Protocol:** [tRPC](https://trpc.io/) - End-to-end type safety without code generation.
- **Authentication:** [Better Auth](https://www.better-auth.com/) - Comprehensive auth solution for TypeScript.

## Database & ORM
- **Database:** SQLite (Local) / [Turso](https://turso.tech/) (Production/Edge).
- **ORM:** [Drizzle ORM](https://orm.drizzle.team/) - TypeScript-first ORM with "if it's SQL, it's Drizzle" philosophy.

## Infrastructure & Tooling
- **Monorepo Management:** [Turborepo](https://turbo.build/repo) - High-performance build system for JavaScript and TypeScript codebases.
- **Linting & Formatting:** [Biome](https://biomejs.dev/) - Toolchain for the web (replaces ESLint and Prettier).
- **Documentation:** [Starlight](https://starlight.astro.build/) (Astro) for the public-facing documentation site.
- **Git Hooks:** [Husky](https://typicode.github.io/husky/) for pre-commit checks.
