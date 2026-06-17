Retermina

What is Retermina?

Retermina is a premium, cross-platform terminal wrapper designed to replace traditional, intimidating terminal windows with an ultra-polished, highly configurable developer workspace. Built on top of Tauri, React, and xterm.js, Retermina executes your native shell (Zsh, Bash, or PowerShell) securely inside a high-performance Rust PTY environment.

Instead of writing a shell from scratch or forcing you to subscribe to heavy cloud-based AI terminals, Retermina provides complete visual customizability and local, zero-token automation workflows.

Key Features

Launch Hub: A clean, distraction-free start screen with quick-action shortcuts (Launch Terminal, + New File, Open Folder, Clone Repo) and automatic VSCode recent workspace synchronization.

Modular Grid Layout: Drag, resize, and snap individual panels (File Tree, Terminal, Port Tracker) to design your perfect layout.

5 Structural UI Engines: Themes that alter the actual geometric structure of the application interface, not just the hex colors.

Iris Heuristic Assistant: A unified bottom input bar that switches between standard shell input and local macro control. Perform Git pulls, branches, and merges in one click.

Localhost Tracker: An automatic utility that detects active local servers running in your PTY, displaying glowing action cards with one-click "Terminate Process" buttons.

Free Preset Market: Share layout templates and UI configurations using serialized JSON strings with zero hosting fees.

The 5 UI Engines

Retermina features a dynamic structural layout compiler. Switching between themes changes container paddings, borders, shadows, and backdrop filters:

UI Engine

Structural Layout & Style Characteristics

Soft Pastel

Floating panels, highly rounded corners (32px), generous container spacing, soft diffuse shadows, and low-contrast typography.

Sleek

Zero-gap edge-to-edge layout, razor-thin 1px solid borders, sharp 90° corners, and ultra-high typographic contrast.

Transparent Glass

Glare-effect glassmorphism featuring rich backdrop filters (backdrop-blur-md) that blend beautifully with your system wallpaper.

Minimalist

Total removal of containers, borders, and line separators. Relying purely on clean whitespace and structural typography.

Neo-Brutalism

Thick solid black strokes, stark geometric layouts, zero gradients, and heavy, flat 2D drop-shadows.

How Iris Works (Zero-Token local Macros)

Retermina eliminates expensive cloud-API token limits using Iris.

Iris acts as a local command compiler. When you enter Iris mode (Cmd/Ctrl + I), the chatbar utilizes local regex parsing and heuristics to run pre-configured scripts instantly:

Contextual Menus: Typing git displays interactive, hoverable action cards above the input field like [ Pull ] or [ Push ]. Clicking them runs the sequence through the PTY background thread safely.

Localhost Sentinel: Iris continuously monitors terminal output buffers. When a script runs something like localhost:3000 or 127.0.0.1:8080, Iris intercepts the port and displays a UI card showing the running state alongside a [ Terminate ] button that terminates the system process on demand.

Getting Started

Prerequisites

You must have the Rust toolchain, Node.js, and your respective operating system's build dependencies installed.

macOS: Xcode Command Line Tools (xcode-select --install)

Windows: WebView2 and C++ Build Tools installed via Visual Studio Installer

Installation & Development

Clone the repository:

git clone https://github.com/yourusername/retermina.git
cd retermina


Install dependencies:

npm install # or pnpm install / yarn


Run the application in development mode:

npm run tauri dev


Build production bundles:

npm run tauri build


Preset Marketplace

Retermina saves everything about your workspace layout—your grid coordinates, text scale, active font, and structural engine configurations—into a single portable JSON file.

Exporting Layouts

To share your design, navigate to Settings > Themes, and click Export Setup. This copies your active JSON string to your clipboard.

Importing Layouts

Simply paste any Retermina JSON configuration block into the Import Setup panel to instantly re-render your entire application layout, colors, and styles.

License

Distributed under the MIT License. See LICENSE for more information.