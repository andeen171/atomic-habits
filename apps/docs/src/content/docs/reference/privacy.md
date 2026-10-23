---
title: Privacy
description: What Atomic stores, where, for how long and who processes it — LGPD roles, retention, the AI policy, encryption and the Sync journal switch.
sidebar:
  order: 3
---

This page describes how the Atomic software handles personal data, on the device and on a server.
It is the technical basis for a privacy policy, not the policy itself: the policy of a server is
the page its operator sets in `PRIVACY_URL`, which the apps link to.

## The short version

- **Without an account, nothing leaves your device.** No analytics, no tracking, no ads.
- With an account, your data is copied to the server you chose (Atomic Cloud by default) so it can
  be backed up and synced. On the server it is **not end-to-end encrypted**.
- **The journal can stay on your device:** turn off **Sync journal**.
- **AI is opt-in.** Only the text you ask about is sent, nothing is kept, and the **journal is never
  sent**.
- You can download everything (a .zip with photos) and delete your account at any time.

## Who is responsible (LGPD)

| Role | Who |
| --- | --- |
| **Controller** (*controlador*) | The operator of the server: for **Atomic Cloud**, the operator named in its privacy policy; for a **self-hosted** server, whoever runs it. Without an account there is no controller: the data never leaves the device |
| **Processors** (*operadores*) of Atomic Cloud | The providers in the table below, each limited to what its service needs |

Processors in the Atomic Cloud setup ([`deploy/`](/guides/self-hosting/#the-zero-cost-recipe-atomic-cloud)):

| Provider | Service | Personal data it handles |
| --- | --- | --- |
| Oracle Cloud | The virtual machine (São Paulo region) running the server, the database and the AI model | Everything the server stores (below) |
| Cloudflare | R2 storage for photos and database backups; DNS; hosting of the static web app | Photos and database backups (encrypted at rest by the provider); request metadata |
| Resend | Sending email | Your email address and the message (confirmation and password-reset links) |
| Stripe | Payments, only if you upgrade | Your email, the subscription and payment details. Stripe keeps invoices as tax law requires, also after you delete your account |
| Google | "Continue with Google", only if you use it | Your sign-in with Google; the server only checks the token against Google's public keys |
| UptimeRobot | Uptime checks | None (it only reads `/healthz`) |

Atomic Cloud's AI model runs **on its own server**, so no AI provider receives your text. A
self-hosted server that uses a hosted AI provider must name it; the consent screen shows the name.
Several of these providers operate outside Brazil; the operator's privacy policy states the
safeguards for those transfers (LGPD art. 33).

## What is stored where

**On your device:** everything you create (habits, logs, tasks, identities, Scorecard, journal,
tracker entries, photos), your settings, and small preferences such as dismissed cards and drafts.
It stays there until you delete it, reset the app or uninstall it. **Export backup** writes it to a
JSON file (without photos).

**On the server, with an account:**

| Data | Why | Kept until |
| --- | --- | --- |
| Name, email, password hash, email-confirmed flag | Your account | Account deletion |
| Everything you sync (as JSON documents) | Backup and sync | Account deletion. Deleted items are kept as deletion markers that still hold their last content (there is no compaction yet) |
| Photos of your tracker entries (re-encoded on the device, without location or other metadata) | Photo backup | Deleted after 7 days once no entry references them (entries deleted in the last 30 days still count); all at once on account deletion |
| Signed-in devices: a device label ("Atomic Android · Pixel 8"), the IP address and timestamps | Your device list and security | The session expires (30 days without use) or is signed out |
| AI consent (date) and the translation switch | Proving and honoring your choice | You withdraw it, or account deletion |
| Daily AI counts (requests, characters, output tokens) | Quotas | 40 days |
| Plan, subscription and plan grants | Billing | Account deletion (Stripe keeps its own records) |
| Single-use download links (as hashes) | Download account data | Used or expired (10 minutes), then pruned |

**Logs** never contain content: one line per request with the route *template* (never a query
string, token or photo hash), the status and the duration. No bodies, emails, user ids or IP
addresses. The TLS proxy's access log masks client addresses (/24 for IPv4, /48 for IPv6) and drops
tokens. Logs rotate (Docker keeps 5 × 10 MB per service). **Metrics** are counters by route and
outcome, never ids or text.

## Encryption

- **In transit:** HTTPS (TLS) between the apps and the server.
- **At rest:** the server stores documents as plain JSON in SQLite. The hosting providers encrypt
  their disks and buckets, but the server itself, and therefore its operator, can read what you
  sync. **There is no end-to-end encryption in v2.**
- **The Sync journal switch** is the privacy control for the most personal part of the app: with it
  off, journal entries written on that device are never sent. Entries already synced stay on the
  server until you delete them (and, as deletion markers, until you delete the account). The switch
  is per device; turn it off on each device where you write.

## The AI policy

- **Opt-in, per account.** Consent is recorded on the server (date and choice), so it follows you
  to other devices and can be shown and withdrawn. Translation is a separate switch, off by default.
- **Data minimization.** A request carries only the text in question and the field it belongs to
  (for example the habit's name and its identity statement), never your history.
- **Never the journal.** Journal entries, day notes and tracker entries are never sent to AI, never
  translated and never used for the on-device typing suggestions.
- **No retention.** Requests and answers are never logged, cached or stored, and never used for
  training. Only the daily counts above are kept.
- **Beta.** Every AI surface says so; answers can be wrong and you choose what to keep.
- **Kill switch.** The operator can turn AI off for everyone (`AI_FEATURES=`); apps hide it within an
  hour.
- Withdrawing consent stops AI immediately; turning translation off deletes the stored translations.

## Your rights (LGPD art. 18)

| Right | How |
| --- | --- |
| Confirmation and access | **Download account data**: a .zip with every document and every photo of your live entries |
| Portability | The same .zip (JSON export format v2), and **Export backup** on any device |
| Correction | Edit anything in the app; changes sync |
| Deletion | **Delete account** erases the account, every document, every photo and the Stripe customer at once |
| Withdrawing consent | Turn off AI suggestions and translation |
| Information | This page and the operator's privacy policy |

**Backups and erasure.** A deleted account disappears from the live database immediately, and the
database zeroes what it deletes. Backups taken before the deletion keep it until they age out: on
Atomic Cloud, 7 days for the continuous database backup and for the nightly snapshots (photos in R2
are deleted at once). If a backup is ever restored, the server deletes those accounts again from an
erasure log that holds only a hash of each deleted account's id.

## On the device

- Photos are re-encoded before they are stored, which removes location and camera metadata.
- Typing suggestions and template translation run entirely on the device.
- The claude.ai artifact version keeps each viewer's data in a private space of the artifact's own
  storage on claude.ai, and has no account, AI, photos or server sync.
