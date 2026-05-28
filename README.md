# Data Diary

> A lightweight, typewriter-feel desktop notepad for keeping a working diary of your data projects. Every project saves as a plain `.Rmd` file — open it in RStudio, commit it to Git, sync it with Dropbox.

<p align="center">
  <img src="docs/hero.svg" alt="Data Diary screenshot" width="900" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" />
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg" alt="Cross-platform" />
  <img src="https://img.shields.io/badge/built%20with-Tauri-orange.svg" alt="Built with Tauri" />
</p>

## Download

Grab the latest installer from the **[Releases page](../../releases/latest)**:

| Platform | File |
| --- | --- |
| macOS (universal — Apple Silicon + Intel) | `Data.Diary_*_universal.dmg` |
| Windows | `Data.Diary_*_x64-setup.exe` |
| Linux | `data-diary_*_amd64.AppImage` |

On macOS the first launch may need a right-click → **Open** since the app isn't code-signed (Apple charges $99/year for that). It's safe — the source is right here in the repo.

## Why?

Data work is messy. You pull data, you notice something, you try something, you get distracted, you come back three days later and have to reconstruct what you did. Most people end up with a graveyard of half-named notebooks, lost queries, and "ah, I had it in a Slack DM somewhere."

Data Diary is a small, focused place to write things down as you go — one project per folder, dated sub-entries you can scroll through, a margin to-do list, and an artifacts panel for the CSVs and PDFs and links you accumulate. It saves everything as `.Rmd` (R Markdown) so the notes go wherever your analysis goes: into RStudio, onto GitHub, into a paper.

It's not a notebook. It's not a project manager. It's a diary.

## Features

- **Projects** in a searchable, sortable sidebar
- **Sub-entries within each project** — add as many timestamped entries as you want
- **Per-project to-do list** in the right margin with progress counts in the sidebar
- **Artifacts panel** — drop files (CSVs, PDFs, anything) into a project and they're copied into the project's `artifacts/` folder. Or attach link artifacts (URLs).
- **Saves to `.Rmd`** — YAML frontmatter for todos and artifacts, markdown body for entries. Opens in RStudio, renders on GitHub, plays nicely with Git.
- **Courier typewriter font**, paper-cream palette, typewriter-ribbon red accent
- **Tiny footprint** — built on Tauri, uses your system's native webview. ~10 MB installed on macOS. No Electron.
- **Autosave** every 600 ms after edits

## How it stores your work

You pick a root folder on first launch. Everything lives there as ordinary files and folders:

```
your-root/
  sales-pipeline-analysis/
    project.Rmd
    artifacts/
      raw_data.csv
      methodology.pdf
  cohort-retention-v2/
    project.Rmd
    artifacts/
      ...
```

A `project.Rmd` looks like this:

```yaml
---
title: Sales pipeline analysis
created: 2026-05-27
updated: 2026-05-27
todos:
  - text: Pull Q1 close rates
    done: true
  - text: Validate on held-out month
    done: false
artifacts:
  - name: raw_data.csv
    kind: file
    target: artifacts/raw_data.csv
    added: 2026-05-27
  - name: Forecast model docs
    kind: link
    target: https://example.com/docs
    added: 2026-05-27
---

# Sales pipeline analysis

## 2026-05-27 14:00 — model gap shrinks

Re-ran the regression after dropping the duplicate accounts…

## 2026-05-27 10:14 — first look

Pulled the data. The Q2 spike looks like an artifact of double-counted…
```

Because it's plain `.Rmd`, your notes travel with your analysis. Put the folder in a Git repo and the diary versions itself for free.

## Keyboard

- `Tab` / `Shift+Tab` — move between fields
- `Enter` in the todo box — add a new task
- `Enter` in a todo line — finish editing
- Click any artifact to open it in its default app

## Build from source

> If you just want to use the app, skip this section and grab an installer from [Releases](../../releases/latest).

You need [Rust](https://rustup.rs) and [Node.js 18+](https://nodejs.org). On macOS you also need Xcode command-line tools (`xcode-select --install`). On Linux you need the webkit2gtk / libgtk dev packages — see the [Tauri prerequisites guide](https://tauri.app/v1/guides/getting-started/prerequisites).

```bash
git clone https://github.com/Jdharden/data-diary.git
cd data-diary
npm install
npm run dev    # iterate with hot reload
# or
npm run build  # produces an installer in src-tauri/target/release/bundle/
```

First build takes 5–15 minutes (compiling Tauri's Rust deps); subsequent builds are seconds.

## Cutting a release

This repo includes a GitHub Actions workflow that builds installers for all three platforms automatically. To cut a release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Then go to the **Actions** tab and watch it work (~10 minutes). When it's done a **draft release** will be waiting in the **Releases** tab — review the notes, then click **Publish**.

## Project layout

```
data-diary/
  README.md
  LICENSE
  package.json
  .github/workflows/release.yml    ← multi-platform CI build
  docs/hero.svg                    ← README hero image
  src/                             ← frontend (vanilla HTML/CSS/JS)
    index.html
    style.css
    main.js
  src-tauri/                       ← Rust backend
    Cargo.toml
    tauri.conf.json
    src/main.rs
    icons/
```

## Tech

- **[Tauri 1.6](https://tauri.app/)** — Rust backend + system webview frontend. Same idea as Electron, ~30× smaller binaries.
- **[serde](https://serde.rs/)** + **[serde_yaml](https://docs.rs/serde_yaml/)** for the RMD round-trip.
- **No frontend framework** — vanilla HTML, CSS, and JavaScript. No build step on the frontend side.

## License

[MIT](LICENSE) — do what you want with it. If you build something on top, a star on the repo is appreciated but not required.
