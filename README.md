# Playspare Sprint Dashboard

A multi-project Jira dashboard for sprint tracking, discovery work, team performance, leave, retrospectives, and a TV-friendly Live View.

## How it works

```text
Jira Cloud -> Google Apps Script -> Google Sheets -> JSON API -> Static dashboard
```

The frontend is plain HTML, CSS and JavaScript. It can be hosted on GitHub Pages or any HTTP(S) static host. Google Apps Script reads Jira, stores live data and snapshots in its bound spreadsheet, and serves the dashboard API.

## Project layout

| Path | Purpose |
|---|---|
| `index.html` | App shell, navigation, API URL and asset version |
| `core/` | Shared loading, routing, charts, authentication, auto-refresh and styles |
| `spaces/` | One module per Jira project; each has `space.json`, HTML, CSS and JS |
| `reports/` | Spillovers, performance, leave and ideas pages |
| `admin/` | Allowed-user and dashboard settings pages |
| `live-view/` | Full-screen static sprint overview and bundled LINE Seed Sans fonts |
| `code.gs` | Main Apps Script backend and workbook setup |
| `THEME.md` | A generic colour theme that any Playspare dashboard can use. It covers tokens, surfaces, meaning colours, badges, interactive states and chart palettes. |
| `copy.gs` | Older backup of `code.gs`. Do not deploy it beside `code.gs`, because both files define the same functions. |

The configured spaces are `MMS` and `MSSD`, which are software sprint projects, and `MSSDISC` and `MDP`, which are discovery projects with fixed cycles.

## Syncing and data refresh

| What | When | Notes |
|---|---|---|
| Incremental sync | Every 10 minutes (`setupIncrementalTrigger`) | Reads only the issues changed since the last sync, plus a 15-minute overlap. If another sync is running, the run is skipped quietly. Each run stops before the 6-minute Apps Script limit. |
| Full sync | 08:00 and 18:00 PKT (`setupTriggers`), or **Sync Now** | Also removes issues deleted in Jira, cleans up duplicates and freezes the sprints Jira has closed. |
| Dashboard refresh | Every 2 minutes in the background (`AUTO_REFRESH_MIN` in `core/core.js`) | Redraws only when a newer sync has finished. There is no loading bar, and the page, the sprint and the scroll position all stay as they are. |

- **Error handling:** `doGet` always answers with JSON. Without this, an uncaught error would return Google's HTML error page, which the dashboard shows as `Unexpected token '<'`. When Google does return an error page, the dashboard retries twice, after 2 seconds and then 4 seconds, before it shows the error.
- **Clock correction:** every data response includes `serverNow`, and the dashboard uses it to correct a wrong device clock, such as a TV with the wrong time or timezone. Live View works out "today" in Pakistan time from this corrected clock, so the countdown, the day number, the days left and the switch at midnight are right on every screen.
- **New sprints:** a new sprint is picked up from Jira on the next sync. A fresh page load opens the most recently started sprint. A screen that stays open keeps its current sprint until it is reloaded.

## Live View numbers

Each figure answers one plain question.

### Top four cards

- **Total Work (e.g. 595 hrs):** "How much work did the sprint start with?" It is the remaining estimate in Jira when the sprint started.
- **Work Left (e.g. 409 hrs):** "How much work is still left right now?" It is the current remaining estimate in Jira.
- **Time Left (e.g. 234 hrs):** "How many working hours does the team still have before the sprint ends?" It multiplies the working days left, including today and excluding weekends, by everyone's daily hours in Team Capacity, or 6 hours when someone is not listed.
- **Hours Behind (e.g. 39 hrs):** "If everyone works their normal hours until the sprint ends, how much work will still be unfinished?" It compares work left with time left: in this example, 39 hours of work won't fit. When time left is larger, the card shows **Hours Ahead** in green.

### Burndown chart

- **Red line (Remaining):** "How much work was left at each moment?" It goes down as work is done and up when work is added.
- **Green line (Time Spent):** "How many hours have been logged so far?"
- **Blue dashed line (Ideal):** "If the work went down evenly every working day, where should it be?" It runs from Total Work to zero and stays flat across weekends.
- **Shaded columns:** weekends and other non-working days from the sprint calendar in Jira.
- **DAY N:** today's working day in the sprint. The start day is Day 0.
- **+41h Behind Ideal:** "If the work had gone down evenly every day since the sprint started, where should we be today?" It compares work left with that even pace, the blue dashed line: in this example the sprint is 41 hours behind it. It shows **Ahead of Ideal** when the sprint is below the line, or **On Ideal** when it is within half an hour.

