# Dara's Balcony Garden

A care guide for my balcony plants, written by an AI from my own notes.

**Live:** https://balcony-garden.dara-uxdesign.workers.dev

A personal tool, customized for my needs. I write notes and take photos of the plants on my balcony. An AI reads four things: those notes, the photos, the Tampere weather forecast, and each plant's current status (stage, last watered). From them it writes short care guidance for every plant: how often to water it right now, what to feed it, what to watch for. No dates, no to-do list. The notes and photos are also kept as a growth record.

## Features

- **One list of plants.** Every plant shows its stage, how it is doing in the AI's words, when I last watered it, its season bar and its current care guidance.
- **AI care guidance.** I write a free-text note (a pest, a wilting leaf, "repotted today"), and a Gemini-powered adviser folds it, together with same-day photos and the forecast, into an updated health read and fresh guidance. See [Architecture](#architecture) below.
- **Indoor and balcony.** Plants are grouped by where they live. The forecast and the cold-night alert only apply to the balcony group, so an indoor plant never gets told to close the glazing.
- **Season bar.** Each plant's growing, flowering, fruiting and harvest spans at a glance. The species table supplies the expectation, and where a real stage change has been recorded, that date replaces the default and the bar redraws around it.
- **Watering, recorded not managed.** A small droplet button, or a "watered today" tick in the note box. It only ever answers "when did I last water this", never nags.
- **One history.** Notes and photos in one stream, newest first, for the whole garden or for one plant. A note the AI could not place lands under "Unsorted" so I can assign it myself.
- **A page per plant, with its own address.** `/p/<id>` is bookmarkable and shareable, and the back button walks the tabs. The page carries the full version of everything the list summarises.
- **About this variety.** A short lead on what the variety is and its quirks, then a fact table: family, habit, height, sowing, light, warmth, pot, water, harvest, frost, crop, and where I bought it, linked to the shop. The prose and the table do not repeat each other. Beside them, a photo of the whole plant, and for anything that fruits, a second photo of the crop.
- **Light and dark theme.**

## Architecture

Four inputs feed a server-owned status, which the AI turns into guidance, which the page renders:

```
notes ────┐
manual edits ─┤
photos ───────┼──▶ status:garden ──▶ [Gemini re-plan] ──▶ care:garden ──▶ the page
weather ──────┘
```

Two KV docs, one job each:

- **`status:garden`** is per-plant condition: `stage`, `lastWatered`, `notes[]`, `health {label, tone, issues[]}`, `observations`, and `history[]` (every recorded stage change, dated). Written by the Worker whenever a note is posted (`POST /api/notes`), a field is edited (`PUT /api/status/:id`), or the AI merges its read of plant health back in. This is the one source of truth for what is true about a plant right now. See [`src/garden.js`](src/garden.js).
- **`care:garden`** is the AI's current guidance per plant (`{generatedAt, plants: {id: {guidance}}}`). Written only by the re-plan step, never by hand. This key used to be `plan:garden`, a dated task list; the old name is still read once as a migration fallback. See [`src/planner.js`](src/planner.js).

There is no third store any more. The done-log and the client state blob (`progress:garden`) went with the task list, and `lastWatered` now lives server-side only.

**The re-plan** ([`replan()`](src/planner.js) in `src/planner.js`) runs server-side: it reads `status:garden`, fetches the 14-day Open-Meteo forecast, gathers each plant's same-day photos from the `PHOTOS` KV namespace, and sends it all as one Gemini `generateContent` REST call. The result is merged back into `status:garden` (health, observations, stage) and written fresh to `care:garden`. It runs on two triggers: the daily cron (`scheduled()` in `src/index.js`, `0 3 * * *` from [`wrangler.jsonc`](wrangler.jsonc)) and right after any note or status write (`ctx.waitUntil(replan(...))`, so a fresh note reshapes the guidance within seconds without blocking the write's response).

**When the AI has not run yet, or the call failed**, the plant says so plainly and the stores are left untouched. There is no invented fallback advice. There used to be a deterministic interval engine underneath; it is gone, because there are no dated tasks left for it to fill in.

## Tech stack

