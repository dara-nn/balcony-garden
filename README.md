# Daran parvekepuutarha (Dara's Balcony Garden)

A garden care calendar.

**Live:** https://balcony-garden.dara-uxdesign.workers.dev

The app takes a small plant list and turns it into a running care schedule (what to water, pollinate, feed and prune, and when), adjusted to the local weather. It also keeps a photo diary of the plants as they grow. It's a personal tool, customized for my needs.

The UI is a mix of Finnish and English on purpose. I'm learning Finnish at a very basic level, so some labels are in Finnish to help me memorize better.

## Features

- **Month calendar** with per-day watering, pollination, feeding and prune tasks, generated from a per-plant care model.
- **Weather-aware scheduling** using the free [Open-Meteo](https://open-meteo.com/) forecast for Tampere. Hot days shorten watering intervals, and hot or cold days colour the affected cells and raise an alert (for example, close the glazing on a cold night).
- **Season chart (Kausi)** showing each plant's growing, flowering, fruiting and harvest span, with plant icons.
- **Plant guides:** tap a plant for variety-specific care, flat SVG botanical art and a reference photo.
- **Photo log (Kuvat):** a growth-photo gallery grouped by plant and date, plus a whole-garden cover photo. Photos are stored server-side, so they're the same across my devices.
- **Synced task list:** waterings, done checkmarks and plant stages stay in sync across my phone and laptop (see below).
- **Light and dark theme** toggle.

## Task sync

The task list syncs across my devices through a `/api/state` endpoint on the Worker. It stores one KV doc (`state:garden`) holding `{ updatedAt, garden2, doneLog }`.

- The client renders from local storage first, then adopts the server doc when it's newer. This runs on load and again when the tab regains focus.
- Every change pushes a debounced snapshot to the server.
- Reads are public. Writes need the same passphrase (the `UPLOAD_PASS` bearer token) as photos.
- Conflicts resolve by whole-blob last-write-wins on `updatedAt`.

So the waterings, done checkmarks and plant stages match whichever device I pick up.

## Tech and architecture

- **Front end:** one static page. [`public/index.html`](public/index.html) is the entire UI (HTML, CSS and one vanilla-JS `<script>`). No framework, no build step.
- **Data:** [`public/garden-data.js`](public/garden-data.js) defines the plant inventory as `window.GARDEN_SEED`.
- **Worker:** [`src/index.js`](src/index.js) serves the static site (the `ASSETS` binding) plus two small APIs backed by a KV namespace (`PHOTOS`):
  - Photo API: `GET/POST/PATCH/DELETE /api/photos` (list, add, re-tag, delete) and `GET/PUT /api/cover` (the whole-garden cover photo).
  - State API: `GET/PUT /api/state` (the synced task list).
  - Reads are public. Writes require `Authorization: Bearer <UPLOAD_PASS>`. Images are shrunk client-side to about 1000px JPEG before upload.
- **Config:** [`wrangler.jsonc`](wrangler.jsonc) sets `main = src/index.js`, the `public/` assets dir, and the `PHOTOS` KV namespace.
- **Weather:** Open-Meteo forecast API, called from the browser, no key required.

## Local development

```bash
npm install
npm run dev   # wrangler dev
```

`wrangler dev` serves the static site and both APIs together. Writes need the `UPLOAD_PASS` secret (see below); reads work without it.

## Deploy

```bash
npm run deploy   # wrangler deploy
```

One-time setup on the Cloudflare account:

- Create the KV namespace and wire its id to the `PHOTOS` binding in [`wrangler.jsonc`](wrangler.jsonc).
- Set the passphrase as a Worker secret:

  ```bash
  npx wrangler secret put UPLOAD_PASS
  ```

  This authorises all writes (photos, cover, task sync). It lives only as a Cloudflare secret, never in this repo.

## Editing the plant list

Plants live in [`public/garden-data.js`](public/garden-data.js) as `window.GARDEN_SEED`. To change the garden:

- Edit a plant (stage, note, etc.) and **bump the `version` number**. The app merges the new data into each browser on next load.
- Add `water:'YYYY-MM-DD'` to a plant to record a watering on that date (applied on the next version bump).
- Set `resetTasksOn:'YYYY-MM-DD'` to clear the backlog: every plant counts as watered that day, nothing overdue.

## Permissions

Reads are public, no passphrase needed. Writes need the passphrase (`UPLOAD_PASS`): adding, re-tagging or deleting photos, changing the cover, and pushing task-sync updates. The app asks for it once per device and sends it as a bearer token on write requests.
