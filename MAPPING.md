# Playspare Jira Sprint Dashboard — current mapping

This document describes the files and data rules currently used by the dashboard.

```text
Jira REST API
    ↓
Google Apps Script (code.gs)
    ↓
Google Sheets (live sprint rows, configuration, logs and snapshots)
    ↓
JSON web-app API
    ↓
index.html + modular frontend folders
```

## 1. Deployment contents

Deploy the complete project with this structure intact:

```text
index.html                         Application shell and navigation
code.gs                            Google Apps Script backend source
core/
  core.css                         Shared layout, theme, cards, dialogs and typography
  core.js                          API URL, loader, routing, space switching and shared logic
spaces/
  My Mall Simulator/               MMS sprint-space pages
    space.json
    space.html
    space.css
    space.js
  My Supermarket Simulator- Delivery/  MSSD sprint-space pages
    space.json
    space.html
    space.css
    space.js
  MSS - Discovery/                 MSSDISC discovery pages
    space.json
    space.html
    space.css
    space.js
  My discovery project/            MDP discovery pages
    space.json
    space.html
    space.css
    space.js
reports/
  reports.html                     Spillovers, Performance, Leave and Ideas-list markup
  reports.css                      Shared report styles
  reports.js                       Shared report rendering and interactions
admin/
  admin.html                       Users and Settings markup
  admin.css                        Admin styles
  admin.js                         User/settings rendering and actions
live-view/
  live-view.html                   Full-screen Live View markup
  live-view.css                    Viewport layout and LINE Seed Sans styling
  live-view.js                     Countdown, burndown and status-donut rendering
  fonts/                           LINE Seed Sans font files used by Live View
MAPPING.md                         This file
```

The relative folder names and paths must not be changed unless their references in
`core/core.js` and the corresponding `space.json` files are also changed. The site must
be served over HTTP(S), such as GitHub Pages; loading it directly with `file://` will
block the modular `fetch()` requests.

## 2. Frontend ownership

### `index.html`

- Contains the application shell, sidebar, top bar, page host, login/loader UI and shared modal hosts.
- Lists the four selectable Jira spaces: `MMS`, `MSSD`, `MSSDISC` and `MDP`.
- Loads shared styles/scripts and defines `DASH_VERSION` for space-asset cache busting.
- Does not contain the individual dashboard page implementations.

### `core/core.js`

- Stores the deployed Apps Script web-app URL in `API`.
- Maps space keys to their folders through `SPACE_FOLDERS`.
- Loads each selected space's `space.json`, HTML, CSS and JavaScript.
- Loads the shared Reports, Admin and Live View modules.
- Handles authentication, sprint selection, page switching, sync controls, alerts,
  theme state, shared detail dialogs and member dialogs.
- Adds `disc-mode` for Discovery spaces and `live-mode` for the full-screen Live View.

### Sprint spaces: MMS and MSSD

Both sprint folders use the same page structure and behavior, with data separated by
the selected Jira space key:

- **Overview:** sprint heading/countdown, Status card, status donut, Scope Creep donut,
  Sprint Burndown Chart, Sprint Progress, department cards, alerts and sprint goal.
- **Team:** estimated versus logged time chart, individual burndown, Scope Creep by
  team, summary statistics and unplanned-task summary.
- **Retrospective:** Action Items and Challenges cards with saved entries.

The Live View is available only to sprint spaces. It uses a fixed desktop viewport
without a page scrollbar and keeps smaller stacked layouts scrollable.

### Discovery spaces: MSSDISC and MDP

Discovery spaces use their own space modules and fixed two-week cycles:

- **Overview:** discovery KPIs, Ideas by Theme, Jira Status, Status Board, Delivery
  Progress and Recently Updated.
- **Team:** Theme per Creator and related creator breakdowns.
- **Retrospective / Ideas:** discovery-specific reporting and the complete idea list.

The `disc-mode` class keeps Discovery-only styling and behavior separate from MMS/MSSD.

### Shared pages

| Module | Pages/features |
|---|---|
| `reports/` | Spillovers, Performance, Leave and Ideas list |
| `admin/` | Users and Settings |
| `live-view/` | Full-screen sprint header, countdown, four KPI cards, burndown chart, status donut and five-row status legend |

## 3. Current visual conventions

