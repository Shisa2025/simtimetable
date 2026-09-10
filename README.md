# SIM Campus Assistant

An independent, local-first student tool for planning a day at SIM. Add a personal class
timetable from an ICS file or by hand, see the next class and weekly agenda, and get study-room
suggestions drawn only from campus windows explicitly marked **Free Access**.

| | |
| --- | --- |
| **Live site** | https://simtimetable.vercel.app |
| **Repository** | https://github.com/Shisa2025/simtimetable |
| **Official data source** | https://scheduling.sim.edu.sg/rad/campus.htm?id=SIM |

This project is not affiliated with, operated by, or endorsed by Singapore Institute of
Management (SIM).

## Student experience

- **Today** — current and next class, countdown, room details, and the gap before the next lesson.
- **Week** — a seven-day timetable that includes weekend classes.
- **Study suggestions** — up to three confirmed Free Access rooms that cover the gap, with the
  next class's block ranked first and a configurable travel buffer.
- **Local timetable** — choose class series from a local ICS file or add repeating classes by hand;
  export, restore, or clear the saved profile at any time.
- **Time lens** — move through the day in 30-minute steps and see matching room counts at a glance.
- **Free Access results** — rooms available at the selected time, sorted by capacity fit and remaining duration.
- **Day schedule** — each result expands to its Free Access, busy, and unknown timeline.
- **Full schedule** — every published booking, with live status calculated in Singapore time.
- Filters for block, floor, room, capacity, and required duration.
- Light, dark, and system themes; responsive cards for mobile screens.

The site never treats a room with no booking as open. SIM often locks unallocated labs,
tutor rooms, and other spaces, so those periods are labelled **Unknown / may be locked**.

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Ad-free personal Today and Week workspace |
| `/rooms` | Time-lens Free Access finder and full published timetable |
| `/viewer` | Backwards-compatible redirect to `/rooms` |
| `/advanced` | Bookmarklet, scraper, and JSON import tools |
| `/about` | Data source, definitions, and limitations |
| `/privacy` | Local storage, hosting, and advertising disclosures |
| `/ads.txt` | AdSense authorised seller declaration |

## Data flow

SIM's public scheduling page exposes its campus data through:

```text
GET https://scheduling.sim.edu.sg/rad/rest/campus?id=SIM
    → buildings[] → rooms[] → activities[]
```

The endpoint is same-origin and protected by a WAF that rejects ordinary HTTP clients. The
shared scraper therefore runs in a real Chromium browser. GitHub Actions runs it shortly after
midnight Singapore time and commits `data/latest.json`. The website reads the published file
from `Shisa2025/simtimetable` and keeps the last successful snapshot in browser local storage as
an offline fallback. The personal assistant profile is stored separately in
`localStorage['sim-campus-assistant-profile-v1']`; no account or application server receives the
selected classes.

The bookmarklet on `/advanced` can obtain a newer mid-day snapshot. It opens the room finder,
passes the data directly between the two browser tabs using `postMessage`, and requires an
acknowledgement from the tab it opened. If that handoff fails, it downloads JSON instead.

## Developing

There is no build step. ICAL.js 2.2.1 is vendored under `assets/vendor` so calendar imports do not
depend on a CDN or another runtime service.

```bash
node scripts/serve.mjs
```

Open http://localhost:4173. The local server mirrors Vercel's clean URLs.

Fetch the latest schedule locally (requires Chrome or Edge):

```bash
node scripts/fetch-schedule.mjs
```

Run the browser-based checks with the local server running:

```bash
node scripts/test-ui.mjs
node scripts/test-handoff.mjs
node scripts/test-assistant-data.mjs
node scripts/test-assistant-ui.mjs
```

## Daily publishing and deployment

`.github/workflows/daily-schedule.yml` runs at `00:05 SGT` (`16:05 UTC`) and can also be run
manually from the Actions tab. It refuses empty room or booking payloads before replacing the
last good snapshot.

The Vercel project is connected to the repository's `main` branch, so pushes to `main` deploy
automatically. Confirm that GitHub Actions has **Read and write permissions** and run the daily
workflow manually once after setting up a new repository.

## Project layout

```text
index.html                  local-first Today and Week workspace
rooms.html                  public room finder and full timetable
advanced.html               refresh and import tools
about.html / privacy.html   trust and privacy content
assets/assistant-data.js    ICS parsing, profile model, week and room recommendation logic
assets/assistant.js         Today/Week rendering, local import, manual classes and backup tools
assets/app.js               feed, cache, import, export, and handoff orchestration
assets/timetable.js         parsing, Singapore-time logic, filters, and rendering
assets/styles.css           responsive light/dark visual system
scraper/scrape.js           shared browser scraper used by bookmarklet and CI
scripts/fetch-schedule.mjs  headless daily fetch
scripts/test-ui.mjs         deterministic room-finder checks
scripts/test-handoff.mjs    cross-tab security and compatibility checks
data/latest.json            latest published schedule
```

Further design details are in [ARCHITECTURE.md](ARCHITECTURE.md) and
[docs/TECHNICAL-DESIGN.md](docs/TECHNICAL-DESIGN.md).
