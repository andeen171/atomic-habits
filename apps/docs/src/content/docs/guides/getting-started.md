---
title: Getting started
description: Install Atomic on the web, desktop or Android and create your first habit.
sidebar:
  order: 1
---

Atomic runs everywhere from one codebase. Your data lives on your device first — no account
needed.

## Web & desktop

- **Web:** open the hosted build or run it locally with `bun dev:web` (http://localhost:3001).
  It is a Progressive Web App, so you can *Install* it from the browser menu and use it offline.
- **Desktop:** download the latest installer from the
  [`desktop-preview` release](https://github.com/andeen171/atomic-habits/releases/tag/desktop-preview)
  (Windows, macOS, Linux), or run `cd apps/web && bun desktop:dev` with Rust installed.

## Android

Download the APK from the
[`android-preview` release](https://github.com/andeen171/atomic-habits/releases/tag/android-preview):

- `atomic-<sha>.apk` — the standalone app. Install it and open it.
- `atomic-dev-client-<sha>.apk` — a development build. Run `bun dev:native` on your computer and
  open the app to load the JavaScript from Metro with hot reload.

Both are signed with a debug key, so Android will ask you to allow installs from unknown sources.

## Your first habit

1. On first launch, pick who you want to become (for example *I am a reader*).
2. Choose up to three starter habits — they come with **two-minute versions** so starting is
   effortless.
3. On **Today**, tap a habit's ring to log it. Count habits (8 glasses of water) increment with
   each tap; long-press (or right-click) for more actions such as skip, add a note or reset the day.

Want to look around first? Choose **Explore with sample data** on the welcome screen.

## Keyboard shortcuts (web & desktop)

| Shortcut | Action |
| --- | --- |
| `⌘K` / `Ctrl K` | Command palette |
| `H` | New habit |
| `N` | New task |
| `G` then `T` / `H` / `K` | Go to Today / Habits / Tasks |
| `←` / `→` | Previous / next day on Today |
| `?` | Show all shortcuts |
