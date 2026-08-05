# Daran parvekepuutarha (Dara's Balcony Garden)

A garden care calendar with an AI plant journal.

**Live:** https://balcony-garden.dara-uxdesign.workers.dev

The app takes a small plant list and turns it into a running care schedule (what to water, pollinate, feed and prune, and when), adjusted to the local weather and to what I actually write down about each plant. It also keeps a photo diary of the plants as they grow. It's a personal tool, customized for my needs.

The UI is a mix of Finnish and English on purpose. I'm learning Finnish at a very basic level, so some labels are in Finnish to help me memorize better.

## Features

- **Month calendar** with per-day watering, pollination, feeding and prune tasks.
- **AI plant notes and daily planner:** write a free-text note on any plant (a pest, a wilting leaf, "repotted today"), and a Gemini-powered planner folds it — together with same-day photos and the forecast — into an updated health read and the next 14 days of tasks. See [Architecture](#architecture) below.
- **Weather-aware scheduling** using the free [Open-Meteo](https://open-meteo.com/) forecast for Tampere. Hot days shorten watering intervals, and hot or cold days colour the affected cells and raise an alert (for example, close the glazing on a cold night).
- **Season chart (Kausi)** showing each plant's growing, flowering, fruiting and harvest span, with plant icons.
- **Plant guides:** tap a plant for variety-specific care, flat SVG botanical art and a reference photo, plus its live status (stage, health, notes) and a "last updated" timestamp for the AI plan.
- **Photo log (Kuvat):** a growth-photo gallery grouped by plant and date, plus a whole-garden cover photo. Photos are stored server-side, so they're the same across my devices, and the planner reads same-day photos too.
- **Synced task list:** done checkmarks stay in sync across my phone and laptop (see below).
- **Light and dark theme** toggle.

## Architecture

Four inputs feed a server-owned status, which an AI planner turns into a plan, which the calendar renders — with a deterministic fallback engine underneath for anything the AI hasn't covered:

```
notes ────┐
manual edits ─┤
photos ───────┼──▶ status:garden ──▶ [Gemini re-plan] ──▶ plan:garden ──▶ calendar
weather ──────┘         ▲                                      │
                         └──────────── (fallback: buildTasks) ◀─┘
                                        progress:garden (done marks, client-only)
```

Three KV docs, one job each, deliberately *not* named alike so "state" and "status" can't get confused in code or conversation:

- **`status:garden`** — per-plant condition: `stage`, `lastWatered`, `intervalOverride`, `notes[]`, `health {overall, issues[]}`, `observations`. Written by the Worker whenever a note is posted (`POST /api/notes`), a manual field is edited (`PUT /api/status/:id`), or the AI planner merges its read of plant health back in. This is the one source of truth for "what is true about this plant right now" — see [`src/garden.js`](src/garden.js).
- **`plan:garden`** — the AI's per-plant, per-day task list for the next 14 days (`{generatedAt, through, plants: {id: {date: [tasks]}}}`). Written *only* by the planner's re-plan step, never by hand. See [`src/planner.js`](src/planner.js).
- **`progress:garden`** — the synced done-log and cached client state (`{updatedAt, garden2, doneLog}`). Written only by the client, via `GET/PUT /api/progress` — the server never touches it. This key used to be called `state:garden`; the old name is still read once as a migration fallback in [`src/index.js`](src/index.js).

**The re-plan itself** ([`replan()`](src/planner.js) in `src/planner.js`) runs server-side: it reads `status:garden`, fetches the 14-day Open-Meteo forecast, gathers each plant's same-day photos from the `PHOTOS` KV namespace, and sends it all as one Gemini `generateContent` REST call. The result is merged back into `status:garden` (updated health/observations/stage) and written fresh to `plan:garden`. It runs on two triggers: the daily cron (`scheduled()` in `src/index.js`, `0 3 * * *` from [`wrangler.jsonc`](wrangler.jsonc)) and right after any note or status write (`ctx.waitUntil(replan(...))`, so a fresh note reshapes the plan within seconds without blocking the write's response).

**The calendar's task engine** ([`buildTasks()`](public/index.html) in `public/index.html`) overlays the AI plan day-by-day for whatever `plan:garden` actually covers (up to 14 days out, `through`), and falls back to the original deterministic per-plant interval math for everything else: days beyond the 14-day plan horizon, plants with no plan yet, or — if a re-plan call fails outright (network error, bad response, missing key) — the *entire* board, since the stores are simply left untouched on failure. The deterministic engine was the whole app before this feature; it never got removed, it just moved from "the plan" to "the plan's safety net."

## Task sync

Done checkmarks sync across my devices through a `GET/PUT /api/progress` endpoint on the Worker (renamed from `/api/state`; the old KV key `state:garden` is read once as a fallback if the new one is empty). It stores one KV doc (`progress:garden`) holding `{ updatedAt, garden2, doneLog }`.

- The client renders from local storage first, then adopts the server doc when it's newer. This runs on load and again when the tab regains focus.
- Every change pushes a debounced snapshot to the server.
- Reads are public. Writes need the same passphrase (the `UPLOAD_PASS` bearer token) as photos and notes.
- Conflicts resolve by whole-blob last-write-wins on `updatedAt`.

## Tech stack

- **Front end:** one static page. [`public/index.html`](public/index.html) is the entire UI (HTML, CSS and one vanilla-JS `<script>`). No framework, no build step. It reads `status:garden` and `plan:garden`, overlays the AI plan on the calendar, and renders the notes/status editor and photo log.
- **Data:** [`public/garden-data.js`](public/garden-data.js) defines the plant inventory as `window.GARDEN_SEED`, used to seed a plant's first `status:garden` entry.
- **Worker:** [`src/index.js`](src/index.js) serves the static site (the `ASSETS` binding) plus the APIs below, all backed by one KV namespace (`PHOTOS`, which despite the name now holds photos, status, plan and progress — see `src/garden.js`).
- **Planner:** [`src/planner.js`](src/planner.js) — the Gemini re-plan logic, isolated from the routing in `src/index.js`.
- **Store helpers:** [`src/garden.js`](src/garden.js) — the three KV keys and the read/write/merge helpers.
- **Config:** [`wrangler.jsonc`](wrangler.jsonc) sets `main = src/index.js`, the `public/` assets dir, the `PHOTOS` KV namespace, and the daily cron trigger (`triggers.crons`).
- **Weather:** Open-Meteo forecast API — called from the browser for the calendar's display, and again server-side inside `replan()` for the AI's planning context. No key required either way.

## API

All reads are public. All writes need `Authorization: Bearer <UPLOAD_PASS>`.

| Endpoint | Method | What it does |
|---|---|---|
| `/api/status` | `GET` | Full `status:garden` doc — every plant's stage, last-watered, health, notes. |
| `/api/status/:id` | `PUT` | Upsert fields on one plant (e.g. `{stage}` or `{lastWatered}`). Auth required. Triggers a note-style re-plan in the background. |
| `/api/notes` | `POST` | Add/edit/delete a note on a plant: `{plantId, op: 'add'\|'edit'\|'delete', id?, date?, text?}`. Auth required. Triggers a background re-plan. |
| `/api/plan` | `GET` | Current `plan:garden` doc (`{generatedAt, through, plants}`), or `{}` if none exists yet. |
| `/api/progress` | `GET`/`PUT` | The synced done-log / client-state doc (`progress:garden`). `PUT` needs auth. |
| `/api/photos` | `GET`/`POST` | List all photo metadata, or upload one (`POST`, auth, query params `date`/`plant`). |
| `/api/photos/:id` | `GET`/`PATCH`/`DELETE` | Stream one image; re-tag its plant (auth); delete it (auth). |
| `/api/cover` | `GET`/`PUT` | Read or set the whole-garden cover photo id (`PUT` auth; empty id = default). |

**Cron:** a `scheduled` handler runs daily at 03:00 UTC (`triggers.crons` in `wrangler.jsonc`) and calls the same `replan()` used by note/status writes, so the plan stays current even on days nothing changes by hand.

## Editing the plant list

Plants live in [`public/garden-data.js`](public/garden-data.js) as `window.GARDEN_SEED`. To change the garden:

- Edit a plant (stage, note, etc.) and **bump the `version` number**. The app merges the new data into each browser on next load, and seeds a `status:garden` entry for any plant the server doesn't have yet.
- Add `water:'YYYY-MM-DD'` to a plant to record a watering on that date (applied on the next version bump).
- Set `resetTasksOn:'YYYY-MM-DD'` to clear the backlog: every plant counts as watered that day, nothing overdue.

## Permissions

Reads are public, no passphrase needed: status, plan, progress, photos, cover. Writes need the passphrase (`UPLOAD_PASS`): adding a note, editing a plant's stage or watering date, adding/re-tagging/deleting photos, changing the cover, and pushing task-progress updates. The app asks for it once per device and sends it as a bearer token on write requests. The `GEMINI_API_KEY` secret is separate — it authorises the Worker to call Gemini and is never exposed to the client.
