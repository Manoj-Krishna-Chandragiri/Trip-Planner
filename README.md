# Trip Planner

Describe a trip in plain text, get a day-by-day itinerary you can reorder,
expand, and edit — with every stop checked against real map data instead
of trusted on the model's word.

## Setup

**Backend:**
```bash
cd server
npm install
cp .env.example .env   # add your free Gemini key
npm start                # http://localhost:3001
```

**Frontend (separate terminal):**
```bash
cd client
npm install
npm start                 # http://localhost:5173, proxies /api to the backend
```

Gemini key (free): https://aistudio.google.com/apikey — no key needed for
Nominatim, OSRM, or Overpass (all free, public, no signup).

## Deployment (Vercel)

Client and API deploy together as one Vercel project:

- **`api/index.js`** — the actual serverless entry point Vercel invokes.
  It just re-exports `server/app.js` (the Express app, minus `app.listen`),
  so production runs the exact same route/middleware/error-handling code
  as local dev. `server/index.js` is local-dev-only — it imports that same
  app and calls `.listen()`, and never runs on Vercel.
- **`vercel.json`** — builds the client (`client/dist`) as the static
  output, and rewrites every `/api/*` request to `api/index.js`. Express's
  own routing (`app.use('/api/plan', ...)`) handles dispatch from there
  using the original request path.
- **Root `package.json`** — exists only so Vercel's install step puts
  the backend's dependencies (`express`, `cors`, `@google/generative-ai`,
  `dotenv`) somewhere `api/index.js` can resolve them via Node's normal
  upward module resolution. Not used for local dev.

To deploy: import this repo in the Vercel dashboard (it picks up
`vercel.json` automatically), then add one environment variable —
**`GEMINI_API_KEY`** — under Project Settings → Environment Variables,
and deploy.

**Known trade-off**: `server/services/geocode.js`'s Nominatim rate
limiter is an in-memory serial queue, which only holds within a single
serverless instance — under concurrent cold starts, two instances could
each independently stay under 1 req/sec while the combined total briefly
exceeds it. Not an issue at demo/interview traffic levels; would need a
shared external rate limiter (e.g. Redis-backed) to hold at real scale.

## Architecture

- **`server/services/gemini.js`** — calls Gemini with a `responseSchema`,
  constraining it to return structured JSON (itinerary or a refinement
  diff), never prose. Malformed/unusable output is caught here and tagged
  `isOutputError` so the route layer can tell "the model said something
  broken" apart from "the API call itself failed."
- **`server/services/geocode.js`** — Nominatim geocoding through a serial
  rate-limit queue (1 req/sec, per OSM's usage policy). Confirms each stop
  is a real place and gets its coordinates.
- **`server/services/routing.js`** — OSRM travel time/distance between
  consecutive stops. Never throws; returns `null` on failure so a slow
  routing API can't take down the itinerary.
- **`server/services/enrichItinerary.js`** — orchestrates the above:
  validates Gemini's shape, geocodes every stop, computes travel times,
  and flags a day `tight` if its stops + travel time exceed 14 hours
  (audits the model's own pacing against real travel data, not just
  whether the places exist).
- **`server/services/overpass.js`** — fallback path. If the Gemini call
  fails outright (timeout/down/rate-limited, not just bad output), this
  builds a real itinerary from OpenStreetMap POIs near the geocoded
  destination, with zero LLM involvement. The app degrades instead of
  dying; the UI marks it clearly as a basic, non-personalized plan.
- **`server/routes/refine.js`** — follow-up edits return a diff (`add` /
  `replace` / `remove` ops) instead of a full regenerated itinerary, so
  manual edits (removed stops, reordering) survive a refinement request.
- **`client/src/hooks/useTripPlanner.js`** — the state machine. Uses an
  `AbortController` *and* a request-ID counter together: if you submit
  twice quickly, the older request is cancelled and, even if it still
  resolves, its result is discarded rather than overwriting the newer one.
- **`client/src/components/ItineraryView.jsx`** — drag-and-drop reordering
  (`@hello-pangea/dnd`) with up/down buttons as a mobile-safe fallback,
  per-day Leaflet map plotting only geocoded stops, expandable stop cards.

## Key decisions & trade-offs

- **Nutrition/coordinates/travel-time-style numbers are never asked of the
  LLM.** Gemini proposes places and reasoning; Nominatim/OSRM/Overpass
  supply anything that needs to be *true*, not just plausible.
- **Two distinct failure paths, on purpose**: bad model output (422, no
  fallback, user can retry) vs. the model being unreachable (Overpass
  fallback, app stays usable). Conflating these would mean either
  fallback-ing on garbage output (hiding a real bug) or erroring out when
  the API is just slow (throwing away a recoverable case).
- **Drag-and-drop *and* buttons** for reordering — touch drag can be
  unreliable, so the up/down buttons guarantee the required feature works
  on mobile regardless.
- **No Zod/validation library** — the shape validator in
  `enrichItinerary.js` is hand-rolled (~20 lines) so every check is
  explainable without needing to explain a dependency's internals too.

## AI usage note

Built with AI assistance across three tools/sessions:

- **Google Antigravity (Gemini 3.1 Pro)** scaffolded the backend — the
  Gemini integration with schema-constrained JSON output, the
  Nominatim/OSRM/Overpass grounding services, the diff-based refinement
  route — and the core `useTripPlanner` state-management hook (the
  request-ID + AbortController race-condition guarding, in particular).
- **Claude** built out the frontend components, drag-and-drop itinerary
  view, and ported the approved Figma design (color tokens, fonts,
  animation timing) into plain CSS after Antigravity's usage limit was
  hit mid-task.
- **Claude Code** was used for iterative debugging and polish passes
  after the fact: fixing a dark-mode contrast bug (a `<button>` wasn't
  inheriting the theme's text color and rendered black-on-black),
  restructuring the welcome screen to be full-bleed instead of trapped
  in a narrow centered column, and tracking down a genuinely subtle bug
  where the location-permission modal was rendering off-screen — its
  `position: fixed` overlay was being re-anchored by a `transform` on an
  ancestor element instead of the viewport, fixed by rendering it
  through a React portal.

All architecture decisions — schema design, the two-tier failure
strategy (bad output vs. unreachable model), the fallback approach, what
gets asked of the LLM vs. verified against real data — were directed and
reviewed by me throughout, and I can explain and modify every file in
this repo.

## Known limitations

- Nominatim/OSRM/Overpass are all free public instances with no uptime
  guarantee and modest rate limits — fine for this project's scale, not
  for production traffic.
- The Overpass fallback doesn't compute travel times between its stops,
  or an origin distance chip — only the primary Gemini path does.
- Travel *distance* always comes from OSRM's real road network
  regardless of transport mode. Travel *duration* is OSRM's real
  driving-profile estimate when mode is Driving/unset, and a
  speed-table estimate (5/15/50/25/80 km/h for
  walking/cycling/driving/transit/train) for other modes — the public
  OSRM instance only hosts a driving routing graph, so non-driving
  durations are honestly labeled "(est.)" in the UI rather than
  presented as measured.
- The origin-to-first-stop distance is computed once, at itinerary
  creation. If the user later reorders or removes Day 1's first stop,
  the chip keeps referencing the original first stop rather than
  recalculating — a known staleness edge case, not a crash risk.
- No persistence — refresh the page and the itinerary is gone.
- During a refinement request, the full itinerary view is replaced by the
  generic loading state rather than staying visible with an inline
  "updating…" indicator — functional, but a rougher UX than ideal; worth
  revisiting if there's time before submission.

## Time spent

~10 hours total.
