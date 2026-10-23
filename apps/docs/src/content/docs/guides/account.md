---
title: Account, sync and AI
description: Accounts, sync between devices, plans, the AI beta, translation and your privacy controls.
sidebar:
  order: 5
---

**You don't need an account.** Everything in Atomic works offline on one device, and without an
account nothing ever leaves it. An account adds three things: a backup on a server, the same data
on all your devices, and the optional AI beta.

## Where it lives

- **Settings → Account & sync** on every app, with a link to the full **Account** page.
- On phones, the account row at the top of **You**. On the web and desktop, the sync indicator in
  the sidebar also opens the Account page.

## Atomic Cloud or your own server

The apps sign in to **Atomic Cloud**, the official server, by default. To use a server you run
yourself, open **Advanced · self-hosting** in the sign-in dialog and enter its URL (see
[Self-hosting](/guides/self-hosting/)). Everything on this page works the same on both, except
that each server decides which extras it offers: email, Google sign-in, billing, AI and photo
backup can each be switched off.

## Signing in

- **Email and password** (8 to 128 characters). When the server sends email, you get a link to
  confirm your address, and **Forgot password?** sends a reset link. A password reset signs out
  every device.
- **Continue with Google** on the web and Android, when the server offers it. It isn't available in
  the desktop app.
- **First sign-in on a device that already has data.** If your account has data too, Atomic asks
  what to do: **Merge both** (everything is kept; where the same item was edited on both sides, the
  latest edit wins), **Use only the account's data** (this device's data is replaced by the
  account's; your settings stay) or **Don't sign in**.

## How sync works

- Every change is saved on the device first, then sent a few seconds later, every five minutes and
  whenever the device comes back online. **Sync now** forces a round.
- The status reads "Backed up {time}" or "{count} changes waiting to sync". Changes never get lost
  while you're offline; they wait.
- When the same habit, task or entry was changed on two devices, the most recent edit wins for the
  whole item.
- **Sign out** keeps your data on the device. Signing in again asks whether to merge.
- Messages you may see: *your server is older than this app* (some new data waits until the server
  is updated), *your device clock is off* (set it right; meanwhile Atomic corrects the times it
  saves), *sync storage is full* (new
  changes stay on the device), *edited on a newer version of Atomic — update to edit this* (an item
  changed by a newer app version is read-only until you update).

### Two switches, per device

- **Sync journal** (on by default). Off: journal entries written on this device stay on it; entries
  from your other devices still arrive. Useful on a shared or work device, or if you prefer the
  journal never to reach a server.
- **Back up photos** (on by default, shown when the server offers photo backup). Off: photos from
  this device stay on it.

## Your devices and security

- **Devices** lists every signed-in device ("Atomic Web · Chrome (macOS)", "Atomic Android ·
  Pixel 8") with when it was last active. Sign out one, or **Sign out of all other devices**.
- **Change password** (accounts with a password) can sign out your other devices at the same time.

## Plans

| | No account | Free | Pro |
| --- | --- | --- | --- |
| Habits, tasks, identities, journal, trackers, insights, local photos | ✓ | ✓ | ✓ |
| Sync and backup on every device | — | ✓ (50 MB) | ✓ (500 MB) |
| Download account data (.zip) | — | ✓ | ✓ |
| Typing suggestions and template translation (on the device) | ✓ | ✓ | ✓ |
| Photo backup | — | 100 MB | 5 GB |
| AI suggestions per day | — | 10 | 150 |
| AI translation per day | — | 2,000 characters | 40,000 characters |

- Habits, tasks, the journal, trackers, sync and export are free forever. Pro buys AI capacity,
  photo storage and sync headroom.
- **Upgrade** opens a secure Stripe checkout in your browser; **Manage billing** opens Stripe's
  portal to change your card, switch between monthly and yearly, or cancel. Canceling keeps Pro
  until the end of the paid period. If a payment fails, Pro stays on for a grace period while you
  update your card.
- On a server without billing (most self-hosted servers), everyone gets everything: "Everything is
  included on this server."
- Store builds of the Android app show your plan but don't sell it.
- **Downgrading never holds your data hostage**: over the photo limit, your photos stay viewable
  and new ones stay on the device; over the sync limit, new changes wait on the device.

## AI assistant (beta)

AI is **off until you turn it on**, needs an account, and every AI surface carries a **Beta**
badge. The sparkle button suggests, and you always choose what to keep:

- habit names, two-minute versions, when and where (implementation intentions) and habit stacks;
- **Fill the four laws** for a new habit, and setup tasks;
- identity statements and a task's first step.

What happens when you ask:

- Only the text you ask about is sent (for example the habit's name and its identity), never your
  history. **Your journal is never sent**, and neither are notes or tracker entries.
- On Atomic Cloud the model runs on Atomic's own server. A server that uses a third-party provider
  names it in the consent screen.
- Nothing is stored, logged or used for training: requests are processed and forgotten. The server
  keeps only a count of requests per day for your quota (it resets at 00:00 UTC).
- When the server sends email, AI needs a confirmed address.
- You can turn AI off at any time in **Settings → AI assistant**.

## Typing suggestions and translation

- **Suggestions while typing** complete words and phrases from the templates and your own habits
  and tasks. It runs entirely on the device, works offline, and never uses your journal. You can
  turn it off in Settings.
- **Template text follows the app language.** A habit created from a template in Portuguese reads
  in English when you switch to English, offline, with no AI.
- **Translate my content to the app language** (an AI option, off by default) translates your own
  habits, identities, open tasks and Scorecard lines. Translated text shows "Translated from …" with
  **Show original**; editing always changes the original. Journal entries, notes and tracker
  entries are never translated. Turning it off deletes the translations.
- **Show my habits in the app language** can be turned off to always see the text as you wrote it.

## Your data

- **Export backup** (Settings → Your data) saves everything on this device as a JSON file you can
  import anywhere. It doesn't include photos.
- **Download account data** (Account page) gives you a .zip with everything stored on the server,
  photos included. The link works once and expires after 10 minutes.
- **Delete account** permanently deletes your account and everything on the server, cancels a Pro
  subscription immediately, and signs out your other devices. You choose to **Keep my data on this
  device** or **Also erase this device**. It asks for your password, or a fresh Google sign-in for
  accounts without one.

What is stored where, for how long, and by whom: [Privacy](/reference/privacy/).
