---
title: Getting started
description: Install Atomic on the web, desktop or Android, create your first habit and find your way around Today.
sidebar:
  order: 1
---

Atomic runs everywhere from one codebase. Your data lives on your device first: no account
needed. When you want a backup or a second device, sign in to Atomic Cloud (or your own server).

## Web & desktop

- **Web:** open the hosted build or run it locally with `bun dev:web` (http://localhost:3001).
  It is a Progressive Web App, so you can *Install* it from the browser menu and use it offline.
- **Desktop:** download the latest installer from the
  [`desktop-preview` release](https://github.com/andeen171/atomic-habits/releases/tag/desktop-preview)
  (Windows, macOS, Linux), or run `cd apps/web && bun desktop:dev` with Rust installed.

## Android

Download the APK from the
[`android-preview` release](https://github.com/andeen171/atomic-habits/releases/tag/android-preview):

- `atomic-<sha>.apk`: the standalone app. Install it and open it.
- `atomic-dev-client-<sha>.apk`: a development build. Run `bun dev:native` on your computer and
  open the app to load the JavaScript from Metro with hot reload.

Both are signed with a debug key, so Android will ask you to allow installs from unknown sources.
When a newer APK is out, the app tells you ("Atomic {version} is available · Download").

## Your first habit

1. On first launch, pick who you want to become (for example *I am a reader*). Already use Atomic
   on another device? **Sign in** on the welcome screen instead, and your data comes with you.
2. Choose up to three starter habits. They come with **two-minute versions** so starting is
   effortless, and they wear their identity's icon. Habits marked **Logged in the app** are done
   inside Atomic: a reading log, a timer, an expense log (see [Trackers](/guides/trackers/)).
3. On **Today**, tap a habit's ring to log it. Count habits (8 glasses of water) go up one per tap
   until the daily goal; past it, a **+1** button logs extra reps that count toward your monthly
   goal. Long-press (or right-click) for more: **Log amount…**, skip the day, add a note.

Want to look around first? Choose **Explore with sample data** on the welcome screen: four months
of history with journal entries, recurring tasks and tracker habits.

## Today at a glance

- **The principle of the day** sits at the top, a short idea from the book. Hide it for the day if
  you like.
- **Your habits**, grouped by time of day. Tracker habits open their tracker when you tap the ring.
  When a monthly goal needs a push, the row says so ("+3 pages/day wins October").
- **At most one or two cards** above your habits, in order of what matters most: a running timer,
  *never miss twice* after a missed day (with your comeback plan if you wrote one), a **level-up**
  suggestion in the first week of the month after a strong month, a reflection prompt from the
  journal, or a *monthly goal behind* card in the last week of the month.
- **Today's tasks**, including recurring ones and the setup tasks you created with your habits.

## Creating more

The **⊕ Create** button offers **New habit**, **New task** and **Journal entry**.

- **New habit** starts with *Who do you want to become?*, then *What will you do?*, then the four
  laws: make it obvious, attractive, easy and satisfying (or their inversions to break a habit).
  Along the way you can turn your plan into **setup tasks** ("Put the book on my pillow"), pick
  **how you'll log it**, and ask the AI beta for ideas if you're signed in. See
  [The method](/guides/method/).
- **New task** can repeat: on fixed days, or "after I finish" (water the plants 7 days after the
  last time).
- **Journal entry** opens the [journal](/guides/journal/): evidence, a comeback plan, a review…

## Keyboard shortcuts (web & desktop)

| Shortcut | Action |
| --- | --- |
| `⌘K` / `Ctrl K` | Command palette |
| `H` | New habit |
| `N` | New task |
| `J` | New journal entry |
| `G` then `T` / `H` / `K` / `J` | Go to Today / Habits / Tasks / Journal |
| `←` / `→` | Previous / next day on Today |
| `?` | Show all shortcuts |

## Next

- [The method](/guides/method/): how the book's ideas show up in the app.
- [The journal](/guides/journal/) and [Trackers](/guides/trackers/).
- [Account, sync and AI](/guides/account/): backups, devices, plans and privacy controls.
