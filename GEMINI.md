# Inari

## Overview
A lightweight, content-focused static site built with Astro. Suitable for blogs, portfolios, and landing pages.

## Tech Stack
- **Framework**: Astro
- **Languages**: HTML, CSS, JavaScript/TypeScript
- **Runtime**: Node.js

## Architecture
- `src/pages`: File-based routing (e.g., `index.astro`).
- `src/components`: Reusable UI components (e.g., `Welcome.astro`).
- `src/layouts`: Shared page layouts (e.g., `Layout.astro`).
- `public`: Static assets (favicons, images).

## Commands
| Command | Action |
| :--- | :--- |
| `npm install` | Install dependencies |
| `npm run dev` | Start dev server at `localhost:4321` |
| `npm run build` | Build production site to `./dist/` |
| `npm run preview` | Preview build locally |

## Coding Style
- Use Astro components (`.astro`) for static UI.
- Minimize client-side JavaScript; prefer static generation.
- Keep component logic within the frontmatter fence (`---`).
- Use semantic HTML5 elements.

## Important Rules
- Do not commit the `node_modules` or `dist` folders.
- Ensure `npm run build` succeeds before deployment.
- Keep `public` strictly for static assets that don't need processing.