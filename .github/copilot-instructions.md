# Inari

## Project
Astro-based static site starter with components, layouts, and pages structure.

## Conventions
- Use `.astro` files for components and pages
- Keep components in `src/components/`
- Keep layouts in `src/layouts/`
- Keep static assets in `public/`
- Prefer Astro's built-in optimizations over external libraries

## Naming
- Use PascalCase for component files (`Header.astro`, `Footer.astro`)
- Use camelCase for utility functions and variables
- Use kebab-case for CSS classes

## Architecture
- Pages go in `src/pages/` (file-based routing)
- Layouts wrap pages in `src/layouts/`
- Reusable UI pieces live in `src/components/`
- Global styles go in `src/styles/` if needed

## Commands
- `npm install` — Install dependencies
- `npm run dev` — Start dev server at localhost:4321
- `npm run build` — Build production site to `./dist/`
- `npm run preview` — Preview build locally
- `npm run astro add <integration>` — Add Astro integrations

## Do Not
- Do not modify `node_modules/` directly
- Do not commit built files (`dist/`)
- Do not use React/Vue/Svelte unless added as integration
- Do not skip running `astro check` before committing