**Hours Behind** looks forward and asks whether the work can still be finished. **Behind Ideal** looks back and asks whether the work has kept pace. When both show similar values, they agree on how far behind the sprint is.

### Other parts of the overall view

- **Sync time (e.g. `3:00 PM Sync`):** shown in the top-right corner of the donut card. It is the time the latest Jira sync finished in Apps Script, taken from the Sync Log and shown in 12-hour Pakistan time. It moves forward with every completed sync, about every 10 minutes, whether or not anything changed in Jira.
- **Status donut and legend:** every work item in the sprint, including sub-tasks, grouped by its Jira status: Done, To Do, In Progress, In Review and Paused.

## Live View display

Live View is a static, team-wide sprint overview. It remains on the overall burndown, summary cards, countdown, sync time, status donut and legend while background data refreshes continue normally. It does not rotate through individual team-member burndowns.

## Sidebar on Live View and MMS pages

Live View fills the whole screen. It has no top bar, no page tabs and no sidebar. Every MMS page also hides the sidebar, but MMS pages keep their top bar.

A small arrow tab on the left edge opens the sidebar as an overlay. When the sidebar is open, the arrow flips and the tab moves to the sidebar's edge. To close the sidebar, click the tab again, click the dark backdrop, or choose any item in the sidebar.

The spaces that use this behaviour are listed in `SB_TAB_SPACES` in `core/core.js`, and the styles are the `.sb-tab-mode` rules in `live-view/live-view.css`.

## TV screens

TV browsers report a 1080p or 4K screen as a smaller CSS size, such as 960×540 or 1280×720. Without the TV rules, Live View would show its stacked tablet layout or a cramped desktop layout.

- **Live View:** on every landscape screen from 861 to 1919px wide, Live View keeps the 1920px desktop layout. Every font, gap and padding is written in `vw`, which is the desktop pixel size divided by 1920, and the canvas text on the chart scales by the same factor in `lvK()`. As a result, the TV shows the desktop view exactly, scaled to fit the screen, at full height and with no scrollbar. The CSS media query in `live-view/live-view.css` must stay the same as `LV_TV_MQ` in `live-view/live-view.js`.
- **MMS pages:** on landscape screens from 861 to 1200px wide, the whole MMS dashboard is zoomed to the screen width divided by 1920 (`--tvz`, set in `spaces/My Mall Simulator/space.js`), so it lays out like the desktop view. Live View is excluded, because it has its own TV sizing.
- **Updating a TV:** a screen that stays open keeps the code it loaded. After an update is published, restart the TV's browser app, or clear its cache, so that it loads the new files.

## Development

Serve the repository over HTTP(S); opening `index.html` through `file://` prevents module files from loading. After changing frontend assets, update `DASH_VERSION` and every matching `?v=` value in `index.html` so browsers fetch the new files.

To add a space, create its folder under `spaces/`, add it to the sidebar and `SPACE_FOLDERS`/`SPACE_KEYS` in `core/core.js`, then add the matching Apps Script properties described below.

Keep Jira credentials only in Apps Script Properties. Access is controlled by the **Allowed Users** sheet; roles are `Admin` and `Viewer`. `setupWorkbook()` creates all shared and per-space sheets, including sprint data, snapshots, sync logs, goals, retrospectives, leave records, discovery cycles and ideas. It also sets the spreadsheet's timezone to Asia/Karachi, which the Sync Log times rely on.

## Apps Script setup

1. Create a Google Sheet, open **Extensions -> Apps Script**, and add `code.gs` to that bound project.
2. In **Project Settings -> Script Properties**, add `JIRA_API_TOKEN`, then run `seedScriptProperties()` to create the remaining Jira and space settings. Review `JIRA_BASE_URL`, `JIRA_EMAIL`, `SPACE_KEYS`, and each `SPACE_<KEY>_{NAME,TYPE,BOARD_ID,VIEW_ID}` value. `BOARD_ID` is required only for software spaces.
3. Run these functions once, in order, and approve the requested permissions:

   ```text
   setupWorkbook()
   debugJiraConnection()
   syncAllSpaces()
   setupTriggers()             // full sync at 08:00 and 18:00 PKT
   setupIncrementalTrigger()   // changed issues every 10 minutes
   ```

4. Add at least one email to the **Allowed Users** sheet.
5. Deploy Apps Script as a **Web app** with access set to **Anyone**, copy its `/exec` URL into the `API` variable in `index.html`, and publish the frontend through an HTTP(S) host.
6. After backend changes, use **Deploy -> Manage deployments -> Edit -> New version** to keep the same `/exec` URL. A new deployment gets a new URL. Triggers run the latest saved code and do not need to be set up again.
7. Use **Sync Now** for an immediate full refresh.