- **Front end:** one static page. [`public/index.html`](public/index.html) is the entire UI (HTML, CSS and one vanilla-JS `<script>`). No framework, no build step.
- **View logic:** [`public/garden-view.js`](public/garden-view.js) holds the pure parts (area grouping, watering labels, the history stream, season spans) as an ES module the page and the tests both load.
- **Care rules:** [`public/care-rules.js`](public/care-rules.js) holds the weather alerts and the health normaliser, shared the same way.
- **Data:** [`public/garden-data.js`](public/garden-data.js) defines the plant inventory as `window.GARDEN_SEED`.
- **Worker:** [`src/index.js`](src/index.js) serves the static site (the `ASSETS` binding) plus the APIs below, all backed by one KV namespace (`PHOTOS`, which despite the name holds photos, status and care).
- **Planner:** [`src/planner.js`](src/planner.js) is the Gemini logic, isolated from the routing. One `generateContent` REST call to `gemini-flash-latest` on the free tier, authorised by the `GEMINI_API_KEY` Worker secret. On that tier Google may use the submitted note text and photos to improve their models: fine for a hobby balcony, worth knowing before pointing it at anything sensitive.
- **Store helpers:** [`src/garden.js`](src/garden.js) holds the KV keys and the read/write/merge helpers.
- **Weather:** Open-Meteo forecast API, called from the browser for display and again server-side inside `replan()` for the AI's context. No key needed either way.

## API

All reads are public. All writes need `Authorization: Bearer <UPLOAD_PASS>`.

| Endpoint | Method | What it does |
|---|---|---|
| `/api/status` | `GET` | Full `status:garden` doc: every plant's stage, last watered, health, notes, stage history. |
| `/api/status/:id` | `PUT` | Upsert fields on one plant (`{stage}`, `{lastWatered}`). Auth. Triggers a background re-plan. |
| `/api/care` | `GET` | Current `care:garden` doc (`{generatedAt, plants}`), or `{}` if none yet. |
| `/api/notes` | `POST` | Add, edit or delete a note on a plant. Auth. Triggers a background re-plan. |
| `/api/entries` | `GET`/`POST` | The raw free-text entries, exactly as typed. `POST` needs auth and runs the distiller. |
| `/api/entries/:id` | `PATCH`/`DELETE` | Reword an entry (re-runs the distiller) or remove it. Auth. |
| `/api/photos` | `GET`/`POST` | List photo metadata, or upload one (auth, query params `date`/`plant`). |
| `/api/photos/:id` | `GET`/`PATCH`/`DELETE` | Stream one image; re-tag its plant (auth); delete it (auth). |
| `/api/cover` | `GET`/`PUT` | Read or set the whole-garden cover photo id (`PUT` auth; empty id = default). |

Anything under `/p/` is answered with the page itself, because the site is one document and the plant id is read back out of the address in the browser. `/3d` serves the 3D balcony from `public/scene.html`.

**Cron:** a `scheduled` handler runs daily at 03:00 UTC (`triggers.crons` in `wrangler.jsonc`) and calls the same `replan()` as the write triggers, so the guidance stays current even on days I change nothing by hand.

## Editing the plant list

Plants live in [`public/garden-data.js`](public/garden-data.js) as `window.GARDEN_SEED`. To change the garden:

- Edit a plant (stage, note, area) and **bump the `version` number**. The app merges the new data on next load and seeds a `status:garden` entry for any plant the server does not have yet.
- `area` is `"balcony"` (glazed, feels the forecast) or `"indoor"` (heated room, does not). Moving a plant indoors for winter is an edit here plus a version bump.
- Add `water:'YYYY-MM-DD'` to a plant to record a watering on that date.

Seeding a plant records its stage as a starting point, not as a change, so a new plant keeps the species defaults on its season bar until it actually moves stage.

## Permissions

Reads are public, no passphrase needed: status, care, entries, photos, cover. Writes need the passphrase (`UPLOAD_PASS`): adding a note, marking a plant watered, editing its stage, adding, re-tagging or deleting photos, and changing the cover. The app asks once per device and sends it as a bearer token. The `GEMINI_API_KEY` secret is separate: it authorises the Worker to call Gemini and is never exposed to the client.

## Tests

`npm test` runs `node --test`. The pure modules are covered: the store helpers and stage history, the planner's merge and parsing, the care rules, the view logic (area grouping, watering labels, the history stream, season spans), and the 3D scene's layout and art. Rendering and layout are checked by hand with `npx wrangler dev`.
