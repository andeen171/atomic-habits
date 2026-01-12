# Documentation Site (`apps/docs`)

This is the public-facing documentation site built with **Astro** and **Starlight**.

## Technologies
- **Astro:** Web framework for content-driven websites.
- **Starlight:** A documentation theme for Astro.
- **MDX:** Allows using React components in Markdown.

## Directory Structure
- `src/content/docs/`: The actual documentation files (Markdown/MDX).
    - `index.mdx`: Homepage of the documentation site.
    - `guides/`: User and developer guides.
    - `reference/`: Technical reference documentation.
- `astro.config.mjs`: Astro and Starlight configuration.

## Key Commands
- `bun dev`: Starts the Astro development server.
- `bun build`: Builds the static documentation site.
- `bun preview`: Previews the built site locally.

## Usage
This site is intended for high-level documentation, tutorials, and public information about the project. For internal development documentation, refer to the `docs/` folder in the root of the monorepo.