- Shared dashboard text uses Segoe UI / Segoe UI Variable through CSS variables.
- Numeric values use tabular numerals and the shared Status-card number treatment.
- Live View uses the bundled LINE Seed Sans files; values use ExtraBold (`800`).
- Dark theme is the primary presentation. Muted text uses the shared `--mut` colour.
- MMS and MSSD share the same layout rules; Discovery pages are isolated with
  `.disc-mode` selectors.
- Live View fills screens wider than 1200 px without a page scrollbar. At smaller
  widths its two cards stack and normal vertical scrolling is retained.

## 4. Jira data rules

| Topic | Current rule |
|---|---|
| Work-item count | Counts sprint top-level work items. Epics are containers and are not counted as sprint work items. |
| Hours | Parent totals use Jira aggregate original estimate and aggregate time spent, including subtasks, without double-counting. |
| Per-person hours | A subtask belongs to its own assignee; a parent's non-subtask portion belongs to the parent assignee. |
| Status | Jira status names are displayed as received. To Do, In Progress and Done use Jira status categories. |
| Team | Uses the Jira Team field, with configured/component fallback in the backend. |
| Scope creep | A work item is unplanned when Sprint-field history shows it was added after the sprint start. |
| Bugs/polish | Remain part of their Jira sprint and sprint totals; configured issue types determine their report grouping. |
| Closed sprints | Stored snapshots are used after Jira closes a sprint unless it is configured as freeze-exempt. |
| Discovery | Uses fixed cycles because Jira Product Discovery ideas do not use software sprints or hour estimates. |

Dashboard-specific calculations include D0 as planning day, working-day capacity,
expected daily hours, leave credit, Impact Score and the performance scorecard.

## 5. Sheet mapping

The main per-space live and snapshot tables use these fields:

| Columns | Stored value |
|---|---|
| 1–8 | Task Name, Issue Key, Sprint ID, Sprint Start, Sprint End, Section Type, Assignee, Priority |
| 9–15 | Estimated Hours, Logged Hours, Status, Ticket Type, Build Tag, Team, Labels |
| 16–22 | Created By, Created On, Due Date, Impact Score, Task Level, Parent Task, Has Subtasks |
| 23–30 | Issue ID, Status Category, Issue Type, Resolved On, Epic, Jira Sprints, Updated, Added After Start |

Snapshot rows include an additional **Snapshotted On** column.

Shared or per-space supporting tabs used by `code.gs` include Allowed Users, Team
Capacity, Jira Config, Discovery Cycles, Sprints, Sync Log, Sprint Goals, Sprint Goal
Log, Sprint Retrospectives, Sprint Retrospective Log and Leave Records.

## 6. Backend/API mapping

The frontend calls the deployed `doGet` endpoint in `code.gs`. Supported dashboard
operations include:

- access checking;
- dashboard-data loading for the selected space;
- Jira space-name loading;
- manual synchronization and sprint snapshots;
- sprint-goal and retrospective saving;
- leave creation/deletion;
- allowed-user listing, saving and deletion.

The backend uses Jira Cloud REST endpoints for JQL search, board sprints, fields,
projects, the current user and issue changelogs. Rate-limit and server failures are
retried with backoff.

## 7. Apps Script setup

Required Script Properties:

| Property | Purpose |
|---|---|
| `JIRA_BASE_URL` | Jira Cloud base URL |
| `JIRA_EMAIL` | Atlassian account email used by Apps Script |
| `JIRA_API_TOKEN` | Jira API token; keep it only in Script Properties |
| `SPACE_KEYS` | `MMS,MSSD,MSSDISC,MDP` |
| `SPACE_<KEY>_TYPE` | `software` or `discovery` |
| `SPACE_<KEY>_BOARD_ID` | Scrum board ID for a software space |
| `SPACE_<KEY>_NAME` | Fallback display name |
| `SPACE_<KEY>_VIEW_ID` | Optional reference value |

Deploy Apps Script as a web app, then place its `/exec` URL in the `API` variable at
the top of `core/core.js`. Create a new Apps Script deployment version after backend
changes.

## 8. GitHub Pages

Publish every file and directory listed in section 1. GitHub Pages serves only the
frontend; `code.gs` remains deployed separately as Google Apps Script. Never commit
the Jira email, API token or other credentials—those belong in Apps Script Properties.
