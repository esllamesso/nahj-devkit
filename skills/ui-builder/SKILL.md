---
name: ui-builder
description: Design and improve polished, responsive user interfaces in the project's existing framework and styling system. Use when building screens, components, dashboards, forms, or landing pages, or when improving the layout, accessibility, or visual quality of an existing UI.
argument-hint: "[what to build or improve, e.g. 'settings page with profile form']"
---

# UI Builder

Build or improve the interface described here: **$ARGUMENTS**

If no request was given, ask the user what screen or component they want before writing code.

## Core rules

1. Inspect the existing project structure and identify its framework.
2. Follow the project's existing architecture and coding conventions.
3. Understand the purpose of the screen before changing code.
4. Create a clear visual hierarchy with consistent spacing, typography, and colors.
5. Make the interface responsive for relevant screen sizes.
6. Reuse existing components where appropriate.
7. Include loading, empty, and error states when relevant.
8. Avoid unnecessary dependencies.
9. Do not overwrite unrelated files.
10. Summarize the files changed and explain how to test the result.

Before making substantial changes (new pages, new shared components, or edits to more than a few files), explain the proposed approach and wait for the user to agree.

## Step 1: Detect the stack (do not guess)

Read the files that actually define the stack before you write UI code:

| Look at | To learn |
| --- | --- |
| `package.json` dependencies | Framework: `react`, `next`, `vue`, `nuxt`, `svelte`, `@sveltejs/kit`, `@angular/core`, `solid-js`, `astro`, `react-native`, `expo` |
| `pubspec.yaml`, `*.csproj`, `Gemfile`, `composer.json`, `requirements.txt` | Non-JS UI stacks: Flutter, Blazor/MAUI, Rails views, Laravel Blade, Django/Jinja templates |
| `tailwind.config.*`, `postcss.config.*`, `@import "tailwindcss"` in CSS | Tailwind (note v3 config file vs v4 CSS-first config) |
| `components.json`, `src/components/ui/` | shadcn/ui; reuse its primitives |
| Dependencies like `@mui/material`, `antd`, `@chakra-ui/react`, `vuetify`, `bootstrap` | Component library; use it instead of hand-rolled widgets |
| `*.module.css`, `styled-components`, `@emotion`, `*.scss` | Styling approach to copy |
| Theme files, CSS custom properties (`--color-*`), design tokens | Colors, radii, spacing, and fonts you must reuse |
| Router setup (`app/`, `pages/`, `src/routes/`, `router.ts`) | Where a new screen goes and how navigation is declared |
| Existing similar screens | The house style for layout, data fetching, and state |

If the directory has no UI framework (an empty or backend-only project), say so and propose the smallest reasonable option. Plain HTML + CSS is often enough. Ask before adding a framework.

## Step 2: Plan the screen

Write a short plan before the code:

- **Purpose and primary action**: what the user comes here to do, and the one action that matters most.
- **Content hierarchy**: what appears first, second, and third.
- **Components**: which existing components you will reuse and which (few) new ones you need.
- **States**: loading, empty, error, success, disabled, and long-content/overflow cases.
- **Data**: where data comes from (existing hooks, services, stores, API clients). Do not invent endpoints. If the backend doesn't exist yet, use clearly named typed mock data in one place and say so.
- **Breakpoints**: how the layout changes from about 360px (phone) to 768px (tablet) to 1280px and wider (desktop).

## Step 3: Build it

**Layout and visual quality**
- Use the project's spacing scale. In Tailwind that means the default scale, with no arbitrary `p-[13px]` values unless the codebase already uses them. In CSS, use the existing variables.
- Build the layout mobile-first with flex/grid. Avoid fixed widths that cause horizontal scrolling. Use `min-w-0` / `overflow-wrap:anywhere` where long text can break the layout.
- Use at most 2–3 text sizes per section, consistent font weights, and readable line length (roughly 60–80 characters for body text).
- Use the existing tokens for colors. Never hard-code a new brand color. If the project supports dark mode, make every new element work in both themes.
- Give interactive elements visible hover, focus-visible, active, and disabled states.

**Accessibility (required, not optional)**
- Use semantic elements: `button` for actions, `a` for navigation, `label` tied to every input, landmarks (`header`, `nav`, `main`), and headings in order.
- Every image gets meaningful `alt` text, or `alt=""` if it's decorative. Icon-only buttons need an `aria-label`.
- Text needs at least 4.5:1 contrast (3:1 for large text and UI boundaries). Never use color as the only signal.
- The whole flow must work with the keyboard, with a logical tab order. Modals trap focus and close on Escape.
- Respect `prefers-reduced-motion` for any non-trivial animation.

**Code quality**
- Match the existing file layout, naming, export style, and TypeScript strictness.
- Keep components small. Pull out a subcomponent when a block has its own state or is repeated.
- Forms: use the project's form/validation library if there is one, show inline errors next to fields, and disable submit while a request is pending.
- Don't add a dependency for something achievable in a few lines. If one is truly needed, name it, say why, and ask first.

## Step 4: Verify

Run what the project already has, in this order, and report the real results:

1. Type check / lint (`npm run typecheck`, `npm run lint`, `tsc --noEmit`, or the equivalents).
2. Existing tests that touch the area you changed.
3. A build or dev-server render. If a browser or preview tool is available, open the page and check it at phone and desktop widths, plus keyboard navigation.

If a step cannot run (missing script, missing env vars), say so. Do not claim it passed.

## Step 5: Report

Finish with:
- **Files changed**: each path and a one-line reason.
- **How to see it**: the command and URL/route.
- **States covered**: loading, empty, error, and others.
- **Follow-ups**: anything left as mock data, TODOs, or design decisions the user should confirm.
