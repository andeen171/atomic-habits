# Web Application (`apps/web`)

The web application is a React-based frontend that also powers the desktop application via Tauri.

## Technologies
- **React:** UI library.
- **TanStack Router:** Type-safe, file-based routing.
- **tRPC Client:** For type-safe API communication.
- **Tailwind CSS & shadcn/ui:** Styling and UI components.
- **Tauri:** Desktop application framework.
- **Vite:** Build tool.

## Directory Structure
- `src/main.tsx`: Application entry point.
- `src/routes/`: File-based routes managed by TanStack Router.
    - `__root.tsx`: The layout wrapper for all routes.
    - `index.tsx`: Home page.
    - `habits.tsx`: Habits management page.
- `src/components/`:
    - `ui/`: Reusable primitive components (shadcn/ui).
    - `pages/`: Page-specific components.
- `src/utils/trpc.ts`: tRPC client configuration.
- `src/lib/auth-client.ts`: Better Auth client initialization.
- `src-tauri/`: Tauri configuration and native Rust code for the desktop app.

## Key Commands
- `bun dev`: Starts the Vite development server.
- `bun desktop:dev`: Starts the Tauri development environment (requires Rust).
- `bun build`: Builds the web application for production.
- `bun desktop:build`: Builds the native desktop executable.
- `bun generate-pwa-assets`: Generates icons and manifest for PWA support.

## PWA & Desktop
The app is configured as a Progressive Web App (PWA) using `vite-plugin-pwa`. It also integrates with Tauri to provide a native desktop experience with access to system APIs when needed.
