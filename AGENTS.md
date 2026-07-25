# Retermina Project Rules

## Architecture
- Framework: Tauri (Rust backend, React/TypeScript frontend).
- State Management: Zustand.
- Layout: React Grid Layout (v2 API).
- Styling: Tailwind CSS.

## Global Constraints
- Windowing: The app space is scroll-locked (overflow: hidden). Widgets must occupy a fixed-canvas layout.
- Styling: Transparent Glass theme must use `backdrop-filter: blur(20px)` and subtle `rgba(255, 255, 255, 0.1)` borders.
- Code Style: All new components must be functional, typed with TypeScript, and use Zustand for persistence.

## Workflow
- Always verify type safety before applying changes.
- If a task involves Rust, ensure the PTY spawn environment is correctly configured with interactive shell variables.
- When fixing the Grid, verify layout items against the 12x10 grid constraints.