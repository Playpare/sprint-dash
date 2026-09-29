// ================================================================
//  PLAYSPARE — SPRINT BI DASHBOARD  (Jira edition, multi-space)
//  Apps Script — Code.gs
// ================================================================
//
//  Architecture:
//    Jira API → Apps Script → Google Sheets (live + snapshots)
//             → getDashboardData() JSON → index.html
//
//  SETUP — Script Properties (Project Settings → Script Properties).
//  ALL connection + space settings live there; nothing is hard-coded.
//
//    JIRA_BASE_URL           https://playspare.atlassian.net
//    JIRA_EMAIL              playspareg@gmail.com
//    JIRA_API_TOKEN          <your token — never commit it>
//    SPACE_KEYS              MMS,MSSD,MSSDISC,MDP        (order = sidebar order;
//                                                         first = default space)
//    For every key in SPACE_KEYS  (<KEY> = the project key):
//      SPACE_<KEY>_NAME       display name, e.g. My Mall Simulator
//      SPACE_<KEY>_TYPE       software | discovery
//      SPACE_<KEY>_BOARD_ID   Scrum board id (software only), e.g. 133
//      SPACE_<KEY>_VIEW_ID    optional — Product Discovery view id (reference
//                             only; the sync does not need it)
//
//  Tip: run seedScriptProperties() once to fill in everything except the
//  token (it never overwrites values you already set), then add the token.
//
//  Then run, in order:
//    setupWorkbook()        – creates every tab (shared + per space)
//    debugJiraConnection()  – confirms auth + the 4 spaces + 2 boards
//    syncAllSpaces()        – first full sync
//    setupTriggers()        – 8 AM + 6 PM PKT full sync
//    (optional) setupIncrementalTrigger() – hourly "changed since" sync
//
//  See MAPPING.md for the Jira rules, sheet columns and setup.
// ================================================================


// ---------------------------------------------------------------
// SECTION 1: CONFIG
// ---------------------------------------------------------------

// ── Spaces — read from Script Properties (see header) ──
//   type 'software'  → sprints come from the Scrum board (Agile API)
//   type 'discovery' → Jira Product Discovery: no sprints, so the dashboard
//                      uses time-boxed "cycles" from the Discovery Cycles tab
var _spacesCache = null;
function loadSpaces_() {
  if (_spacesCache) return _spacesCache;
  const props = PropertiesService.getScriptProperties();
  const keys = (props.getProperty('SPACE_KEYS') || '').split(',')
    .map(function(k) { return k.trim().toUpperCase(); })
    .filter(function(k, i, a) { return k && a.indexOf(k) === i; });
  if (!keys.length) {
    throw new Error('Script Property SPACE_KEYS is not set (e.g. MMS,MSSD,MSSDISC,MDP). ' +
                    'Run seedScriptProperties() or add it under Project Settings → Script Properties.');
  }
  const map = {}, problems = [];
  keys.forEach(function(k) {
    const p = 'SPACE_' + k + '_';
    const type = (props.getProperty(p + 'TYPE') || '').trim().toLowerCase();
    const board = (props.getProperty(p + 'BOARD_ID') || '').trim();
    if (type !== 'software' && type !== 'discovery') problems.push(p + 'TYPE must be "software" or "discovery"');
    if (type === 'software' && !/^\d+$/.test(board)) problems.push(p + 'BOARD_ID must be the numeric board id');
    map[k] = {
      key    : k,
      name   : (props.getProperty(p + 'NAME') || k).trim(),
      kind   : type,
      boardId: type === 'software' ? Number(board) : null,
      viewId : (props.getProperty(p + 'VIEW_ID') || '').trim(),
    };
  });
  if (problems.length) throw new Error('Script Properties: ' + problems.join('; '));
  _spacesCache = { keys: keys, map: map };
  return _spacesCache;
}
function getSpaceOrder_() { return loadSpaces_().keys.slice(); }

function getSpace(key) {
  const s = loadSpaces_();
  const k = (key || s.keys[0]).toString().trim().toUpperCase();
  const sp = s.map[k];
  if (!sp) throw new Error('Unknown space "' + key + '". Valid: ' + s.keys.join(', '));
  return sp;
}

// Name shown in the dashboard sidebar = the project's name in Jira (saved on
// each full sync as JIRA_NAME_<KEY>), falling back to SPACE_<KEY>_NAME.
function spaceDisplayName_(sp) {
  return PropertiesService.getScriptProperties().getProperty('JIRA_NAME_' + sp.key) || sp.name;
}
function refreshJiraProjectName_(sp) {
  try {
    const p = jiraRequest_('get', '/rest/api/3/project/' + sp.key);
    if (p && p.name) PropertiesService.getScriptProperties().setProperty('JIRA_NAME_' + sp.key, p.name);
  } catch (e) { Logger.log('[' + sp.key + '] Could not read Jira project name: ' + e.message); }
}

// One-time helper: writes the Playspare values into Script Properties.
// Skips anything already set, and never touches JIRA_API_TOKEN.
function seedScriptProperties() {
  const props = PropertiesService.getScriptProperties();
  const seed = {
    JIRA_BASE_URL: 'https://playspare.atlassian.net',
    JIRA_EMAIL: 'playspareg@gmail.com',
    SPACE_KEYS: 'MMS,MSSD,MSSDISC,MDP',
    SPACE_MMS_NAME: 'My Mall Simulator',                    SPACE_MMS_TYPE: 'software',      SPACE_MMS_BOARD_ID: '133',
    SPACE_MSSD_NAME: 'My Supermarket Simulator - Delivery', SPACE_MSSD_TYPE: 'software',     SPACE_MSSD_BOARD_ID: '168',
    SPACE_MSSDISC_NAME: 'MSS - Discovery',                  SPACE_MSSDISC_TYPE: 'discovery',
    SPACE_MSSDISC_VIEW_ID: '262431ae-e640-4400-903a-cf14965e8608',
    SPACE_MDP_NAME: 'My discovery project',                 SPACE_MDP_TYPE: 'discovery',
    SPACE_MDP_VIEW_ID: '4c545765-73e3-4ff4-9e7d-f6964ddf5658',
  };
  const added = [];
  Object.keys(seed).forEach(function(k) {
    if (!props.getProperty(k)) { props.setProperty(k, seed[k]); added.push(k); }
  });
  _spacesCache = null;
  Logger.log(added.length ? 'Added: ' + added.join(', ') : 'Nothing added — all properties already set.');
  Logger.log(props.getProperty('JIRA_API_TOKEN') ? 'JIRA_API_TOKEN is set.' : 'Now add JIRA_API_TOKEN by hand (Project Settings → Script Properties).');
}

// Prints the current Script Properties (token masked). Read-only.
function showScriptProperties() {
  const all = PropertiesService.getScriptProperties().getProperties();
  Object.keys(all).sort().forEach(function(k) {
    const v = k === 'JIRA_API_TOKEN' ? '•••• (' + all[k].length + ' chars, ends …' + all[k].slice(-4) + ')' : all[k];
    Logger.log(k + ' = ' + v);
  });
  try { const s = loadSpaces_(); Logger.log('Spaces OK: ' + s.keys.map(function(k) { return k + ' (' + s.map[k].kind + (s.map[k].boardId ? ', board ' + s.map[k].boardId : '') + ')'; }).join(', ')); }
  catch (e) { Logger.log('✗ ' + e.message); }
}

// Per-space tab name, e.g. "MMS - Sprint Data".
function spaceSheetName(sp, base) { return sp.key + ' - ' + base; }

// Shared (cross-space) tabs.
const SHEET_USERS    = 'Allowed Users';
const SHEET_CAPACITY = 'Team Capacity';
const SHEET_SETTINGS = 'Jira Config';
const SHEET_CYCLES   = 'Discovery Cycles';
const SHEET_DEBUG    = '_Debug Report';

function getConfig(sp) {
  const props = PropertiesService.getScriptProperties();
  const cfg = {
    JIRA_BASE_URL : (props.getProperty('JIRA_BASE_URL') || '').replace(/\/+$/, ''),
    JIRA_EMAIL    : props.getProperty('JIRA_EMAIL'),
    JIRA_API_TOKEN: props.getProperty('JIRA_API_TOKEN'),
    TIMEZONE      : 'Asia/Karachi',
  };
  if (sp) {
    cfg.SHEET_RAW       = spaceSheetName(sp, 'Sprint Data');
    cfg.SHEET_LOG       = spaceSheetName(sp, 'Sync Log');
    cfg.SHEET_SNAP      = spaceSheetName(sp, 'Sprint Snapshots');
    cfg.SHEET_SPRINTS   = spaceSheetName(sp, 'Sprints');
    cfg.SHEET_GOALS     = spaceSheetName(sp, 'Sprint Goals');
    cfg.SHEET_GOALS_LOG = spaceSheetName(sp, 'Sprint Goals Log');
    cfg.SHEET_RETRO     = spaceSheetName(sp, 'Sprint Retrospectives');
    cfg.SHEET_RETRO_LOG = spaceSheetName(sp, 'Retrospectives Log');
    cfg.SHEET_LEAVE     = spaceSheetName(sp, 'Leave Records');
    cfg.SHEET_IDEAS     = spaceSheetName(sp, 'Ideas');           // discovery spaces
  }
  return cfg;
}

// One row per Jira work item per sprint it belongs to. Columns 1–22 keep the
// positions the dashboard reads; 23–30 are extra Jira detail.
// Hours: sub-task rows = the sub-task's own time tracking. Parent rows = Jira's
// Σ values (Σ Original Estimate / Σ Time Spent, i.e. incl. its sub-tasks), the
// same numbers Jira shows on the parent.
const HEADERS = [
  'Task Name',          // col 1   summary
  'Issue Key',          // col 2   Jira key — sent to the UI as mssTicket
  'Sprint ID',          // col 3   Jira sprint name / discovery cycle / BACKLOG
  'Sprint Start',       // col 4
  'Sprint End',         // col 5
  'Section Type',       // col 6   Sprint | Backlog
  'Assignee',           // col 7
  'Priority',           // col 8
  'Est. Time (hrs)',    // col 9   Original Estimate (Σ on parents)
  'Time Log (hrs)',     // col 10  Time Spent (Σ on parents)
  'Status',             // col 11  Jira status name, exactly as in Jira
  'Ticket Type',        // col 12  Task | Bug | Polish (from issue type, see Jira Config)
  'Build Tag',          // col 13  Fix Version/s
  'Team',               // col 14  Jira Team field (or TEAM_FIELD / first component)
  'Labels',             // col 15  labels + components
  'Created By',         // col 16
  'Created On',         // col 17
  'Due Date',           // col 18
  'Impact Score',       // col 19  Manager fills — preserved on sync
  'Task Level',         // col 20  Task (top-level work item) / Subtask
  'Parent Task',        // col 21  parent summary (sub-tasks)
  'Has Subtasks',       // col 22
  'Issue ID',           // col 23  Jira numeric id — stable upsert key
  'Status Category',    // col 24  Jira status category: To Do | In Progress | Done
  'Issue Type',         // col 25  Jira issue type
  'Resolved On',        // col 26  resolution / done date
  'Epic',               // col 27  parent epic "KEY: summary"
  'Jira Sprints',       // col 28  every sprint the issue has been in
  'Updated',            // col 29  Jira updated timestamp
  'Added After Start',  // col 30  TRUE = added to the sprint after it started (Jira scope change)
];

const IMPACT_COL = 19;
// 0-based indexes into a sheet row (same layout for live + snapshot).
const IX = {
  NAME: 0, KEY: 1, SPRINT: 2, START: 3, END: 4, SECTION: 5, ASSIGNEE: 6,
  PRIORITY: 7, EST: 8, LOG: 9, STATUS: 10, TYPE: 11, BUILD: 12, TEAM: 13,
  FEATURE: 14, CREATED_BY: 15, CREATED_ON: 16, DUE: 17, IMPACT: 18,
  LEVEL: 19, PARENT: 20, HAS_SUBS: 21, ISSUE_ID: 22, STATUS_CAT: 23,
  ISSUE_TYPE: 24, RESOLVED: 25, EPIC: 26, JIRA_SPRINTS: 27, UPDATED: 28, ADDED: 29,
};

// Jira status category key → Jira's own category name.
const CATEGORY_NAME = { 'new': 'To Do', 'indeterminate': 'In Progress', 'done': 'Done' };

// Editable settings (Jira Config tab). Space column = ALL or a space key;
// a space-specific row overrides the ALL row.
const DEFAULT_SETTINGS = [
  ['BUG_TYPES',            'Bug',                                  'ALL', 'Jira issue types shown in the Bugs card (comma-separated)'],
  ['POLISH_TYPES',         'Improvement',                          'ALL', 'Jira issue types shown as Polish (comma-separated)'],
  ['EXCLUDED_RESOLUTIONS', "Won't Do, Won't Fix, Duplicate, Cannot Reproduce, Declined", 'ALL', 'Jira resolutions left out of the dashboard'],
  ['EXCLUDED_STATUSES',    "Won't Do, Won't do, Rejected, Cancelled, Canceled", 'ALL', 'Jira statuses left out of the dashboard'],
  ['TEAM_FIELD',           '',                                     'ALL', 'Field holding the team (name or customfield_ id). Blank = Jira "Team" field'],
  ['ESTIMATE_FIELD',       '',                                     'ALL', 'Custom NUMBER field in hours. Blank = Jira Original Estimate'],
  ['LOOKBACK_DAYS',        '45',                                   'ALL', 'Done items older than this are not re-fetched'],
  ['HISTORY_SPRINTS',      '6',                                    'ALL', 'How many recent CLOSED sprints to include'],
  ['COMPLETION_COUNT',     'subtasks',                             'ALL', 'Sprint Completion card counts: subtasks | assigned | all (work items in the sprint)'],
  ['BURNDOWN_DONE',        'keep',                                 'ALL', 'Burndown: keep = a Done item keeps its Remaining Estimate (Jira time tracking) · burn = Done items drop to 0'],
  ['CYCLE_ANCHOR',         '2026-01-05',                           'ALL', 'Discovery spaces: Monday the first cycle starts'],
  ['CYCLE_LENGTH_DAYS',    '14',                                   'ALL', 'Discovery spaces: cycle length in days'],
  // Discovery (Jira Product Discovery) — which idea field plays which role on the
  // dashboard. Comma-separated field NAMES exactly as in Jira; the first one the
  // space has is used. A role with no matching field simply hides its card.
  ['DISC_STATE_FIELD',     'State, Status',                        'ALL', 'Discovery: idea state field (blank = Jira workflow status)'],
  ['DISC_THEME_FIELD',     'Theme, Goals',                         'ALL', 'Discovery: theme field'],
  ['DISC_ROADMAP_FIELD',   'Roadmap',                              'ALL', 'Discovery: Now / Next / Later field'],
  ['DISC_IMPACT_FIELD',    'Impact',                               'ALL', 'Discovery: impact field'],
  ['DISC_EFFORT_FIELDS',   'Effort, Art Effort, Dev Effort',       'ALL', 'Discovery: effort field(s) — several are added up'],
  ['DISC_CONFIDENCE_FIELD','Confidence',                           'ALL', 'Discovery: confidence field'],
  ['DISC_VOTES_FIELD',     'Ratings, Votes',                       'ALL', 'Discovery: votes field'],
  ['DISC_SCORE_FIELD',     'Overall Impact, Prioritisation score, Prioritization score, Prioritization, Priority score', 'ALL', 'Discovery: score used to rank Top ideas'],
  ['DISC_INSIGHTS_FIELD',  'Insights',                             'ALL', 'Discovery: insights count field'],
];


// ── Settings reader (cached per execution) ──
var _settingsCache = null;
function loadSettings_() {
  if (_settingsCache) return _settingsCache;
  const map = {};
  DEFAULT_SETTINGS.forEach(function(r) { map['ALL|' + r[0]] = r[1]; });
  try {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SETTINGS);
    if (sh && sh.getLastRow() > 1) {
      sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function(r) {
        const name = (r[0] || '').toString().trim().toUpperCase();
        if (!name) return;
        const scope = (r[2] || 'ALL').toString().trim().toUpperCase() || 'ALL';
        map[scope + '|' + name] = (r[1] == null ? '' : r[1]).toString();
      });
    }
  } catch (e) { Logger.log('Settings read error: ' + e.message); }
  _settingsCache = map;
  return map;
}
function getSetting(sp, name) {
  const m = loadSettings_();
  const k = name.toUpperCase();
  if (sp && m[sp.key + '|' + k] !== undefined && m[sp.key + '|' + k] !== '') return m[sp.key + '|' + k];
  return m['ALL|' + k] !== undefined ? m['ALL|' + k] : '';
}
function getListSetting(sp, name) {
  return getSetting(sp, name).split(',')
    .map(function(s) { return s.trim().toLowerCase(); })
    .filter(function(s) { return s; });
}
function getIntSetting(sp, name, dflt) {
  const n = parseInt(getSetting(sp, name), 10);
  return isNaN(n) ? dflt : n;
}


// ---------------------------------------------------------------
// SECTION 2: JIRA API
// ---------------------------------------------------------------

// One request with Basic auth + rate-limit handling.
// 429 / 5xx / network errors → honour Retry-After, exponential backoff with
// jitter (Atlassian's recommended pattern), max 5 attempts.
function jiraRequest_(method, path, payload) {
  const cfg = getConfig();
  if (!cfg.JIRA_BASE_URL || !cfg.JIRA_EMAIL || !cfg.JIRA_API_TOKEN) {
    throw new Error('JIRA_BASE_URL, JIRA_EMAIL or JIRA_API_TOKEN not set in Script Properties.');
  }
  const opts = {
    method: method,
    headers: {
      Authorization: 'Basic ' + Utilities.base64Encode(cfg.JIRA_EMAIL + ':' + cfg.JIRA_API_TOKEN),
      Accept: 'application/json',
    },
    muteHttpExceptions: true,
  };
  if (payload !== undefined) {
    opts.contentType = 'application/json';
    opts.payload = JSON.stringify(payload);
  }
  const url = cfg.JIRA_BASE_URL + path;
  const MAX = 5;
  let lastErr = '';
  for (let attempt = 0; attempt < MAX; attempt++) {
    let resp;
    try {
      resp = UrlFetchApp.fetch(url, opts);
    } catch (e) {
      lastErr = 'network: ' + e.message;
      Utilities.sleep(backoffMs_(attempt, 0));
      continue;
    }
    const code = resp.getResponseCode();
    if (code >= 200 && code < 300) {
      const txt = resp.getContentText();
      return txt ? JSON.parse(txt) : {};
    }
    if (code === 429 || code >= 500) {
      const h = resp.getHeaders() || {};
      const ra = parseFloat(h['Retry-After'] || h['retry-after'] || '0') || 0;
      lastErr = 'HTTP ' + code + (h['RateLimit-Reason'] ? ' (' + h['RateLimit-Reason'] + ')' : '');
      Logger.log('Jira ' + lastErr + ' on ' + path + ' — retry ' + (attempt + 1) + '/' + MAX);
      Utilities.sleep(backoffMs_(attempt, ra));
      continue;
    }
    // 4xx other than 429 → not retryable. Surface Jira's own message.
    let msg = resp.getContentText();
    try {
      const j = JSON.parse(msg);
      msg = (j.errorMessages || []).concat(Object.values(j.errors || {})).join('; ') || msg;
    } catch (e) {}
    if (code === 401) msg = 'Unauthorized — check JIRA_EMAIL / JIRA_API_TOKEN (token expired?). ' + msg;
    throw new Error('Jira ' + code + ' ' + method.toUpperCase() + ' ' + path.split('?')[0] + ': ' + msg.slice(0, 400));
  }
  throw new Error('Jira request failed after ' + MAX + ' attempts (' + lastErr + '): ' + path.split('?')[0]);
}

function backoffMs_(attempt, retryAfterSec) {
  const base = Math.min(30000, 2000 * Math.pow(2, attempt));
  const jitter = 0.7 + Math.random() * 0.6;
  return Math.max(retryAfterSec * 1000, Math.round(base * jitter));
}

// Enhanced JQL search (POST /rest/api/3/search/jql). The old /rest/api/3/search
// endpoint has been removed by Atlassian. Pagination is token based; with
// fields requested the page size maximum is 100.
function jiraSearch_(jql, fields) {
  const out = [];
  let token = null, pages = 0;
  do {
    const body = { jql: jql, fields: fields, maxResults: 100 };
    if (token) body.nextPageToken = token;
    const res = jiraRequest_('post', '/rest/api/3/search/jql', body);
    (res.issues || []).forEach(function(i) { out.push(i); });
    token = res.nextPageToken || null;
    pages++;
    if (res.isLast) break;
  } while (token && pages < 300);
  return out;
}

// All sprints on a board (Agile API, offset pagination).
function getBoardSprints_(boardId) {
  const out = [];
  let startAt = 0;
  for (let guard = 0; guard < 60; guard++) {
    const res = jiraRequest_('get', '/rest/agile/1.0/board/' + boardId +
      '/sprint?state=active,closed,future&maxResults=50&startAt=' + startAt);
    const vals = res.values || [];
    vals.forEach(function(v) { out.push(v); });
    if (res.isLast || !vals.length) break;
    startAt += vals.length;
  }
  return out;
}

// Discover custom field ids (Sprint, Team …). Cached for 6 hours.
function getFieldMap_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('JIRA_FIELD_MAP_V3');
  if (hit) return JSON.parse(hit);
  const fields = jiraRequest_('get', '/rest/api/3/field') || [];
  const map = { sprint: null, teamCategory: null, atlTeam: null, byName: {}, byId: {} };
  fields.forEach(function(f) {
    const custom = (f.schema && f.schema.custom) || '';
    const name = (f.name || '').trim();
    if (custom === 'com.pyxis.greenhopper.jira:gh-sprint') map.sprint = f.id;
    // Atlassian "Team" field (schema custom 'com.atlassian.jira.plugin.system.customfieldtypes:atlassian-team'
    // on current sites, 'com.atlassian.teams:…' on older ones).
    if (custom.indexOf('com.atlassian.teams') === 0 || /atlassian-team/.test(custom) ||
        (f.custom && /^team$/i.test(name) && !map.atlTeam)) map.atlTeam = map.atlTeam || f.id;
    if (/^team\s*category$/i.test(name)) map.teamCategory = f.id;
    if (f.custom) { map.byName[name.toLowerCase()] = f.id; map.byId[f.id] = name; }
  });
  try { cache.put('JIRA_FIELD_MAP_V3', JSON.stringify(map), 21600); } catch (e) {}
  return map;
}

function resolveFieldId_(fm, nameOrId) {
  const v = (nameOrId || '').toString().trim();
  if (!v) return null;
  if (/^customfield_\d+$/.test(v)) return v;
  return fm.byName[v.toLowerCase()] || null;
}


// ── Sprint / cycle registry ──
// Returns { list: [...], byJiraId: {}, bySprintId: {} } where each entry is
//   { sprintId, jiraId, state, start, end, startIso, endIso, completed, goal }
function buildSprintRegistry_(sp) {
  if (sp.kind === 'discovery') return buildCycleRegistry_(sp);

  const raw = getBoardSprints_(sp.boardId).filter(function(s) {
    return !s.originBoardId || Number(s.originBoardId) === Number(sp.boardId);
  });
  const histN = getIntSetting(sp, 'HISTORY_SPRINTS', 6);
  const open = raw.filter(function(s) { return s.state !== 'closed'; });
  const closed = raw.filter(function(s) { return s.state === 'closed'; })
    .sort(function(a, b) {
      return new Date(b.completeDate || b.endDate || 0) - new Date(a.completeDate || a.endDate || 0);
    })
    .slice(0, histN);

  const reg = { list: [], byJiraId: {}, bySprintId: {} };
  const usedIds = {};
  closed.reverse().concat(open).forEach(function(s) {
    // Sprint ids must be unique across spaces (the UI keys goals/retros by id).
    // Jira's default names ("MMS Sprint 3") already start with the key.
    let id = (s.name || ('Sprint ' + s.id)).toString().replace(/\s+/g, ' ').trim();
    if (id.toUpperCase().indexOf(sp.key.toUpperCase()) !== 0) id = sp.key + ' ' + id;
    if (/^(BUGS|BACKLOG)$/i.test(id)) id = id + ' ' + s.id;
    if (usedIds[id.toLowerCase()]) id = id + ' #' + s.id;
    usedIds[id.toLowerCase()] = true;
    const entry = {
      sprintId : id,
      jiraId   : s.id,
      state    : s.state || '',
      startIso : s.startDate || '',
      endIso   : s.endDate || '',
      start    : formatOrdinal_(s.startDate),
      end      : formatOrdinal_(s.endDate),
      completed: s.completeDate ? formatDate(s.completeDate) : '',
      goal     : (s.goal || '').toString(),
    };
    reg.list.push(entry);
    reg.byJiraId[s.id] = entry;
    reg.bySprintId[id] = entry;
  });
  return reg;
}

// Discovery spaces: cycles from the shared "Discovery Cycles" tab. The tab is
// extended automatically so there is always a cycle covering today.
function buildCycleRegistry_(sp) {
  ensureDiscoveryCycles_(sp);
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CYCLES);
  const reg = { list: [], byJiraId: {}, bySprintId: {} };
  if (!sh || sh.getLastRow() < 2) return reg;
  const today = startOfDay_(new Date());
  sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues().forEach(function(r) {
    if ((r[0] || '').toString().trim().toUpperCase() !== sp.key) return;
    const id = (r[1] || '').toString().trim();
    const s = toDate_(r[2]), e = toDate_(r[3]);
    if (!id || !s || !e) return;
    const state = today < startOfDay_(s) ? 'future' : (today > startOfDay_(e) ? 'closed' : 'active');
    const entry = {
      sprintId: id, jiraId: null, state: state,
      startIso: s.toISOString(), endIso: e.toISOString(),
      start: formatOrdinal_(s), end: formatOrdinal_(e),
      completed: '', goal: (r[4] || '').toString(),
      _s: startOfDay_(s), _e: startOfDay_(e),
    };
    reg.list.push(entry);
    reg.bySprintId[id] = entry;
  });
  reg.list.sort(function(a, b) { return a._s - b._s; });
  return reg;
}

// The cycle an item belongs to on a given date: the latest cycle that has
// started on/before that date (weekend days fall into the cycle that just
// ended, so Sat/Sun edits still land in it).
function cycleOn_(reg, date) {
  if (!date) return null;
  const d = startOfDay_(date);
  let hit = null;
  reg.list.forEach(function(c) { if (c._s <= d) hit = c; });
  return hit;
}

function ensureDiscoveryCycles_(sp) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_CYCLES);
  if (!sh) sh = createSheetWithHeader_(SHEET_CYCLES, ['Space', 'Cycle ID', 'Start', 'End', 'Goal'], '#1a1a2e');
  const rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues() : [];
  const mine = rows.filter(function(r) { return (r[0] || '').toString().trim().toUpperCase() === sp.key; });

  const len = getIntSetting(sp, 'CYCLE_LENGTH_DAYS', 14);
  let nextStart, n;
  const starts = mine.map(function(r) { return toDate_(r[2]); }).filter(function(d) { return d; });
  if (starts.length) {
    const lastStart = starts.reduce(function(a, d) { return d > a ? d : a; });
    nextStart = new Date(lastStart.getTime() + len * 86400000);
    n = mine.length + 1;
  } else {
    nextStart = toDate_(getSetting(sp, 'CYCLE_ANCHOR')) || mondayOnOrAfter_(new Date());
    n = 1;
  }
  // Generate until the cycle AFTER the one containing today exists.
  const horizon = new Date(startOfDay_(new Date()).getTime() + len * 86400000);
  const add = [];
  while (nextStart <= horizon && add.length < 200) {
    const end = new Date(nextStart.getTime() + (len - 3) * 86400000); // Mon → Fri
    add.push([sp.key, sp.key + '-C' + ('0' + n).slice(-2), Utilities.formatDate(nextStart, 'Asia/Karachi', 'yyyy-MM-dd'),
              Utilities.formatDate(end, 'Asia/Karachi', 'yyyy-MM-dd'), '']);
    nextStart = new Date(nextStart.getTime() + len * 86400000);
    n++;
  }
  if (add.length) {
    sh.getRange(sh.getLastRow() + 1, 1, add.length, 5).setValues(add);
    Logger.log('Discovery cycles added for ' + sp.key + ': ' + add.length);
  }
}

function mondayOnOrAfter_(date) {
  const d = startOfDay_(date);
  const dow = d.getDay();
  d.setDate(d.getDate() + (dow === 1 ? 0 : (dow === 0 ? 1 : 8 - dow)));
  return d;
}

// Keep a per-space "Sprints" reference tab (dates, state, Jira sprint goal).
// Old rows are kept so frozen sprints keep their metadata.
function writeSprintRegistry_(sp, reg) {
  const name = getConfig(sp).SHEET_SPRINTS;
  const hdr = ['Sprint ID', 'Jira Sprint ID', 'State', 'Start', 'End', 'Completed', 'Goal', 'Board', 'Start (Jira)', 'End (Jira)'];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = refreshHeader_(ss.getSheetByName(name) || createSheetWithHeader_(name, hdr, '#1a1a2e'), hdr);
  const existing = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, hdr.length).getValues() : [];
  const byId = {}; const order = [];
  existing.forEach(function(r) { const id = (r[0] || '').toString(); if (id && !byId[id]) { byId[id] = r; order.push(id); } });
  reg.list.forEach(function(s) {
    if (!byId[s.sprintId]) order.push(s.sprintId);
    byId[s.sprintId] = [s.sprintId, s.jiraId || '', s.state, s.start, s.end, s.completed, s.goal,
                        sp.boardId || 'cycle', s.startIso || '', s.endIso || ''];
  });
  const out = order.map(function(id) { return byId[id]; });
  if (existing.length) sh.getRange(2, 1, existing.length, hdr.length).clearContent();
  if (out.length) {
    sh.getRange(2, 9, out.length, 2).setNumberFormat('@');   // keep Jira's exact start / end time as text
    sh.getRange(2, 1, out.length, hdr.length).setValues(out);
  }
}

function readSprintRegistry_(sp) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(getConfig(sp).SHEET_SPRINTS);
  const map = {};
  if (!sh || sh.getLastRow() < 2) return map;
  sh.getRange(2, 1, sh.getLastRow() - 1, 10).getValues().forEach(function(r) {
    const id = (r[0] || '').toString().trim();
    const iso = function(v) { return v instanceof Date ? v.toISOString() : (v || '').toString(); };
    if (id) map[id] = { jiraId: r[1] || '', state: (r[2] || '').toString(), start: r[3], end: r[4], completed: r[5] || '',
                        goal: (r[6] || '').toString(), startIso: iso(r[8]), endIso: iso(r[9]) };
  });
  return map;
}


// ── Main fetch ──
// Returns one row object per work item per location (sprint / backlog).
//   opts.mode         'full' (default) | 'incremental'
//   opts.sinceMinutes incremental window (issues updated in the last N min)
//   opts.frozenIds    override the frozen set (manual snapshot uses this)
// Returns { tasks, registry, excludedIds }.
function fetchJiraData(sp, opts) {
  opts = opts || {};
  const mode = opts.mode || 'full';
  const reg = buildSprintRegistry_(sp);
  writeSprintRegistry_(sp, reg);

  // Frozen (closed + snapshotted) sprints never change — leave them out.
  const frozenIds = opts.frozenIds || getSnapshottedSprintIds(sp);
  const fm = getFieldMap_();
  const env = buildEnv_(sp, reg, fm);
  const fields = fetchFields_(env);

  let jql = buildScopeJql_(sp, reg, frozenIds);
  if (mode === 'incremental' && opts.sinceMinutes) {
    jql = '(' + jql + ') AND updated >= -' + Math.ceil(opts.sinceMinutes) + 'm';
  }
  Logger.log('[' + sp.key + '] JQL: ' + jql);
  const issues = jiraSearch_(jql + ' ORDER BY created ASC', fields);
  const byKey = {};
  issues.forEach(function(i) { byKey[i.key] = i; });
  function addIssues(list) { list.forEach(function(i) { if (!byKey[i.key]) { issues.push(i); byKey[i.key] = i; } }); }

  // Incremental: a changed sub-task changes its parent's Σ hours and a changed
  // parent moves its sub-tasks, so re-read both sides.
  if (mode === 'incremental') {
    const parents = [];
    issues.forEach(function(i) {
      if (isSubtask_(i) && i.fields.parent && parents.indexOf(i.fields.parent.key) === -1) parents.push(i.fields.parent.key);
      if (!isSubtask_(i) && i.fields.subtasks && i.fields.subtasks.length && parents.indexOf(i.key) === -1) parents.push(i.key);
    });
    chunk_(parents.filter(function(k) { return !byKey[k]; }), 50).forEach(function(keys) {
      addIssues(jiraSearch_('key in (' + keys.join(',') + ')', fields));
    });
    chunk_(parents, 50).forEach(function(keys) {
      addIssues(jiraSearch_('parent in (' + keys.join(',') + ')', fields));
    });
  }

  // Sub-tasks belong to their parent's sprint in Jira. Fetch any parent that
  // fell outside the query, as context only (no row).
  const ctx = {};
  const missing = [];
  issues.forEach(function(i) {
    const p = i.fields.parent;
    if (isSubtask_(i) && p && !byKey[p.key] && missing.indexOf(p.key) === -1) missing.push(p.key);
  });
  chunk_(missing, 50).forEach(function(keys) {
    try { jiraSearch_('key in (' + keys.join(',') + ')', fields).forEach(function(i) { ctx[i.key] = i; }); }
    catch (e) { Logger.log('Parent context fetch failed: ' + e.message); }
  });
  function parentOf(i) {
    const p = i.fields.parent;
    return p ? (byKey[p.key] || ctx[p.key] || null) : null;
  }

  // Scope change: when did each top-level item enter each started sprint?
  env.addedAfter = sprintScopeChanges_(env, issues.filter(function(i) { return !isSubtask_(i) && hierarchyLevel_(i) === 0; }));

  const allTasks = [];
  const excludedIds = {};
  let excluded = 0, containers = 0;
  issues.forEach(function(issue) {
    const level = hierarchyLevel_(issue);
    if (level >= 1) {                                    // epics: containers, not work items —
      containers++;                                      // kept only for Jira's "Issues by Status" count
      if (sp.kind === 'software' && !isExcluded_(env, issue)) {
        issueToRows_(env, issue, null).filter(function(r) { return r.sectionType === 'Sprint'; }).forEach(function(r) {
          r.taskLevel = 'Epic'; r.estTime = 0; r.timeLog = 0; r.hasSubtasks = false; r.addedAfterStart = false; allTasks.push(r);
        });
      }
      return;
    }
    const parent = level < 0 ? parentOf(issue) : null;
    if (isExcluded_(env, issue) || (parent && isExcluded_(env, parent))) {
      excluded++; excludedIds[issue.id] = true; return;  // Won't Do / Duplicate … → no row
    }
    issueToRows_(env, issue, parent).forEach(function(r) { allTasks.push(r); });
  });

  // Custom ESTIMATE_FIELD has no Jira Σ — roll sub-tasks into parents here.
  if (env.estFieldId) rollCustomEstimates_(allTasks);

  if (excluded) Logger.log('[' + sp.key + '] Excluded ' + excluded + ' won\'t-do / excluded issue(s).');
  Logger.log('[' + sp.key + '] Issues: ' + issues.length + ' | epics (status count only): ' + containers +
             ' | rows (work items + sub-tasks): ' + allTasks.length);
  // current assignee of every issue read (Won't Do / epics too) — per-person burndown
  const assignees = {};
  issues.forEach(function(i) { assignees[i.key] = i.fields.assignee ? (i.fields.assignee.displayName || 'Unassigned') : 'Unassigned'; });
  return { tasks: allTasks, registry: reg, excludedIds: excludedIds, assignees: assignees };
}

// Everything the row builder needs, shared by the sync and the debug file.
function buildEnv_(sp, reg, fm) {
  return {
    sp: sp, reg: reg, fm: fm,
    teamFieldId: resolveFieldId_(fm, getSetting(sp, 'TEAM_FIELD')),
    estFieldId : resolveFieldId_(fm, getSetting(sp, 'ESTIMATE_FIELD')),
    bugTypes   : getListSetting(sp, 'BUG_TYPES'),
    polishTypes: getListSetting(sp, 'POLISH_TYPES'),
    exclRes    : getListSetting(sp, 'EXCLUDED_RESOLUTIONS'),
    exclStatus : getListSetting(sp, 'EXCLUDED_STATUSES'),
    addedAfter : {},
  };
}

function fetchFields_(env) {
  const fm = env.fm;
  return ['summary', 'issuetype', 'status', 'priority', 'assignee', 'creator', 'reporter',
    'created', 'updated', 'duedate', 'resolution', 'resolutiondate', 'statuscategorychangedate',
    'labels', 'components', 'fixVersions', 'parent', 'subtasks',
    'timeoriginalestimate', 'timespent', 'timeestimate', 'aggregatetimeoriginalestimate', 'aggregatetimespent',
    fm.sprint, fm.teamCategory, fm.atlTeam, env.teamFieldId, env.estFieldId]
    .filter(function(f, i, a) { return f && a.indexOf(f) === i; });
}

// JQL covering exactly what the dashboard needs for this space.
//   software:  issues in any non-frozen registry sprint
//              + backlog / closed-sprint issues that are open or recently done
//   discovery: ideas that are open or recently done
function buildScopeJql_(sp, reg, frozenIds) {
  const days = getIntSetting(sp, 'LOOKBACK_DAYS', 45);
  const recent = '(statusCategory != Done OR updated >= -' + days + 'd)';
  const proj = 'project = "' + sp.key + '"';
  if (sp.kind === 'discovery') return proj + ' AND ' + recent;

  const live = reg.list.filter(function(s) { return !frozenIds[s.sprintId]; })
                       .map(function(s) { return s.jiraId; });
  const parts = [];
  if (live.length) parts.push('sprint in (' + live.join(',') + ')');
  parts.push('((sprint is EMPTY OR sprint in closedSprints()) AND ' + recent + ')');
  return proj + ' AND (' + parts.join(' OR ') + ')';
}


// ── Scope change: "added after sprint start" (Jira sprint report *) ──
// For every top-level issue in a sprint that has started, find when it was
// put into that sprint (Sprint field history). Added after the sprint's start
// date → scope change. No history entry → it has been in the sprint since it
// was created, so it counts as added after start only if created after start.
// Returns { issueId: { jiraSprintId: true } }.
function sprintScopeChanges_(env, issues) {
  const out = {};
  const fid = env.fm.sprint;
  if (env.sp.kind !== 'software' || !fid) return out;
  const started = {};
  env.reg.list.forEach(function(s) {
    if (s.jiraId && s.startIso && s.state !== 'future') started[s.jiraId] = new Date(s.startIso).getTime();
  });
  const todo = issues.filter(function(i) {
    return (i.fields[fid] || []).some(function(s) { return started[s.id]; });
  });
  if (!todo.length) return out;

  const hist = fetchSprintHistory_(fid, todo);
  todo.forEach(function(i) {
    const created = new Date(i.fields.created).getTime();
    const entries = (hist[i.id] || []).slice().sort(function(a, b) { return a.at - b.at; });
    (i.fields[fid] || []).forEach(function(s) {
      const start = started[s.id];
      if (!start) return;
      let addedAt = null;
      entries.forEach(function(e) {
        if (e.to.indexOf(String(s.id)) !== -1 && e.from.indexOf(String(s.id)) === -1) addedAt = e.at;
      });
      const after = addedAt !== null ? addedAt > start : created > start;
      if (after) (out[i.id] = out[i.id] || {})[s.id] = true;
    });
  });
  return out;
}

// Sprint-field change history per issue: { issueId: [{at, from:[ids], to:[ids]}] }.
// Uses the bulk changelog endpoint; falls back to per-issue changelog.
function fetchSprintHistory_(fid, issues) {
  const res = {};
  function ids(s) { return (s || '').toString().split(',').map(function(x) { return x.trim(); }).filter(function(x) { return x; }); }
  function take(issueId, histories) {
    (histories || []).forEach(function(h) {
      (h.items || []).forEach(function(it) {
        if (it.fieldId !== fid && (it.field || '').toLowerCase() !== 'sprint') return;
        (res[issueId] = res[issueId] || []).push({ at: new Date(h.created).getTime(), from: ids(it.from), to: ids(it.to) });
      });
    });
  }
  try {
    chunk_(issues.map(function(i) { return i.id; }), 1000).forEach(function(batch) {
      let token = null, guard = 0;
      do {
        const body = { issueIdsOrKeys: batch, fieldIds: [fid], maxResults: 10000 };
        if (token) body.nextPageToken = token;
        const r = jiraRequest_('post', '/rest/api/3/changelog/bulkfetch', body);
        (r.issueChangeLogs || []).forEach(function(c) { take(c.issueId, c.changeHistories); });
        token = r.nextPageToken || null;
      } while (token && ++guard < 50);
    });
    return res;
  } catch (e) {
    Logger.log('Bulk changelog unavailable (' + e.message.slice(0, 120) + ') — reading per issue.');
  }
  issues.slice(0, 400).forEach(function(i) {
    let startAt = 0;
    for (let g = 0; g < 20; g++) {
      const r = jiraRequest_('get', '/rest/api/3/issue/' + i.id + '/changelog?maxResults=100&startAt=' + startAt);
      take(i.id, r.values);
      if (r.isLast || !(r.values || []).length) break;
      startAt += r.values.length;
    }
  });
  return res;
}


// ── Issue → row(s) ──
function issueToRows_(env, issue, parent) {
  const f = issue.fields;
  const isSub = hierarchyLevel_(issue) < 0;
  const pf = parent ? parent.fields : null;

  const typeName = (f.issuetype && f.issuetype.name) || '';
  let ticketType = ticketTypeOf_(env, typeName);
  // A sub-task is part of its parent's work: a sub-task of a Bug is bug work.
  if (isSub && pf) ticketType = ticketTypeOf_(env, (pf.issuetype && pf.issuetype.name) || '');

  const cat = statusCat_(issue);
  const doneDate = cat === 'done' ? (f.resolutiondate || f.statuscategorychangedate || f.updated) : (f.resolutiondate || '');

  // Location: sub-tasks are in whatever sprint their parent is in (Jira rule).
  let locs;
  if (isSub && parent) {
    const pCat = statusCat_(parent);
    const pDone = pCat === 'done' ? (pf.resolutiondate || pf.statuscategorychangedate || pf.updated) : '';
    locs = locationsFor_(env, parent, pCat, pDone);
  } else {
    locs = locationsFor_(env, issue, cat, doneDate);
  }
  if (!locs.length) return [];

  const assignee = f.assignee ? (f.assignee.displayName || '') : '';
  let build = (f.fixVersions || []).map(function(v) { return v.name; }).join(', ');
  if (isSub && !build && pf) build = (pf.fixVersions || []).map(function(v) { return v.name; }).join(', ');

  // Hours: parents carry Jira's Σ (incl. sub-tasks); sub-tasks their own.
  const est = isSub || env.estFieldId ? estimateHours_(env, f)
    : roundHrs_(((f.aggregatetimeoriginalestimate != null ? f.aggregatetimeoriginalestimate : f.timeoriginalestimate) || 0) / 3600);
  const log = isSub ? roundHrs_((f.timespent || 0) / 3600)
    : roundHrs_(((f.aggregatetimespent != null ? f.aggregatetimespent : f.timespent) || 0) / 3600);

  let epic = '';
  if (!isSub && f.parent && f.parent.fields) epic = f.parent.key + ': ' + (f.parent.fields.summary || '');
  const sprintField = env.fm.sprint ? (f[env.fm.sprint] || []) : [];
  const scopeIssue = isSub && parent ? parent : issue;     // sub-tasks follow their parent
  const scope = env.addedAfter[scopeIssue.id] || {};

  const base = {
    taskName    : f.summary || '',
    mssTicket   : issue.key,
    assignee    : assignee || 'Unassigned',
    priority    : f.priority ? f.priority.name : '',
    estTime     : est,
    timeLog     : log,
    status      : f.status ? f.status.name : '',
    statusCategory: CATEGORY_NAME[cat] || 'To Do',
    ticketType  : ticketType,
    buildTag    : build,
    teamCategory: teamOf_(env, issue),
    featureTag  : labelsOf_(f),
    createdBy   : f.creator ? f.creator.displayName : (f.reporter ? f.reporter.displayName : ''),
    createdOn   : formatDate(f.created),
    dueDate     : f.duedate || '',
    taskLevel   : isSub ? 'Subtask' : 'Task',
    parentTask  : isSub ? ((pf && pf.summary) || (f.parent && f.parent.fields && f.parent.fields.summary) || '') : '',
    hasSubtasks : !!(f.subtasks && f.subtasks.length),
    issueId     : issue.id,
    issueType   : typeName,
    resolvedOn  : formatDate(doneDate),
    epic        : epic,
    jiraSprints : (Array.isArray(sprintField) ? sprintField : []).map(function(s) { return s.name; }).join(', '),
    updated     : f.updated || '',
  };

  return locs.map(function(l) {
    const r = Object.assign({}, base);
    r.sprintId = l.sprintId; r.sprintStart = l.start; r.sprintEnd = l.end; r.sectionType = l.sectionType;
    r.addedAfterStart = !!(l.jiraId && scope[l.jiraId]);
    return r;
  });
}

const LOC_BACKLOG = { sprintId: 'BACKLOG', start: '', end: '', sectionType: 'Backlog', jiraId: null };

// Where a work item lives: each sprint it is in (Jira keeps carried-over
// issues in every sprint they passed through), or the backlog.
function locationsFor_(env, issue, cat, doneDate) {
  const reg = env.reg;
  function sprintLoc(e) { return { sprintId: e.sprintId, start: e.start, end: e.end, sectionType: 'Sprint', jiraId: e.jiraId }; }

  if (env.sp.kind === 'discovery') {
    // Product Discovery has no sprints: Done → cycle it was completed in ·
    // In Progress category → current cycle · To Do category → backlog
    if (cat === 'done') { const c = cycleOn_(reg, toDate_(doneDate)); return c ? [sprintLoc(c)] : []; }
    if (cat === 'indeterminate') { const c = cycleOn_(reg, new Date()); return c ? [sprintLoc(c)] : [LOC_BACKLOG]; }
    return [LOC_BACKLOG];
  }

  const sprints = env.fm.sprint ? (issue.fields[env.fm.sprint] || []) : [];
  if (!Array.isArray(sprints) || !sprints.length) return [LOC_BACKLOG];

  const locs = [];
  let hasOpen = false;
  sprints.forEach(function(s) {
    if (s.state === 'active' || s.state === 'future') hasOpen = true;
    const e = reg.byJiraId[s.id];
    if (e) locs.push(sprintLoc(e));
  });
  // Sprint completed with this issue unfinished and not moved to another
  // sprint → Jira returns it to the backlog.
  if (!hasOpen && cat !== 'done') locs.push(LOC_BACKLOG);
  return locs;
}

function hierarchyLevel_(issue) {
  const it = issue.fields.issuetype || {};
  if (it.subtask) return -1;
  return typeof it.hierarchyLevel === 'number' ? it.hierarchyLevel : 0;
}
function isSubtask_(issue) { return hierarchyLevel_(issue) < 0; }

function statusCat_(issue) {
  const s = issue.fields.status;
  return (s && s.statusCategory && s.statusCategory.key) || 'new';   // new | indeterminate | done
}

function ticketTypeOf_(env, typeName) {
  const t = (typeName || '').toLowerCase().trim();
  if (env.bugTypes.indexOf(t) !== -1) return 'Bug';
  if (env.polishTypes.indexOf(t) !== -1) return 'Polish';
  return 'Task';
}

// Left out of the dashboard: excluded resolutions (Won't Do, Duplicate …) or
// excluded statuses (e.g. Product Discovery "Won't do").
function isExcluded_(env, issue) {
  const f = issue.fields;
  const res = (f.resolution && f.resolution.name || '').toLowerCase();
  if (res && env.exclRes.indexOf(res) !== -1) return true;
  const st = (f.status && f.status.name || '').toLowerCase();
  if (st && env.exclStatus.indexOf(st) !== -1) return true;
  return false;
}

function labelsOf_(f) {
  const tags = (f.labels || []).slice();
  (f.components || []).forEach(function(c) { if (tags.indexOf(c.name) === -1) tags.push(c.name); });
  return tags.join(', ');
}

// Team, exactly as in Jira: TEAM_FIELD (if set) → Jira "Team" field →
// a custom "Team Category" field → first component → blank.
function teamOf_(env, issue) {
  const f = issue.fields;
  function val(v) {
    if (v == null || v === '') return '';
    if (Array.isArray(v)) return v.length ? val(v[0]) : '';
    if (typeof v === 'object') return (v.name || v.title || v.value || '').toString();
    return v.toString();
  }
  const ids = [env.teamFieldId, env.fm.atlTeam, env.fm.teamCategory];
  for (let i = 0; i < ids.length; i++) {
    if (ids[i]) { const t = val(f[ids[i]]).trim(); if (t) return t; }
  }
  return (f.components && f.components[0] && f.components[0].name) || '';
}

function estimateHours_(env, f) {
  if (env.estFieldId && typeof f[env.estFieldId] === 'number') return roundHrs_(f[env.estFieldId]);
  return roundHrs_((f.timeoriginalestimate || 0) / 3600);
}

// Custom estimate fields have no Jira Σ: parent = own + its sub-tasks (same location).
function rollCustomEstimates_(rows) {
  const subs = {};
  rows.forEach(function(r) {
    if (r.taskLevel !== 'Subtask') return;
    const k = r.sprintId + '|' + r.parentTask;
    subs[k] = (subs[k] || 0) + (r.estTime || 0);
  });
  rows.forEach(function(r) {
    if (r.taskLevel === 'Task' && r.hasSubtasks) r.estTime = roundHrs_((r.estTime || 0) + (subs[r.sprintId + '|' + r.taskName] || 0));
  });
}


// ── Small helpers ──
function formatDate(iso) {
  if (!iso) return '';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, 'Asia/Karachi', 'dd MMM yyyy');
}

// "13th April 2026" — the date format
// the frontend's sprint picker / pd() expects.
function formatOrdinal_(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return '';
  const day = parseInt(Utilities.formatDate(d, 'Asia/Karachi', 'd'), 10);
  const mod = day % 100;
  const suf = (mod >= 11 && mod <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] || 'th');
  return day + suf + ' ' + Utilities.formatDate(d, 'Asia/Karachi', 'MMMM yyyy');
}

// Hours are kept to 6 decimals (1 s = 0.000278 h) so per-person sums match Jira exactly.
function roundHrs_(n) { return Math.round((Number(n) || 0) * 1e6) / 1e6; }
function startOfDay_(d) { const x = new Date(d.getTime()); x.setHours(0, 0, 0, 0); return x; }
function toDate_(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = v.toString().trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
  return parseSprintDate(s);
}
function chunk_(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }
function nk_(s) { return (s == null ? '' : s.toString()).replace(/\s+/g, ' ').trim().toLowerCase(); }

function createSheetWithHeader_(name, headers, color) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  // New sheets have 26 columns; the data tabs need 29 (+1 on snapshots).
  if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  if (sh.getLastRow() === 0) {
    const h = sh.getRange(1, 1, 1, headers.length);
    h.setValues([headers]);
    h.setBackground(color || '#1a1a2e').setFontColor('#ffffff').setFontWeight('bold').setFontSize(11);
    sh.setFrozenRows(1);
  }
  return sh;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}


// ---------------------------------------------------------------
// SECTION 3: SHEET MANAGER — Upsert
// ---------------------------------------------------------------
//
// Upsert model:
//   • Key = Issue ID + Sprint ID + Section. The Jira id never changes, so a
//     rename can't create a duplicate (this is what cleanStaleMSS repaired).
//   • One batched read and one batched write per step instead of a
//     setValues()/deleteRow() call per row (4 spaces × the 6-minute limit).

function ensureDataSheet_(sp) {
  return refreshHeader_(createSheetWithHeader_(getConfig(sp).SHEET_RAW, HEADERS, '#1a1a2e'), HEADERS);
}

// Keep row 1 in step with HEADERS on sheets created by an older version.
function refreshHeader_(sh, headers) {
  if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  const cur = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  if (cur.join('|') !== headers.join('|')) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontColor('#ffffff').setFontWeight('bold');
  }
  return sh;
}

function readRows_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getValues();
}

// Replace the data area with `rows` in one write.
function writeRows_(sheet, rows) {
  const last = sheet.getLastRow();
  if (last > 1) sheet.getRange(2, 1, last - 1, HEADERS.length).clearContent();
  // old dropdown rules (Task Level = Task | Subtask) would reject the new "Epic" rows
  sheet.getRange(2, IX.LEVEL + 1, Math.max(1, sheet.getMaxRows() - 1), 1).clearDataValidations();
  if (rows.length) sheet.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);
}

function keyOf_(issueId, name, key, sprintId, section, level) {
  if (issueId) return 'I|' + issueId + '|' + nk_(sprintId) + '|' + nk_(section);
  return 'N|' + nk_(key) + '|' + nk_(name) + '|' + nk_(sprintId) + '|' + nk_(section) + '|' + nk_(level);
}
function rowKey_(row) {
  return keyOf_(row[IX.ISSUE_ID], row[IX.NAME], row[IX.KEY], row[IX.SPRINT], row[IX.SECTION], row[IX.LEVEL]);
}
function taskKey_(t) {
  return keyOf_(t.issueId, t.taskName, t.mssTicket, t.sprintId, t.sectionType, t.taskLevel);
}
// Identity without location (what a move between sprints changes).
function rowIdentity_(row) {
  return row[IX.ISSUE_ID] ? 'I|' + row[IX.ISSUE_ID]
    : 'N|' + nk_(row[IX.KEY]) + '|' + nk_(row[IX.NAME]) + '|' + nk_(row[IX.LEVEL]);
}
function taskIdentity_(t) {
  return t.issueId ? 'I|' + t.issueId : 'N|' + nk_(t.mssTicket) + '|' + nk_(t.taskName) + '|' + nk_(t.taskLevel);
}

function writeToSheet(sp, tasks, frozenIds) {
  // Frozen sprintIds skip upsert — their values live in Sprint Snapshots.
  frozenIds = frozenIds || getSnapshottedSprintIds(sp);
  const sheet = ensureDataSheet_(sp);
  const data = readRows_(sheet);

  const index = {};
  data.forEach(function(row, i) { if (row[IX.NAME] || row[IX.ISSUE_ID]) index[rowKey_(row)] = i; });

  const touched = {};
  let updated = 0, added = 0, skipped = 0, collapsed = 0;
  tasks.forEach(function(t) {
    if (frozenIds[t.sprintId]) { skipped++; return; }
    const k = taskKey_(t);
    const row = buildRow(t);
    const i = index[k];
    if (i !== undefined) {
      if (touched[i]) { collapsed++; return; }            // same issue+location twice in one run
      row[IMPACT_COL - 1] = data[i][IMPACT_COL - 1] || ''; // preserve manager's Impact Score
      data[i] = row; touched[i] = true; updated++;
    } else {
      index[k] = data.length; touched[data.length] = true;
      data.push(row); added++;
    }
  });

  writeRows_(sheet, data);
  Logger.log('[' + sp.key + '] Updated: ' + updated + ' | New: ' + added + ' | Skipped (frozen): ' +
             skipped + ' | Collapsed (dup in fetch): ' + collapsed);
  if (data.length) { applyFormatting(sheet, data); addDropdowns(sheet, data.length); }
}

function buildRow(t) {
  return [
    t.taskName,                   // 1
    t.mssTicket,                  // 2
    t.sprintId,                   // 3
    t.sprintStart,                // 4
    t.sprintEnd,                  // 5
    t.sectionType,                // 6
    t.assignee,                   // 7
    t.priority,                   // 8
    t.estTime,                    // 9
    t.timeLog,                    // 10
    t.status,                     // 11 Jira status name
    t.ticketType,                 // 12
    t.buildTag,                   // 13
    t.teamCategory,               // 14
    t.featureTag,                 // 15
    t.createdBy,                  // 16
    t.createdOn,                  // 17
    t.dueDate,                    // 18
    '',                           // 19 Impact Score — manager fills
    t.taskLevel,                  // 20
    t.parentTask,                 // 21
    t.hasSubtasks ? true : false, // 22
    t.issueId || '',              // 23
    t.statusCategory || '',       // 24 To Do | In Progress | Done
    t.issueType || '',            // 25
    t.resolvedOn || '',           // 26
    t.epic || '',                 // 27
    t.jiraSprints || '',          // 28
    t.updated || '',              // 29
    t.addedAfterStart ? true : false, // 30
  ];
}

function addDropdowns(sheet, count) {
  if (count < 1) return;
  sheet.getRange(2, 1, count, HEADERS.length).clearDataValidations();
  sheet.getRange(2, IMPACT_COL, count).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(['5 - Exceptional', '4 - Above Expected', '3 - As Expected',
                           '2 - Below Expected', '1 - Needs Rework'], true)
      .setAllowInvalid(false).build());
  sheet.getRange(2, IX.LEVEL + 1, count).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['Task', 'Subtask', 'Epic'], true)
      .setAllowInvalid(false).build());
}

// Sheet look (subtask rows tinted, alternating task rows,
// yellow Impact Score), written as one matrix instead of per-row calls.
function applyFormatting(sheet, data) {
  const n = data.length;
  if (n < 1) return;
  const W = HEADERS.length;
  const widths = { 1: 280, 2: 100, 3: 130, 6: 120, 7: 150, 15: 140, 19: 160, 20: 80, 21: 250, 27: 220, 28: 200 };
  Object.keys(widths).forEach(function(c) { sheet.setColumnWidth(+c, widths[c]); });

  const spare = sheet.getMaxRows() - 1 - n;
  if (spare > 0) sheet.getRange(n + 2, 1, spare, W).setBackground(null);

  const bgs = [], fcs = [];
  for (let i = 0; i < n; i++) {
    const sub = (data[i][IX.LEVEL] || '').toString().trim() === 'Subtask';
    const bg = sub ? '#eef2ff' : (i % 2 === 0 ? '#f8f9fa' : '#ffffff');
    const r = [];
    for (let c = 0; c < W; c++) r.push(c === IMPACT_COL - 1 && !sub ? '#fffde7' : bg);
    bgs.push(r);
    fcs.push([sub ? '#5b6ef5' : '#000000']);
  }
  sheet.getRange(2, 1, n, W).setBackgrounds(bgs);
  sheet.getRange(2, 1, n, 1).setFontColors(fcs);
}

// Generic "keep these rows" rewrite used by every cleanup step.
function filterDataRows_(sp, keepFn) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(getConfig(sp).SHEET_RAW);
  if (!sheet || sheet.getLastRow() < 2) return 0;
  const data = readRows_(sheet);
  const kept = data.filter(keepFn);
  const removed = data.length - kept.length;
  if (!removed) return 0;
  writeRows_(sheet, kept);
  if (kept.length) { applyFormatting(sheet, kept); addDropdowns(sheet, kept.length); }
  return removed;
}


// ---------------------------------------------------------------
// SECTION 3.5: SPRINT SNAPSHOTS
// ---------------------------------------------------------------
//
// A sprint is frozen once Jira has CLOSED it (Complete sprint). A discovery
// cycle is frozen once its end date has passed. Closed sprints can't change in
// Jira any more, so the snapshot is the final record of that sprint.
//
// On freeze: rows copied to "<KEY> - Sprint Snapshots", future syncs skip that
// sprint, leftover live rows are removed. getDashboardData() merges snapshot +
// live with the snapshot taking precedence. FREEZE_EXEMPT keeps a sprint live;
// the dashboard "Snapshot" button freezes or refreshes one on demand.
// ---------------------------------------------------------------

function parseSprintDate(str) {
  if (!str) return null;
  if (str instanceof Date) return isNaN(str.getTime()) ? null : str;
  const clean = str.toString().replace(/(\d+)(st|nd|rd|th)/i, '$1');
  const d = new Date(clean);
  return isNaN(d.getTime()) ? null : d;
}

function getSnapshottedSprintIds(sp) {
  const snap = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(getConfig(sp).SHEET_SNAP);
  const set = {};
  if (!snap || snap.getLastRow() < 2) return set;
  snap.getRange(2, IX.SPRINT + 1, snap.getLastRow() - 1, 1).getValues().forEach(function(r) {
    const id = (r[0] || '').toString().trim();
    if (id) set[id] = true;
  });
  return set;
}

// ── Keep-live exemption (per space) ──
function getFreezeExempt(sp) {
  const raw = PropertiesService.getScriptProperties().getProperty('FREEZE_EXEMPT_' + sp.key) || '';
  const set = {};
  raw.split(',').forEach(function(s) { const id = s.trim(); if (id) set[id] = true; });
  return set;
}
function setFreezeExempt(sp, set) {
  const ids = Object.keys(set).filter(function(id) { return id; });
  PropertiesService.getScriptProperties().setProperty('FREEZE_EXEMPT_' + sp.key, ids.join(','));
  return ids;
}

// Editor helpers — set SPACE + SPRINT, then Run.
function keepSprintLive() {
  const SPACE = 'MMS', SPRINT = 'MMS Sprint 1';   // ← change as needed
  const sp = getSpace(SPACE);
  const set = getFreezeExempt(sp); set[SPRINT] = true; setFreezeExempt(sp, set);
  const wasFrozen = !!getSnapshottedSprintIds(sp)[SPRINT];
  if (wasFrozen) removeSnapshotForSprint(sp, SPRINT);
  syncSpace(sp, 'full');
  Logger.log(SPACE + ' / ' + SPRINT + ' is now KEEP-LIVE.' + (wasFrozen ? ' Old snapshot removed.' : ''));
}
function allowSprintFreeze() {
  const SPACE = 'MMS', SPRINT = 'MMS Sprint 1';   // ← change as needed
  const sp = getSpace(SPACE);
  const set = getFreezeExempt(sp); delete set[SPRINT]; setFreezeExempt(sp, set);
  Logger.log(SPACE + ' / ' + SPRINT + ' exemption removed — it can auto-freeze again.');
}

function ensureSnapshotSheet(sp) {
  const h = HEADERS.concat(['Snapshotted On']);
  return refreshHeader_(createSheetWithHeader_(getConfig(sp).SHEET_SNAP, h, '#5b3ea3'), h);
}

function snapshotSprint(sp, sprintId) {
  const live = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(getConfig(sp).SHEET_RAW);
  if (!live || live.getLastRow() < 2) return 0;
  if (getSnapshottedSprintIds(sp)[sprintId]) return 0;
  const matches = readRows_(live).filter(function(r) { return (r[IX.SPRINT] || '').toString().trim() === sprintId; });
  if (!matches.length) return 0;
  const snap = ensureSnapshotSheet(sp);
  const ts = Utilities.formatDate(new Date(), 'Asia/Karachi', 'dd MMM yyyy HH:mm');
  const rows = matches.map(function(r) { return r.concat([ts]); });
  snap.getRange(snap.getLastRow() + 1, 1, rows.length, HEADERS.length + 1).setValues(rows);
  Logger.log('[' + sp.key + '] Snapshot: ' + sprintId + ' → ' + rows.length + ' rows frozen');
  return rows.length;
}

function snapshotEligibleSprints(sp, allTasks, registry) {
  const states = {};
  ((registry && registry.list) || []).forEach(function(s) { states[s.sprintId] = s.state; });
  // Sprint ids present in the live sheet (incl. old sprints no longer in the
  // registry — those are long closed in Jira).
  const ids = {};
  readRows_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(getConfig(sp).SHEET_RAW)).forEach(function(r) {
    const id = (r[IX.SPRINT] || '').toString().trim();
    if (id && r[IX.SECTION] === 'Sprint') ids[id] = true;
  });
  const already = getSnapshottedSprintIds(sp);
  const exempt = getFreezeExempt(sp);
  const nowFrozen = Object.assign({}, already);
  Object.keys(ids).forEach(function(id) {
    if (already[id] || exempt[id]) return;
    const state = states[id] || 'closed';
    if (state !== 'closed') return;                        // active / future → still live
    const n = snapshotSprint(sp, id);
    if (!n) return;
    nowFrozen[id] = true;
    Logger.log('[' + sp.key + '] Frozen ' + id + ' (closed in Jira) — ' + n + ' rows');
  });
  return nowFrozen;
}

function cleanupFrozenLiveRows(sp, frozenIds) {
  if (!frozenIds || !Object.keys(frozenIds).length) return 0;
  const n = filterDataRows_(sp, function(r) { return !frozenIds[(r[IX.SPRINT] || '').toString().trim()]; });
  if (n) Logger.log('[' + sp.key + '] Cleanup: removed ' + n + ' frozen-sprint rows');
  return n;
}

// Rows left at an old location after an issue moved sprint / section (or was
// re-typed to a bug). Only issues present in THIS fetch are judged.
function cleanupMovedFromSprint(sp, tasks, frozenIds) {
  frozenIds = frozenIds || getSnapshottedSprintIds(sp);
  const current = {};
  (tasks || []).forEach(function(t) {
    const id = taskIdentity_(t);
    (current[id] = current[id] || {})[nk_(t.sprintId) + '|' + nk_(t.sectionType)] = true;
  });
  const n = filterDataRows_(sp, function(r) {
    if (frozenIds[(r[IX.SPRINT] || '').toString().trim()]) return true;
    const locs = current[rowIdentity_(r)];
    if (!locs) return true;
    return !!locs[nk_(r[IX.SPRINT]) + '|' + nk_(r[IX.SECTION])];
  });
  if (n) Logger.log('[' + sp.key + '] Cleanup: removed ' + n + ' stale row(s) (moved / re-typed)');
  return n;
}

// Orphans — issues no longer in scope (deleted, archived, moved project,
// excluded). Full sync only. Safety cap against a partial fetch.
function cleanupDeletedTasks(sp, tasks, frozenIds) {
  if (!tasks || !tasks.length) return 0;
  frozenIds = frozenIds || getSnapshottedSprintIds(sp);
  const present = {};
  tasks.forEach(function(t) { present[taskIdentity_(t)] = true; });

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(getConfig(sp).SHEET_RAW);
  const data = readRows_(sheet);
  let live = 0, orphans = 0;
  data.forEach(function(r) {
    if (!r[IX.NAME] || frozenIds[(r[IX.SPRINT] || '').toString().trim()]) return;
    live++;
    if (!present[rowIdentity_(r)]) orphans++;
  });
  if (!orphans) return 0;
  if (orphans > Math.max(15, Math.floor(live * 0.35))) {
    Logger.log('[' + sp.key + '] cleanupDeletedTasks ABORTED: ' + orphans + '/' + live +
               ' rows missing from fetch — looks like a partial pull. Nothing deleted.');
    return 0;
  }
  const n = filterDataRows_(sp, function(r) {
    if (!r[IX.NAME] || frozenIds[(r[IX.SPRINT] || '').toString().trim()]) return true;
    return !!present[rowIdentity_(r)];
  });
  Logger.log('[' + sp.key + '] Cleanup: removed ' + n + ' orphan row(s)');
  return n;
}

// Duplicate-row guard. With Issue ID keys a rename
// cannot duplicate a row; this only guards against manual copy/paste dupes.
// Keeps the first row, carries over a non-empty Impact Score.
function cleanDuplicateRows(sp) {
  const seen = {};
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(getConfig(sp).SHEET_RAW);
  const data = readRows_(sheet);
  const firstIdx = {};
  data.forEach(function(r, i) {
    const k = rowKey_(r);
    if (firstIdx[k] === undefined) firstIdx[k] = i;
    else if (!data[firstIdx[k]][IX.IMPACT] && r[IX.IMPACT]) data[firstIdx[k]][IX.IMPACT] = r[IX.IMPACT];
  });
  const kept = data.filter(function(r, i) { const k = rowKey_(r); if (seen[k]) return false; seen[k] = true; return true; });
  if (kept.length === data.length) return 0;
  writeRows_(sheet, kept);
  if (kept.length) { applyFormatting(sheet, kept); addDropdowns(sheet, kept.length); }
  Logger.log('[' + sp.key + '] Cleanup: removed ' + (data.length - kept.length) + ' duplicate row(s)');
  return data.length - kept.length;
}

// Issues that became excluded (Won't Do …) since the last sync (incremental).
function removeExcludedRows_(sp, excludedIds, frozenIds) {
  if (!excludedIds || !Object.keys(excludedIds).length) return 0;
  return filterDataRows_(sp, function(r) {
    if (frozenIds[(r[IX.SPRINT] || '').toString().trim()]) return true;
    return !excludedIds[(r[IX.ISSUE_ID] || '').toString()];
  });
}


// ── Manual snapshot / re-snapshot (dashboard "Snapshot" button) ──
function countLiveRowsForSprint(sp, sprintId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(getConfig(sp).SHEET_RAW);
  return readRows_(sheet).filter(function(r) { return (r[IX.SPRINT] || '').toString().trim() === sprintId; }).length;
}

function removeSnapshotForSprint(sp, sprintId) {
  const snap = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(getConfig(sp).SHEET_SNAP);
  if (!snap || snap.getLastRow() < 2) return 0;
  const W = HEADERS.length + 1;
  const data = snap.getRange(2, 1, snap.getLastRow() - 1, W).getValues();
  const kept = data.filter(function(r) { return (r[IX.SPRINT] || '').toString().trim() !== sprintId; });
  const removed = data.length - kept.length;
  if (!removed) return 0;
  snap.getRange(2, 1, data.length, W).clearContent();
  if (kept.length) snap.getRange(2, 1, kept.length, W).setValues(kept);
  Logger.log('[' + sp.key + '] Unfreeze: removed ' + removed + ' snapshot rows for ' + sprintId);
  return removed;
}

function manualSnapshotSprint(sp, sprintId) {
  sprintId = (sprintId || '').toString().trim();
  if (!sprintId) throw new Error('sprintId required');
  return withLock_(function() {
    const wasFrozen = !!getSnapshottedSprintIds(sp)[sprintId];

    // 1. Fresh Jira data, treating THIS sprint as not frozen.
    const frozenExcl = getSnapshottedSprintIds(sp);
    delete frozenExcl[sprintId];
    const res = fetchJiraData(sp, { mode: 'full', frozenIds: frozenExcl });
    const tasks = res.tasks;
    writeToSheet(sp, tasks, frozenExcl);

    // 2. Never discard a good snapshot for an empty fetch.
    const liveCount = countLiveRowsForSprint(sp, sprintId);
    if (wasFrozen && liveCount === 0) {
      const keep = {}; keep[sprintId] = true;
      cleanupFrozenLiveRows(sp, keep);
      return { ok: true, rows: 0, refreshed: false, kept: true,
               message: 'No live data in Jira for ' + sprintId + ' — existing snapshot kept unchanged.' };
    }

    // 3. Replace old snapshot with the fresh one.
    if (!wasFrozen && liveCount === 0) {
      return { ok: true, rows: 0, refreshed: false, kept: true,
               message: 'No Jira data found for ' + sprintId + ' — nothing to snapshot.' };
    }
    if (wasFrozen) removeSnapshotForSprint(sp, sprintId);
    const rows = snapshotSprint(sp, sprintId);

    // 4. Drop the now-frozen live rows; 5. clear any keep-live exemption.
    const frozenNow = {}; frozenNow[sprintId] = true;
    cleanupFrozenLiveRows(sp, frozenNow);
    const ex = getFreezeExempt(sp);
    if (ex[sprintId]) { delete ex[sprintId]; setFreezeExempt(sp, ex); }

    return { ok: true, rows: rows, refreshed: wasFrozen, kept: false,
             message: (wasFrozen ? 'Re-snapshotted ' : 'Snapshotted ') + sprintId + ' — ' + rows +
                      ' rows frozen with the latest Jira data.' };
  });
}


// ---------------------------------------------------------------
// SECTION 4: WEB APP API  (Team Capacity + Users are shared across spaces)
// ---------------------------------------------------------------

function setupTeamCapacity() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName(SHEET_CAPACITY)) { Logger.log('Team Capacity already exists.'); return; }
  const sheet = createSheetWithHeader_(SHEET_CAPACITY, ['Name', 'Email', 'Daily Hours', 'Team'], '#1a1a2e');
  sheet.setColumnWidth(1, 180); sheet.setColumnWidth(2, 240); sheet.setColumnWidth(3, 110); sheet.setColumnWidth(4, 120);
  Logger.log('Team Capacity sheet created.');
}

function getTeamCapacity() {
  const map = {};
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CAPACITY);
    if (!sheet || sheet.getLastRow() < 2) return map;
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues().forEach(function(r) {
      const name = (r[0] || '').toString().trim();
      if (!name) return;
      map[name] = {
        name: name,
        email: (r[1] || '').toString().trim().toLowerCase(),
        hours: parseFloat(r[2]) || 6,
        team: (r[3] || '').toString().trim(),
      };
    });
  } catch (e) { Logger.log('Capacity read error: ' + e.message); }
  return map;
}

function saveUserToSheet(email, name, role, dailyHours, team) {
  try {
    email = (email || '').toLowerCase().trim();
    name = (name || '').trim();
    role = (role || 'Viewer').trim();
    const hrs = parseFloat(dailyHours) || 6;
    team = (team || '').trim();
    if (!email || !name) return jsonOut_({ error: 'Email and name required' });

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let allow = ss.getSheetByName(SHEET_USERS);
    if (!allow) { setupAllowedUsers(); allow = ss.getSheetByName(SHEET_USERS); }
    let existingRow = -1;
    if (allow.getLastRow() > 1) {
      const data = allow.getRange(2, 1, allow.getLastRow() - 1, 3).getValues();
      for (let i = 0; i < data.length; i++) {
        if ((data[i][0] || '').toString().toLowerCase().trim() === email) { existingRow = i + 2; break; }
      }
    }
    if (existingRow > 0) allow.getRange(existingRow, 1, 1, 3).setValues([[email, name, role]]);
    else allow.appendRow([email, name, role]);

    let cap = ss.getSheetByName(SHEET_CAPACITY);
    if (!cap) { setupTeamCapacity(); cap = ss.getSheetByName(SHEET_CAPACITY); }
    let capRow = -1;
    if (cap.getLastRow() > 1) {
      const data = cap.getRange(2, 1, cap.getLastRow() - 1, 4).getValues();
      for (let i = 0; i < data.length; i++) {
        if ((data[i][0] || '').toString().trim() === name) { capRow = i + 2; break; }
      }
    }
    if (capRow > 0) cap.getRange(capRow, 1, 1, 4).setValues([[name, email, hrs, team]]);
    else cap.appendRow([name, email, hrs, team]);
    return jsonOut_({ ok: true });
  } catch (e) { return jsonOut_({ error: e.message }); }
}

function deleteUserFromSheet(email) {
  try {
    email = (email || '').toLowerCase().trim();
    if (!email) return jsonOut_({ error: 'Email required' });
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const allow = ss.getSheetByName(SHEET_USERS);
    if (allow && allow.getLastRow() > 1) {
      const data = allow.getRange(2, 1, allow.getLastRow() - 1, 3).getValues();
      for (let i = data.length - 1; i >= 0; i--) {
        if ((data[i][0] || '').toString().toLowerCase().trim() === email) allow.deleteRow(i + 2);
      }
    }
    const cap = ss.getSheetByName(SHEET_CAPACITY);
    if (cap && cap.getLastRow() > 1) {
      const data = cap.getRange(2, 1, cap.getLastRow() - 1, 4).getValues();
      for (let i = data.length - 1; i >= 0; i--) {
        if ((data[i][1] || '').toString().toLowerCase().trim() === email) cap.deleteRow(i + 2);
      }
    }
    return jsonOut_({ ok: true });
  } catch (e) { return jsonOut_({ error: e.message }); }
}

function getAllUsersFromSheet() {
  const users = [];
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const allow = ss.getSheetByName(SHEET_USERS);
    const cap = ss.getSheetByName(SHEET_CAPACITY);
    const capMap = {};
    if (cap && cap.getLastRow() > 1) {
      cap.getRange(2, 1, cap.getLastRow() - 1, 4).getValues().forEach(function(r) {
        const em = (r[1] || '').toString().toLowerCase().trim();
        if (em) capMap[em] = { hours: parseFloat(r[2]) || 6, team: (r[3] || '').toString().trim() };
      });
    }
    if (allow && allow.getLastRow() > 1) {
      allow.getRange(2, 1, allow.getLastRow() - 1, 3).getValues().forEach(function(r) {
        const em = (r[0] || '').toString().toLowerCase().trim();
        if (!em) return;
        const extra = capMap[em] || { hours: 6, team: '' };
        users.push({ email: em, name: r[1] || '', role: r[2] || 'Viewer', hours: extra.hours, team: extra.team });
      });
    }
  } catch (e) { Logger.log('getAllUsers error: ' + e.message); }
  return users;
}

// ── Access Control (unchanged) ──
function isAdminUser(email) {
  if (!email) return false;
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS);
    if (!sheet || sheet.getLastRow() < 2) return false;
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
    const em = email.toLowerCase().trim();
    for (let i = 0; i < data.length; i++) {
      if ((data[i][0] || '').toString().toLowerCase().trim() === em) {
        return (data[i][2] || '').toString().trim().toLowerCase() === 'admin';
      }
    }
  } catch (e) {}
  return false;
}

function isAllowedUser(email) {
  if (!email) return false;
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS);
    if (!sheet || sheet.getLastRow() < 2) return false;
    const emails = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues()
      .map(function(r) { return (r[0] || '').toString().toLowerCase().trim(); })
      .filter(function(e) { return e; });
    return emails.indexOf(email.toLowerCase().trim()) !== -1;
  } catch (e) { Logger.log('Auth check error: ' + e.message); return false; }
}

function checkUserAccess(email) {
  const allowed = isAllowedUser(email);
  let role = '', name = '';
  if (allowed) {
    try {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS);
      const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
      for (let i = 0; i < data.length; i++) {
        if ((data[i][0] || '').toString().toLowerCase().trim() === email.toLowerCase().trim()) {
          name = data[i][1] || ''; role = data[i][2] || 'Viewer'; break;
        }
      }
    } catch (e) {}
  }
  return jsonOut_({ allowed: allowed, email: email, name: name, role: role });
}

function setupAllowedUsers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName(SHEET_USERS)) { Logger.log('Allowed Users sheet already exists.'); return; }
  const sheet = createSheetWithHeader_(SHEET_USERS, ['Email', 'Name', 'Role'], '#1a1a2e');
  sheet.setColumnWidth(1, 240); sheet.setColumnWidth(2, 160); sheet.setColumnWidth(3, 100);
  sheet.getRange(2, 3, 100, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['Admin', 'Viewer'], true).setAllowInvalid(false).build());
  Logger.log('Allowed Users sheet created. Add emails in column A.');
}


// ---------------------------------------------------------------

function doGet(e) {
  const p = (e && e.parameter) || {};
  const action = p.action || null;
  const sprintId = p.sprint || null;
  const userEmail = (p.email || '').toLowerCase().trim();

  if (action === 'checkAccess') return checkUserAccess(userEmail);

  if (!userEmail || !isAllowedUser(userEmail)) {
    return jsonOut_({ error: 'unauthorized', message: 'Access denied. Please contact admin to add your email.' });
  }

  // Users are global — no space needed.
  if (action === 'saveUser' || action === 'deleteUser' || action === 'listUsers') {
    if (!isAdminUser(userEmail)) {
      return jsonOut_({ error: 'forbidden', message: 'Admin access required for user management' });
    }
    if (action === 'saveUser') return saveUserToSheet(p.targetEmail, p.targetName, p.targetRole, p.targetHours, p.targetTeam);
    if (action === 'deleteUser') return deleteUserFromSheet(p.targetEmail);
    return jsonOut_({ users: getAllUsersFromSheet() });
  }

  if (action === 'listSpaces') {
    return jsonOut_({ spaces: getSpaceOrder_().map(function(k) { const s = getSpace(k); return { key: s.key, name: spaceDisplayName_(s), kind: s.kind }; }) });
  }

  // Everything else is per space (&space=KEY; defaults to the first space).
  let sp;
  try { sp = getSpace(p.space); }
  catch (err) { return jsonOut_({ error: 'bad_space', message: err.message }); }

  if (action === 'saveSprintGoal') return saveSprintGoalToSheet(sp, (p.sprintId || '').trim(), (p.text || '').trim());

  // Sync Now: every space (the one on screen first). If the 6-minute limit gets
  // close, the rest continue in a follow-up run a minute later.
  if (action === 'manualSync') {
    try {
      const t0 = Date.now();
      const order = [sp.key].concat(getSpaceOrder_().filter(function(k) { return k !== sp.key; }));
      const done = [], failed = [];
      let left = [];
      withLock_(function() {
        for (let i = 0; i < order.length; i++) {
          if (i > 0 && Date.now() - t0 > 4.5 * 60 * 1000) { left = order.slice(i); break; }
          try { syncSpace_(getSpace(order[i]), 'full'); done.push(order[i]); }
          catch (e) { failed.push(order[i] + ': ' + e.message); }
        }
      });
      if (left.length) scheduleContinuation_(left);
      const currentOk = done.indexOf(sp.key) !== -1;
      return jsonOut_({ ok: currentOk, space: sp.key, synced: done, failed: failed, continuing: left,
                        error: currentOk ? undefined : (failed[0] || 'sync failed'),
                        durationMs: Date.now() - t0, syncedAt: new Date().toISOString() });
    } catch (err) {
      return jsonOut_({ ok: false, error: String((err && err.message) || err) });
    }
  }

  if (action === 'snapshotSprint') {
    try {
      return jsonOut_(manualSnapshotSprint(sp, (p.sprintId || p.sprint || '').trim()));
    } catch (err) {
      return jsonOut_({ ok: false, error: String((err && err.message) || err) });
    }
  }

  if (action === 'saveRetro') return saveRetroToSheet(sp, (p.sprintId || '').trim(), (p.data || '').trim());

  if (action === 'saveLeave') {
    return saveLeaveToSheet(sp, (p.leaveId || '').trim(), (p.sprintId || '').trim(), (p.fullName || '').trim(),
      (p.team || '').trim(), (p.leaveDate || '').trim(), (p.taskCount || 0), (p.hours || 6),
      (p.note || '').trim(), userEmail);
  }
  if (action === 'deleteLeave') return deleteLeaveFromSheet(sp, (p.leaveId || '').trim());

  let data;
  try { data = getDashboardData(sp, sprintId); }
  catch (err) { data = { error: 'server', message: String((err && err.message) || err), sprints: [], tasks: [] }; }
  const json = JSON.stringify(data);
  if (p.callback) {
    return ContentService.createTextOutput(p.callback + '(' + json + ')').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function saveSprintGoalToSheet(sp, sprintId, text) {
  try {
    const cfg = getConfig(sp);
    const now = Utilities.formatDate(new Date(), 'Asia/Karachi', 'dd MMM yyyy HH:mm');
    const g = createSheetWithHeader_(cfg.SHEET_GOALS, ['Sprint ID', 'Updated At', 'Goal Text'], '#1a1a2e');
    const rows = g.getLastRow() > 1 ? g.getRange(2, 1, g.getLastRow() - 1, 3).getValues() : [];
    let rowIdx = -1;
    for (let i = 0; i < rows.length; i++) { if (rows[i][0] === sprintId) { rowIdx = i + 2; break; } }
    if (!text) { if (rowIdx > 0) g.deleteRow(rowIdx); }
    else if (rowIdx > 0) { g.getRange(rowIdx, 2).setValue(now); g.getRange(rowIdx, 3).setValue(text); }
    else g.appendRow([sprintId, now, text]);

    if (text) {
      const log = createSheetWithHeader_(cfg.SHEET_GOALS_LOG, ['Sprint ID', 'Saved At', 'Goal Text'], '#1a1a2e');
      log.appendRow([sprintId, now, text]);
    }
    return jsonOut_({ ok: true });
  } catch (e) { return jsonOut_({ error: e.message }); }
}

function saveLeaveToSheet(sp, leaveId, sprintId, fullName, team, leaveDate, taskCount, hours, note, email) {
  try {
    if (!leaveId || !sprintId || !fullName || !leaveDate) return jsonOut_({ ok: false, message: 'Missing required leave fields.' });
    const name = getConfig(sp).SHEET_LEAVE;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = createSheetWithHeader_(name, ['Leave ID', 'Sprint ID', 'Full Name', 'Team', 'Leave Date', 'Task Count', 'Hours', 'Note', 'Sprint'], '#1a1a2e');
      sheet.getRange(2, 5, sheet.getMaxRows() - 1, 1).setNumberFormat('@');
    }
    sheet.appendRow([leaveId, sprintId, fullName, team, "'" + leaveDate, taskCount, hours, note, sprintId]);
    return jsonOut_({ ok: true });
  } catch (e) { return jsonOut_({ ok: false, message: e.message }); }
}

function deleteLeaveFromSheet(sp, leaveId) {
  try {
    if (!leaveId) return jsonOut_({ ok: false, message: 'Leave ID required.' });
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(getConfig(sp).SHEET_LEAVE);
    if (!sheet || sheet.getLastRow() < 2) return jsonOut_({ ok: false, message: 'Leave record not found.' });
    const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(leaveId)) { sheet.deleteRow(i + 2); return jsonOut_({ ok: true }); }
    }
    return jsonOut_({ ok: false, message: 'Leave record not found.' });
  } catch (e) { return jsonOut_({ ok: false, message: e.message }); }
}

function saveRetroToSheet(sp, sprintId, jsonData) {
  try {
    const cfg = getConfig(sp);
    const now = Utilities.formatDate(new Date(), 'Asia/Karachi', 'dd MMM yyyy HH:mm');
    const r = createSheetWithHeader_(cfg.SHEET_RETRO, ['Sprint ID', 'Updated At', 'Retro Data (JSON)'], '#1a1a2e');
    const rows = r.getLastRow() > 1 ? r.getRange(2, 1, r.getLastRow() - 1, 3).getValues() : [];
    let rowIdx = -1;
    for (let i = 0; i < rows.length; i++) { if (rows[i][0] === sprintId) { rowIdx = i + 2; break; } }
    if (rowIdx > 0) { r.getRange(rowIdx, 2).setValue(now); r.getRange(rowIdx, 3).setValue(jsonData); }
    else r.appendRow([sprintId, now, jsonData]);
    const log = createSheetWithHeader_(cfg.SHEET_RETRO_LOG, ['Sprint ID', 'Saved At', 'Retro Data (JSON)'], '#1a1a2e');
    log.appendRow([sprintId, now, jsonData]);
    return jsonOut_({ ok: true });
  } catch (e) { return jsonOut_({ error: e.message }); }
}


// Jira status category of a sheet row (col 24). Rows written before the
// category column existed fall back to the status text.
function categoryOfRow_(row) {
  const c = (row[IX.STATUS_CAT] || '').toString().trim();
  if (c === 'To Do' || c === 'In Progress' || c === 'Done') return c;
  const st = (row[IX.STATUS] || '').toString().trim().toLowerCase();
  if (st === 'done' || st === 'closed' || st === 'resolved') return 'Done';
  if (!st || st === 'not started' || st === 'to do' || st === 'open' || st === 'backlog') return 'To Do';
  return 'In Progress';
}

// Sprint list order for the UI. The page reverses this list and opens the
// first entry, so: future / undated sprints first, then the rest by start
// date (oldest → newest). After the page reverses it, the newest sprint that
// has STARTED (the active one) is the default, older sprints follow, and
// sprints that haven't started yet sit at the bottom of the dropdown.
function orderSprints_(list) {
  const today = startOfDay_(new Date());
  return list.slice().sort(function(a, b) {
    const da = parseSprintDate(a.start), db = parseSprintDate(b.start);
    const fa = !da || da > today, fb = !db || db > today;
    if (fa !== fb) return fa ? -1 : 1;
    return (da ? da.getTime() : 0) - (db ? db.getTime() : 0);
  });
}

function getDashboardData(sp, filterSprint) {
  if (sp.kind === 'discovery') return getDiscoveryData(sp);   // ideas, not sprints
  const cfg = getConfig(sp);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const liveData = readRows_(ss.getSheetByName(cfg.SHEET_RAW));
  const snapData = readRows_(ss.getSheetByName(cfg.SHEET_SNAP));   // drops trailing "Snapshotted On"

  // Snapshot rows take precedence for any frozen sprintId.
  const frozenSet = {};
  snapData.forEach(function(r) { const id = (r[IX.SPRINT] || '').toString().trim(); if (id) frozenSet[id] = true; });
  const filteredLive = liveData.filter(function(r) { return !frozenSet[(r[IX.SPRINT] || '').toString().trim()]; });

  const spaceInfo = { key: sp.key, name: spaceDisplayName_(sp), kind: sp.kind };
  if (!snapData.length && !filteredLive.length) {
    return { error: 'No data', space: spaceInfo, sprints: [], tasks: [], goals: [], bugsTasks: [], backlogTasks: [], carriedOver: [] };
  }

  const data = snapData.concat(filteredLive);

  // Sprint list = every sprint that has at least one work item.
  // `completed` = the date Jira closed the sprint (Spillovers use it).
  let regMap = {};
  try { regMap = readSprintRegistry_(sp); } catch (e) {}
  const sprintsMap = {};
  data.forEach(function(r) {
    const sid = r[IX.SPRINT];
    if (sid && r[IX.SECTION] === 'Sprint' && r[IX.LEVEL] === 'Task' && !sprintsMap[sid]) {
      const rg = regMap[sid] || {};
    sprintsMap[sid] = { id: sid, start: r[IX.START], end: r[IX.END], completed: rg.completed || '',
                        state: rg.state || '', startIso: rg.startIso || '', endIso: rg.endIso || '' };
    }
  });

  // status         = Jira status CATEGORY (To Do | In Progress | Done) — what
  //                  Jira itself uses to decide done / in progress / to do.
  // statusName     = the Jira status exactly as shown in Jira (e.g. "Paused").
  // addedAfterStart= added to the sprint after it started (Jira scope change).
  function rowToTask(row) {
    const cat = categoryOfRow_(row);
    return {
      taskName: row[0], mssTicket: row[1], sprintId: row[2], sprintStart: row[3], sprintEnd: row[4],
      sectionType: row[5], assignee: row[6], priority: row[7], estTime: row[8] || 0, timeLog: row[9] || 0,
      status: cat, statusName: (row[10] || cat).toString(), ticketType: row[11], buildTag: row[12],
      teamCategory: row[13], featureTag: row[14], createdBy: row[15], createdOn: row[16], dueDate: row[17],
      impactScore: row[18] || '', taskLevel: row[19], parentTask: row[20], issueType: row[24] || '',
      addedAfterStart: row[29] === true || String(row[29]).toUpperCase() === 'TRUE',
      resolvedOn: row[25] || '',
    };
  }
  function isBugLike(r) { return r[11] === 'Bug' || r[11] === 'Polish'; }

  // Work items in sprints. Bugs / polish are in their sprint like any work item
  // (Jira), but reported in their own card, so they travel separately.
  const tasks = data.filter(function(r) {
    return r[0] && r[5] === 'Sprint' && r[19] === 'Task' && !isBugLike(r) && (!filterSprint || r[2] === filterSprint);
  }).map(rowToTask);
  const subtasks = data.filter(function(r) {
    return r[0] && r[5] === 'Sprint' && r[19] === 'Subtask' && !isBugLike(r) && (!filterSprint || r[2] === filterSprint);
  }).map(rowToTask);
  const bugsTasks = data.filter(function(r) { return r[0] && r[5] === 'Sprint' && r[19] === 'Task' && isBugLike(r); }).map(rowToTask);
  // Sub-tasks of bugs / polish — only used by the Status overview, which counts
  // every work item in the sprint (like Jira's Summary with a sprint filter).
  const bugSubtasks = data.filter(function(r) {
    return r[0] && r[5] === 'Sprint' && r[19] === 'Subtask' && isBugLike(r) && (!filterSprint || r[2] === filterSprint);
  }).map(rowToTask);
  const backlogTasks = data.filter(function(r) { return r[0] && r[5] === 'Backlog' && r[19] === 'Task'; }).map(rowToTask);
  // Epics in a sprint — not work items, only counted in Jira's "Issues by Status".
  const containers = data.filter(function(r) { return r[0] && r[5] === 'Sprint' && r[19] === 'Epic' && (!filterSprint || r[2] === filterSprint); }).map(rowToTask);

  const carriedOver = [];
  if (filterSprint) {
    tasks.forEach(function(t) {
      if (!t.mssTicket || t.status === 'Done') return;
      const inOther = data.some(function(r) {
        return r[1] === t.mssTicket && r[5] === 'Sprint' && r[19] === 'Task' && r[2] !== filterSprint;
      });
      if (inOther) carriedOver.push(t);
    });
  }

  // Sprint Goals — dashboard-saved goal wins; otherwise the Jira sprint goal.
  const sprintGoals = {};
  try {
    const g = ss.getSheetByName(cfg.SHEET_GOALS);
    if (g && g.getLastRow() > 1) {
      g.getRange(2, 1, g.getLastRow() - 1, 3).getValues().forEach(function(r) {
        if (r[0]) sprintGoals[r[0]] = { text: r[2] || '', updatedAt: r[1] || '' };
      });
    }
    const reg = readSprintRegistry_(sp);
    Object.keys(reg).forEach(function(id) {
      if (!sprintGoals[id] && reg[id].goal) sprintGoals[id] = { text: reg[id].goal, updatedAt: '' };
    });
  } catch (e) { Logger.log('Goals read error: ' + e.message); }

  let lastSync = '';
  try {
    const log = ss.getSheetByName(cfg.SHEET_LOG);
    if (log && log.getLastRow() > 1) {
      const rows = log.getRange(2, 1, log.getLastRow() - 1, 3).getValues();
      for (let i = rows.length - 1; i >= 0; i--) { if (rows[i][2] === 'SUCCESS') { lastSync = rows[i][0] || ''; break; } }
    }
  } catch (e) {}

  const retrospectives = {};
  try {
    const r = ss.getSheetByName(cfg.SHEET_RETRO);
    if (r && r.getLastRow() > 1) {
      r.getRange(2, 1, r.getLastRow() - 1, 3).getValues().forEach(function(row) {
        if (!row[0]) return;
        try { retrospectives[row[0]] = { data: JSON.parse(row[2] || '{}'), updatedAt: row[1] || '' }; }
        catch (e) { Logger.log('Retro JSON parse error for ' + row[0]); }
      });
    }
  } catch (e) { Logger.log('Retro read error: ' + e.message); }

  const leaveRecords = [];
  try {
    const l = ss.getSheetByName(cfg.SHEET_LEAVE);
    if (l && l.getLastRow() > 1) {
      l.getRange(2, 1, l.getLastRow() - 1, 9).getValues().forEach(function(row) {
        if (!row[0]) return;
        leaveRecords.push({ id: row[0], sprintId: row[1], fullName: row[2], team: row[3], date: row[4],
                            taskCount: row[5] || 0, hours: row[6] || 6, note: row[7] || '' });
      });
    }
  } catch (e) { Logger.log('Leave read error: ' + e.message); }

  return {
    space          : spaceInfo,
    sprints        : orderSprints_(Object.values(sprintsMap)),
    tasks          : tasks,
    subtasks       : subtasks,
    goals          : [],
    sprintGoals    : sprintGoals,
    retrospectives : retrospectives,
    teamCapacity   : getTeamCapacity(),
    lastSync       : lastSync,
    bugsTasks      : bugsTasks,
    bugSubtasks    : bugSubtasks,
    backlogTasks   : backlogTasks,
    carriedOver    : carriedOver,
    containers     : containers,
    burndown       : readBurndowns_(sp),
    settings       : { completionCount: (getSetting(sp, 'COMPLETION_COUNT') || 'subtasks').toLowerCase() },
    frozenSprintIds: Object.keys(frozenSet),
    leaves         : leaveRecords,
  };
}


// ---------------------------------------------------------------
// SECTION 4.4: SPRINT BURNDOWN (the data behind Jira's Sprint Burndown gadget)
// ---------------------------------------------------------------
// Jira's Burndown Chart report and the dashboard "Sprint Burndown Gadget" are
// drawn from GET /rest/greenhopper/1.0/rapid/charts/scopechangeburndownchart
// (board + sprint): every scope / estimate / time-spent / status change with
// its timestamp, the sprint start / end, and the board's non-working days.
// We replay those changes exactly like the gadget:
//   Remaining Values = Σ Remaining Estimate of the work items in the sprint
//                      (sub-tasks follow their parent into the sprint)
//   Time Spent       = Σ time logged during the sprint on items in the sprint
//   Guideline        = start value → 0 at sprint end, flat on non-working days
// Boards without time tracking use the board's estimate statistic instead.
const BURN_HEADERS = ['Sprint ID', 'Jira Sprint ID', 'Start (Jira)', 'End (Jira)', 'Completed (Jira)', 'Updated', 'Series (JSON)', 'Per person (JSON)'];

function fetchBurndownRaw_(sp, jiraSprintId) {
  return jiraRequest_('get', '/rest/greenhopper/1.0/rapid/charts/scopechangeburndownchart.json?rapidViewId=' +
    sp.boardId + '&sprintId=' + jiraSprintId);
}

// raw chart JSON → { start, end, complete, stop, unit, nw:[[s,e]], p:[[t, remaining, spent]] } (ms, hours)
// keyFilter (optional): only these work items count (per-person burndown).
function computeBurndown_(raw, doneMode, keyFilter) {
  const changes = raw.changes || {};
  const start = +raw.startTime, end = +raw.endTime, now = +raw.now || Date.now();
  const complete = raw.completeTime ? +raw.completeTime : null;
  const stop = complete ? Math.min(complete, now) : Math.min(now, Math.max(end, now));
  const parents = raw.issueToParentKeys || {};
  const times = Object.keys(changes).map(Number).sort(function(a, b) { return a - b; });
  const useTime = times.some(function(t) { return (changes[t] || []).some(function(c) { return c.timeC; }); });
  const div = useTime ? 3600 : 1;
  const st = {};
  const S = function(k) { return st[k] = st[k] || { added: false, est: 0, done: false, spent: 0 }; };
  const inSprint = function(k) { const x = st[k]; if (x && x.added) return true; const pk = parents[k]; return !!(pk && st[pk] && st[pk].added); };
  const burnDone = String(doneMode || 'keep').toLowerCase() === 'burn';
  const snap = function(t) {
    let rem = 0, sp2 = 0;
    Object.keys(st).forEach(function(k) {
      if (!inSprint(k) || (keyFilter && !keyFilter(k))) return;
      const x = st[k];
      if (!(burnDone && x.done)) rem += x.est;
      sp2 += x.spent;
    });
    return [t, Math.round(rem * 100) / 100, Math.round(sp2 * 100) / 100];
  };
  const apply = function(t) {
    (changes[t] || []).forEach(function(c) {
      const x = S(c.key);
      if (c.added !== undefined) x.added = !!c.added;
      if (c.column && c.column.done !== undefined) x.done = !!c.column.done;
      if (useTime && c.timeC) {
        if (c.timeC.newEstimate != null) x.est = (+c.timeC.newEstimate || 0) / div;
        if (t > start && c.timeC.timeSpent) x.spent += (+c.timeC.timeSpent || 0) / 3600;
      } else if (!useTime && c.statC && c.statC.newValue != null) x.est = +c.statC.newValue || 0;
    });
  };
  const p = [];
  let started = false;
  times.forEach(function(t) {
    if (t > stop) return;
    if (t <= start) { apply(t); return; }
    if (!started) { p.push(snap(start)); started = true; }
    apply(t);
    p.push(snap(t));
  });
  if (!started) p.push(snap(start));
  const last = snap(stop);
  if (last[0] > p[p.length - 1][0]) p.push(last);
  // drop points that change nothing (keeps the sheet cell small)
  const pts = p.filter(function(x, i) { return i === 0 || i === p.length - 1 || x[1] !== p[i - 1][1] || x[2] !== p[i - 1][2]; });
  const nw = ((raw.workRateData && raw.workRateData.rates) || []).filter(function(r) { return +r.rate === 0; })
    .map(function(r) { return [Math.max(+r.start, start), Math.min(+r.end, end)]; }).filter(function(r) { return r[1] > r[0]; });
  return { start: start, end: end, complete: complete, stop: stop, unit: useTime ? 'h' : 'pts', nw: nw, p: pts, notStarted: !!raw.notStarted };
}

// Compact form for the sheet: times as minutes from sprint start.
function packBurndown_(b) { return JSON.stringify(packObj_(b)); }
function packObj_(b) {
  const m = function(t) { return Math.round((t - b.start) / 60000); };
  return ({ v: 1, start: b.start, end: b.end, complete: b.complete, stop: b.stop, unit: b.unit, ns: b.notStarted ? 1 : 0,
    nw: b.nw.map(function(r) { return [m(r[0]), m(r[1])]; }), p: b.p.map(function(x) { return [m(x[0]), x[1], x[2]]; }) });
}
// Per person: each work item counts for its current Jira assignee (sub-tasks
// for their own assignee). Only the points are stored; dates come from the sprint.
function packPeople_(raw, mode, keyToPerson) {
  const people = {};
  Object.keys(keyToPerson).forEach(function(k) { const n = keyToPerson[k]; if (n && n !== 'Unassigned') people[n] = true; });
  const out = {};
  Object.keys(people).sort().forEach(function(n) {
    const b = computeBurndown_(raw, mode, function(k) { return keyToPerson[k] === n; });
    if (b.p.some(function(x) { return x[1] || x[2]; })) out[n] = packObj_(b).p;
  });
  let json = JSON.stringify(out);
  // keep the cell under the Sheets 50,000-character limit
  for (let step = 2; json.length > 48000 && step < 64; step *= 2) {
    const thin = {};
    Object.keys(out).forEach(function(n) { const p = out[n]; thin[n] = p.filter(function(x, i) { return i === 0 || i === p.length - 1 || i % step === 0; }); });
    json = JSON.stringify(thin);
  }
  return json;
}
function unpackBurndown_(json) {
  try {
    const o = JSON.parse(json); const t = function(mn) { return o.start + mn * 60000; };
    return { start: o.start, end: o.end, complete: o.complete, stop: o.stop, unit: o.unit, notStarted: !!o.ns,
      nw: (o.nw || []).map(function(r) { return [t(r[0]), t(r[1])]; }), p: (o.p || []).map(function(x) { return [t(x[0]), x[1], x[2]]; }) };
  } catch (e) { return null; }
}

// A sprint that has not started: the chart data Jira would start from —
// every work item in the sprint with its Remaining Estimate now, the planned
// start / end and the weekends (Asia/Karachi) as non-working days.
function plannedBurndownRaw_(sp, e) {
  const start = new Date(e.startIso).getTime(), end = new Date(e.endIso || e.startIso).getTime();
  const issues = jiraSearch_('project = "' + sp.key + '" AND sprint = ' + e.jiraId, ['timeestimate', 'parent', 'issuetype']);
  const t0 = start - 60000, parents = {}, changes = {};
  changes[t0] = issues.map(function(i) {
    if (i.fields.issuetype && i.fields.issuetype.subtask && i.fields.parent) parents[i.key] = i.fields.parent.key;
    return { key: i.key, added: true, timeC: { newEstimate: i.fields.timeestimate || 0, timeSpent: 0 } };
  });
  const PKT = 5 * 3600000, rates = [];
  for (let d = Math.floor((start + PKT) / 864e5) * 864e5 - PKT; d < end; d += 864e5) {
    const w = new Date(d + PKT).getUTCDay();
    if (w === 0 || w === 6) rates.push({ start: d, end: d + 864e5, rate: 0 });
  }
  return { notStarted: true, startTime: start, endTime: end, now: start, changes: changes,
           issueToParentKeys: parents, workRateData: { rates: rates } };
}

function syncBurndowns_(sp, reg, frozenIds, activeOnly, assignees) {
  if (!sp.boardId) return;
  const name = spaceSheetName(sp, 'Burndown');
  const sh = refreshHeader_(createSheetWithHeader_(name, BURN_HEADERS, '#1a1a2e'), BURN_HEADERS);
  const rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, BURN_HEADERS.length).getValues() : [];
  const idx = {}; rows.forEach(function(r, i) { if (r[0]) idx[r[0]] = i; });
  const mode = getSetting(sp, 'BURNDOWN_DONE') || 'keep';
  // who owns each work item now (from the rows just synced)
  const keyToPerson = {};
  readRows_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(getConfig(sp).SHEET_RAW)).forEach(function(r) {
    if (r[IX.KEY]) keyToPerson[r[IX.KEY]] = (r[IX.ASSIGNEE] || 'Unassigned').toString();
  });
  Object.keys(assignees || {}).forEach(function(k) { keyToPerson[k] = assignees[k]; });
  let n = 0;
  reg.list.forEach(function(e) {
    if (!e.jiraId || !e.startIso) return;
    if (activeOnly && e.state !== 'active' && e.state !== 'future') return;
    if (frozenIds && frozenIds[e.sprintId] && idx[e.sprintId] !== undefined) return;   // frozen: keep what we have
    try {
      // Not started yet: Jira has no burndown — same chart, guideline from today's remaining estimate
      const raw = e.state === 'future' ? plannedBurndownRaw_(sp, e) : fetchBurndownRaw_(sp, e.jiraId);
      const packed = packBurndown_(computeBurndown_(raw, mode));
      const row = [e.sprintId, e.jiraId, e.startIso, e.endIso, e.completed || '', new Date().toISOString(), packed, packPeople_(raw, mode, keyToPerson)];
      if (idx[e.sprintId] !== undefined) rows[idx[e.sprintId]] = row; else { idx[e.sprintId] = rows.length; rows.push(row); }
      n++;
    } catch (err) { Logger.log('[' + sp.key + '] Burndown for ' + e.sprintId + ' not available: ' + String(err.message).slice(0, 160)); }
  });
  if (rows.length) {
    sh.getRange(2, 3, rows.length, 4).setNumberFormat('@');
    sh.getRange(2, 1, rows.length, BURN_HEADERS.length).setValues(rows);
  }
  if (n) Logger.log('[' + sp.key + '] Burndown updated for ' + n + ' sprint(s).');
}

function readBurndowns_(sp) {
  const out = {};
  try {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(spaceSheetName(sp, 'Burndown'));
    if (!sh || sh.getLastRow() < 2) return out;
    sh.getRange(2, 1, sh.getLastRow() - 1, BURN_HEADERS.length).getValues().forEach(function(r) {
      const b = r[0] && r[6] ? unpackBurndown_(String(r[6])) : null;
      if (!b) return;
      b.people = {};
      try {
        const pp = r[7] ? JSON.parse(String(r[7])) : {};
        Object.keys(pp).forEach(function(n) { b.people[n] = pp[n].map(function(x) { return [b.start + x[0] * 60000, x[1], x[2]]; }); });
      } catch (e) {}
      out[r[0]] = b;
    });
  } catch (e) { Logger.log('Burndown read error: ' + e.message); }
  return out;
}


// ---------------------------------------------------------------
// SECTION 4.5: DISCOVERY IDEAS (Jira Product Discovery)
// ---------------------------------------------------------------
// Discovery spaces have no sprints, estimates or time logs — their dashboard
// shows ideas. Each sync reads every idea with ALL its fields and rewrites the
// "<KEY> - Ideas" tab:
//   • fixed columns (key, summary, Jira status, people, dates, delivery progress)
//   • one column per idea field that has a value in this space, named exactly
//     as in Jira (Theme, Roadmap, Impact, Effort, Confidence, Ratings …)
//   • "Fields (JSON)" — the same fields with their exact types (lists, numbers)
//     which the dashboard reads.
// Delivery progress = delivery work items linked to the idea, by Jira status
// category. A linked epic counts through its child work items (JPD rule).
// Archived ideas (JPD "Archived" field set) are left out, like Jira's views.

const IDEA_HEADERS = ['Idea Key', 'Summary', 'Issue Type', 'Jira Status', 'Status Category', 'Creator', 'Assignee',
  'Reporter', 'Created', 'Updated', 'Labels', 'Delivery Done', 'Delivery In Progress', 'Delivery To Do',
  'Delivery Items', 'Issue ID'];
const IDEA_JSON_HEADER = 'Fields (JSON)';
const IDEA_NOISE_FIELDS = /^(rank|sprint|development|flagged|request participants|satisfaction( date)?|issue color|vulnerability|\[chart\].*)$/i;

// Jira field value → plain value (option → its name, user → display name, list → list).
function ideaValue_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    const a = v.map(ideaValue_).filter(function(x) { return x !== null && x !== ''; });
    return a.length ? a : null;
  }
  if (typeof v === 'object') {
    if (v.value !== undefined) return v.child && v.child.value ? v.value + ' → ' + v.child.value : v.value;
    if (v.displayName !== undefined) return v.displayName;
    if (v.name !== undefined) return v.name;
    if (v.title !== undefined) return v.title;
    if (v.key !== undefined) return v.key;
    try { const j = JSON.stringify(v); return j === '{}' ? null : j.slice(0, 500); } catch (e) { return null; }
  }
  return String(v);
}
function ideaCell_(v) { return v === null ? '' : Array.isArray(v) ? v.join(', ') : v; }

// Read every idea in the space → { ideas: [...], fieldNames: [...] }
function fetchIdeas_(sp) {
  const fm = getFieldMap_();
  const issues = jiraSearch_('project = "' + sp.key + '" ORDER BY created ASC', ['*all']);
  const ideas = [], used = {}, epicKeys = [];
  issues.forEach(function(i) {
    const f = i.fields || {};
    if (f.issuetype && f.issuetype.subtask) return;
    const custom = {};
    Object.keys(f).forEach(function(id) {
      if (!/^customfield_\d+$/.test(id)) return;
      const name = fm.byId[id] || id;
      if (IDEA_NOISE_FIELDS.test(name)) return;
      const v = ideaValue_(f[id]);
      if (v !== null) custom[name] = v;
    });
    if (custom['Archived'] || custom['Archived on'] || custom['Archived by']) return;   // archived idea
    Object.keys(custom).forEach(function(n) { used[n] = true; });
    const links = [];
    (f.issuelinks || []).forEach(function(l) {
      const o = l.outwardIssue || l.inwardIssue;
      if (!o || !o.key || o.key.split('-')[0] === sp.key) return;          // idea ↔ idea links are not delivery
      if (links.some(function(x) { return x.key === o.key; })) return;
      const of = o.fields || {};
      const lvl = of.issuetype && of.issuetype.hierarchyLevel != null ? of.issuetype.hierarchyLevel : 0;
      links.push({ key: o.key, cat: of.status && of.status.statusCategory ? of.status.statusCategory.key : 'new', epic: lvl >= 1 });
      if (lvl >= 1 && epicKeys.indexOf(o.key) === -1) epicKeys.push(o.key);
    });
    ideas.push({
      key: i.key, id: i.id, summary: f.summary || '', type: f.issuetype ? f.issuetype.name : '',
      status: f.status ? f.status.name : '', statusCat: CATEGORY_NAME[(f.status && f.status.statusCategory && f.status.statusCategory.key) || 'new'] || 'To Do',
      creator: f.creator ? f.creator.displayName : '', assignee: f.assignee ? f.assignee.displayName : '',
      reporter: f.reporter ? f.reporter.displayName : '', created: f.created || '', updated: f.updated || '',
      labels: f.labels || [], links: links, fields: custom,
    });
  });
  // Children of linked epics (delivery work counted through them).
  const kids = {};
  chunk_(epicKeys, 50).forEach(function(keys) {
    try {
      jiraSearch_('parent in (' + keys.join(',') + ')', ['status', 'parent']).forEach(function(c) {
        const pk = c.fields.parent && c.fields.parent.key; if (!pk) return;
        (kids[pk] = kids[pk] || []).push({ key: c.key, cat: c.fields.status && c.fields.status.statusCategory ? c.fields.status.statusCategory.key : 'new' });
      });
    } catch (e) { Logger.log('Epic children fetch failed: ' + e.message); }
  });
  ideas.forEach(function(it) {
    const d = { done: 0, prog: 0, todo: 0, items: [] };
    it.links.forEach(function(l) {
      const list = l.epic && kids[l.key] && kids[l.key].length ? kids[l.key] : [l];
      list.forEach(function(x) {
        if (d.items.indexOf(x.key) !== -1) return;
        d.items.push(x.key);
        if (x.cat === 'done') d.done++; else if (x.cat === 'indeterminate') d.prog++; else d.todo++;
      });
    });
    it.delivery = d; delete it.links;
  });
  return { ideas: ideas, fieldNames: Object.keys(used).sort(function(a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; }) };
}

function syncIdeas_(sp) {
  const res = fetchIdeas_(sp);
  const headers = IDEA_HEADERS.concat(res.fieldNames, [IDEA_JSON_HEADER]);
  const rows = res.ideas.map(function(it) {
    return [it.key, it.summary, it.type, it.status, it.statusCat, it.creator, it.assignee, it.reporter,
      formatDate(it.created), formatDate(it.updated), it.labels.join(', '), it.delivery.done, it.delivery.prog,
      it.delivery.todo, it.delivery.items.join(', '), it.id]
      .concat(res.fieldNames.map(function(n) { return ideaCell_(it.fields[n] === undefined ? null : it.fields[n]); }))
      .concat([JSON.stringify(it.fields)]);
  });
  const sh = createSheetWithHeader_(getConfig(sp).SHEET_IDEAS, IDEA_HEADERS, '#1a1a2e');
  if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  sh.clearContents();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setBackground('#1a1a2e').setFontColor('#ffffff').setFontWeight('bold');
  if (rows.length) sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  Logger.log('[' + sp.key + '] Ideas: ' + rows.length + ' | idea fields: ' + (res.fieldNames.join(', ') || 'none'));
  return rows.length;
}

// Which idea field plays which role (Jira Config DISC_* settings; first match).
function ideaRoles_(sp, fieldNames) {
  const lower = {}; fieldNames.forEach(function(n) { lower[n.toLowerCase()] = n; });
  const pick = function(setting) { return getListSetting(sp, setting).map(function(n) { return lower[n.toLowerCase()]; }).filter(function(n) { return n; }); };
  return {
    state: pick('DISC_STATE_FIELD')[0] || null, theme: pick('DISC_THEME_FIELD')[0] || null,
    roadmap: pick('DISC_ROADMAP_FIELD')[0] || null, impact: pick('DISC_IMPACT_FIELD')[0] || null,
    effort: pick('DISC_EFFORT_FIELDS'), confidence: pick('DISC_CONFIDENCE_FIELD')[0] || null,
    votes: pick('DISC_VOTES_FIELD')[0] || null, score: pick('DISC_SCORE_FIELD')[0] || null,
    insights: pick('DISC_INSIGHTS_FIELD')[0] || null,
  };
}

function readIdeas_(sp) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(getConfig(sp).SHEET_IDEAS);
  if (!sh || sh.getLastRow() < 2) return { ideas: [], fieldNames: [] };
  const all = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const head = all[0].map(function(h) { return String(h); });
  const jc = head.indexOf(IDEA_JSON_HEADER);
  const fieldNames = head.slice(IDEA_HEADERS.length, jc < 0 ? head.length : jc).filter(function(h) { return h; });
  const ideas = all.slice(1).filter(function(r) { return r[0]; }).map(function(r) {
    let fields = {};
    try { fields = jc >= 0 && r[jc] ? JSON.parse(r[jc]) : {}; } catch (e) {}
    const lab = String(r[10] || '');
    return {
      key: r[0], summary: r[1], type: r[2], status: r[3], statusCat: r[4], creator: r[5], assignee: r[6],
      reporter: r[7], created: r[8], updated: r[9], labels: lab ? lab.split(', ') : [],
      delivery: { done: +r[11] || 0, prog: +r[12] || 0, todo: +r[13] || 0, items: String(r[14] || '') ? String(r[14]).split(', ') : [] },
      id: String(r[15] || ''), fields: fields,
    };
  });
  return { ideas: ideas, fieldNames: fieldNames };
}

function lastSyncOf_(sp) {
  try {
    const log = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(getConfig(sp).SHEET_LOG);
    if (log && log.getLastRow() > 1) {
      const rows = log.getRange(2, 1, log.getLastRow() - 1, 3).getValues();
      for (let i = rows.length - 1; i >= 0; i--) { if (rows[i][2] === 'SUCCESS') return rows[i][0] || ''; }
    }
  } catch (e) {}
  return '';
}

// Dashboard JSON for a discovery space.
function getDiscoveryData(sp) {
  const r = readIdeas_(sp);
  const base = (getConfig().JIRA_BASE_URL || '');
  return {
    space: { key: sp.key, name: spaceDisplayName_(sp), kind: 'discovery', browseUrl: base ? base + '/browse/' : '' },
    kind: 'discovery', ideas: r.ideas, fieldNames: r.fieldNames, roles: ideaRoles_(sp, r.fieldNames),
    lastSync: lastSyncOf_(sp), sprints: [], tasks: [], subtasks: [], bugsTasks: [], backlogTasks: [], carriedOver: [], leaves: [],
    error: r.ideas.length ? undefined : 'No data',
  };
}


// ---------------------------------------------------------------
// SECTION 5: TRIGGERS + SYNC
// ---------------------------------------------------------------

// Serialise writers (cron + Sync Now + Snapshot can overlap).
var _lockHeld = false;
function withLock_(fn) {
  if (_lockHeld) return fn();                 // already inside a locked call
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another sync is running — try again in a minute.');
  _lockHeld = true;
  try { return fn(); }
  finally { _lockHeld = false; lock.releaseLock(); }
}

function syncSpace(sp, mode) {
  if (typeof sp === 'string') sp = getSpace(sp);
  return withLock_(function() { return syncSpace_(sp, mode || 'full'); });
}

function syncSpace_(sp, mode) {
  const started = new Date();
  try {
    Logger.log('[' + sp.key + '] ' + mode + ' sync start: ' + started);
    const props = PropertiesService.getScriptProperties();
    const lastIso = props.getProperty('LAST_SYNC_' + sp.key);
    if (mode === 'incremental' && !lastIso) mode = 'full';

    if (mode === 'incremental') {
      const since = (started - new Date(lastIso)) / 60000 + 15;   // 15-min overlap
      const res = fetchJiraData(sp, { mode: 'incremental', sinceMinutes: since });
      const frozen = getSnapshottedSprintIds(sp);
      writeToSheet(sp, res.tasks, frozen);
      cleanupMovedFromSprint(sp, res.tasks, frozen);
      removeExcludedRows_(sp, res.excludedIds, frozen);
      autoAddAssigneesToCapacity(res.tasks);
      if (sp.kind === 'software') syncBurndowns_(sp, res.registry, frozen, true, res.assignees);
      if (sp.kind === 'discovery') syncIdeas_(sp);
      props.setProperty('LAST_SYNC_' + sp.key, started.toISOString());
      logSync(sp, res.tasks.length, 'SUCCESS', 'Incremental sync');
      return res.tasks.length;
    }

    const res = fetchJiraData(sp, { mode: 'full' });
    const tasks = res.tasks;
    const already = getSnapshottedSprintIds(sp);
    // 1. Upsert (already-frozen sprints skipped inside).
    writeToSheet(sp, tasks, already);
    // 2. Self-healing cleanup.
    cleanupMovedFromSprint(sp, tasks, already);
    cleanupDeletedTasks(sp, tasks, already);
    cleanDuplicateRows(sp);
    // 3. Freeze every sprint Jira has closed, from the rows just written.
    const frozenIds = snapshotEligibleSprints(sp, tasks, res.registry);
    cleanupFrozenLiveRows(sp, frozenIds);
    // 3b. Jira's own burndown data for every started sprint (frozen ones keep theirs).
    if (sp.kind === 'software') syncBurndowns_(sp, res.registry, frozenIds, false, res.assignees);
    // 4. New assignees → Team Capacity (6 hrs default).
    autoAddAssigneesToCapacity(tasks);

    props.setProperty('LAST_SYNC_' + sp.key, started.toISOString());
    props.setProperty('LAST_FULL_SYNC_' + sp.key, started.toISOString());
    refreshJiraProjectName_(sp);
    if (sp.kind === 'discovery') syncIdeas_(sp);
    logSync(sp, tasks.length, 'SUCCESS', 'Full sync');
    Logger.log('[' + sp.key + '] Sync complete. Rows: ' + tasks.length);
    return tasks.length;
  } catch (err) {
    logSync(sp, 0, 'ERROR: ' + err.message, mode);
    Logger.log('[' + sp.key + '] Error: ' + err.message);
    throw err;
  }
}

// Scheduled entry point — every space, full sync. If the 6-minute limit gets
// close, the remaining spaces continue in a follow-up run a minute later.
function syncAllSpaces(keys) {
  const queue = (keys && keys.length) ? keys.slice() : getSpaceOrder_().slice();
  const t0 = Date.now();
  withLock_(function() {
    while (queue.length) {
      if (Date.now() - t0 > 4.5 * 60 * 1000) break;
      const key = queue.shift();
      try { syncSpace_(getSpace(key), 'full'); }
      catch (e) { Logger.log('Space ' + key + ' failed: ' + e.message); }
    }
  });
  if (queue.length) scheduleContinuation_(queue);
}

function syncAllSpacesIncremental() {
  withLock_(function() {
    getSpaceOrder_().forEach(function(key) {
      try { syncSpace_(getSpace(key), 'incremental'); }
      catch (e) { Logger.log('Space ' + key + ' incremental failed: ' + e.message); }
    });
  });
}

function scheduleContinuation_(queue) {
  PropertiesService.getScriptProperties().setProperty('SYNC_QUEUE', queue.join(','));
  ScriptApp.newTrigger('continueSyncAllSpaces').timeBased().after(60 * 1000).create();
  Logger.log('Time budget reached — continuing with ' + queue.join(', ') + ' in 1 minute.');
}

function continueSyncAllSpaces() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'continueSyncAllSpaces') ScriptApp.deleteTrigger(t);
  });
  const props = PropertiesService.getScriptProperties();
  const q = (props.getProperty('SYNC_QUEUE') || '').split(',').filter(function(s) { return s; });
  props.deleteProperty('SYNC_QUEUE');
  if (q.length) syncAllSpaces(q);
}

// ── Auto-add new assignees to Team Capacity (6 hrs default) ──
function autoAddAssigneesToCapacity(tasks) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let cap = ss.getSheetByName(SHEET_CAPACITY);
    if (!cap) { setupTeamCapacity(); cap = ss.getSheetByName(SHEET_CAPACITY); }
    const existing = {};
    if (cap.getLastRow() > 1) {
      cap.getRange(2, 1, cap.getLastRow() - 1, 4).getValues().forEach(function(r) {
        const n = (r[0] || '').toString().trim();
        if (n) existing[n.toLowerCase()] = true;
      });
    }
    const newMembers = {};
    tasks.forEach(function(t) {
      const asn = (t.assignee || '').toString().trim();
      if (t.taskLevel === 'Epic' || !asn || asn === 'Unassigned' || existing[asn.toLowerCase()] || newMembers[asn]) return;
      newMembers[asn] = { name: asn, team: (t.teamCategory || '').toString().trim() };
    });
    const rows = Object.values(newMembers).map(function(m) { return [m.name, '', 6, m.team]; });
    if (rows.length) {
      cap.getRange(cap.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
      Logger.log('Auto-added to Team Capacity: ' + rows.length + ' new member(s)');
    }
  } catch (e) { Logger.log('autoAddAssignees error: ' + e.message); }
}

function populateCapacityFromSheet() {
  getSpaceOrder_().forEach(function(k) {
    const rows = readRows_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(getConfig(getSpace(k)).SHEET_RAW));
    autoAddAssigneesToCapacity(rows.map(function(r) { return { assignee: r[IX.ASSIGNEE] || '', teamCategory: r[IX.TEAM] || '', taskLevel: r[IX.LEVEL] }; }));
  });
}

const SYNC_HANDLERS = ['syncAllSpaces', 'syncAllSpacesIncremental', 'continueSyncAllSpaces'];

function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'syncAllSpaces') ScriptApp.deleteTrigger(t);
  });
  // 8:00 AM PKT (03:00 UTC) and 6:00 PM PKT (13:00 UTC) — same as before; the
  // dashboard's "Next auto-sync" text assumes these two times.
  ScriptApp.newTrigger('syncAllSpaces').timeBased().everyDays(1).atHour(3).nearMinute(0).inTimezone('Etc/UTC').create();
  ScriptApp.newTrigger('syncAllSpaces').timeBased().everyDays(1).atHour(13).nearMinute(0).inTimezone('Etc/UTC').create();
  Logger.log('Triggers set: 8am PKT and 6pm PKT (full sync, all spaces).');
  checkTriggers();
}

// "Changed since last sync" pull of every space every 30 minutes, between the
// two full syncs (which still handle deletions + closed-sprint snapshots).
// Reads only issues updated since the last sync (JQL updated >= -Nm, 15-min
// overlap — see syncSpace_). Removes any old incremental trigger first, so
// running it twice never creates duplicates.
function setupIncrementalTrigger() {
  removeIncrementalTrigger();
  ScriptApp.newTrigger('syncAllSpacesIncremental').timeBased().everyMinutes(30).create();
  Logger.log('Incremental sync enabled: every 30 min (all spaces).');
  checkTriggers();
}
function removeIncrementalTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'syncAllSpacesIncremental') ScriptApp.deleteTrigger(t);
  });
}

function checkTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  Logger.log('Active triggers: ' + triggers.length);
  triggers.forEach(function(t) { Logger.log('  → ' + t.getHandlerFunction() + ' | ' + t.getTriggerSource()); });
}

function logSync(sp, count, status, note) {
  const name = getConfig(sp).SHEET_LOG;
  const log = createSheetWithHeader_(name, ['Timestamp', 'Tasks Synced', 'Status', 'Note'], '#1a1a2e');
  log.appendRow([Utilities.formatDate(new Date(), 'Asia/Karachi', 'dd MMM yyyy HH:mm'), count, status, note || '']);
}

// ONE-TIME after upgrading Code.gs: rebuild every space's Sprint Data +
// Sprint Snapshots from Jira in the current format. Closed sprints are
// re-read from Jira (it keeps them), so history is not lost. Goals, retros,
// leave, users and Team Capacity are untouched; Impact Scores are carried over.
function rebuildAllSpacesFromJira() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  withLock_(function() {
    getSpaceOrder_().forEach(function(k) {
      const sp = getSpace(k), cfg = getConfig(sp);
      const impact = {};
      [cfg.SHEET_RAW, cfg.SHEET_SNAP].forEach(function(name) {
        const sh = ss.getSheetByName(name);
        if (!sh || sh.getLastRow() < 2) return;
        sh.getRange(2, 1, sh.getLastRow() - 1, Math.min(sh.getMaxColumns(), IMPACT_COL)).getValues().forEach(function(r) {
          if (r[IX.IMPACT]) impact[r[IX.KEY] + '|' + r[IX.SPRINT]] = r[IX.IMPACT];
        });
        sh.getRange(2, 1, sh.getLastRow() - 1, sh.getMaxColumns()).clearContent();
      });
      ensureDataSheet_(sp); ensureSnapshotSheet(sp);
      syncSpace_(sp, 'full');
      // put Impact Scores back
      [cfg.SHEET_RAW, cfg.SHEET_SNAP].forEach(function(name) {
        const sh = ss.getSheetByName(name);
        if (!sh || sh.getLastRow() < 2 || !Object.keys(impact).length) return;
        const rng = sh.getRange(2, 1, sh.getLastRow() - 1, IMPACT_COL);
        const vals = rng.getValues();
        let n = 0;
        vals.forEach(function(r) { const v = impact[r[IX.KEY] + '|' + r[IX.SPRINT]]; if (v) { r[IX.IMPACT] = v; n++; } });
        if (n) rng.setValues(vals);
      });
      Logger.log('[' + k + '] rebuilt from Jira.');
    });
  });
}

// Runnable from the editor.
function manualSync() { syncAllSpaces(); }
function syncMMS()     { syncSpace('MMS', 'full'); }
function syncMSSD()    { syncSpace('MSSD', 'full'); }
function syncMSSDISC() { syncSpace('MSSDISC', 'full'); }
function syncMDP()     { syncSpace('MDP', 'full'); }


// ---------------------------------------------------------------
// SECTION 5.5: WORKBOOK SETUP
// ---------------------------------------------------------------

// Creates every tab (idempotent — safe to re-run).
function setupWorkbook() {
  SpreadsheetApp.getActiveSpreadsheet().setSpreadsheetTimeZone('Asia/Karachi');
  setupAllowedUsers();
  setupTeamCapacity();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(SHEET_SETTINGS)) {
    const sh = createSheetWithHeader_(SHEET_SETTINGS, ['Setting', 'Value', 'Space', 'Notes'], '#1a1a2e');
    sh.getRange(2, 1, DEFAULT_SETTINGS.length, 4).setValues(DEFAULT_SETTINGS);
    sh.setColumnWidth(1, 180); sh.setColumnWidth(2, 360); sh.setColumnWidth(4, 420);
  }
  getSpaceOrder_().forEach(function(k) {
    const sp = getSpace(k), cfg = getConfig(sp);
    ensureDataSheet_(sp);
    ensureSnapshotSheet(sp);
    createSheetWithHeader_(cfg.SHEET_SPRINTS, ['Sprint ID', 'Jira Sprint ID', 'State', 'Start', 'End', 'Completed', 'Goal', 'Board'], '#1a1a2e');
    createSheetWithHeader_(cfg.SHEET_LOG, ['Timestamp', 'Tasks Synced', 'Status', 'Note'], '#1a1a2e');
    createSheetWithHeader_(cfg.SHEET_GOALS, ['Sprint ID', 'Updated At', 'Goal Text'], '#1a1a2e');
    createSheetWithHeader_(cfg.SHEET_GOALS_LOG, ['Sprint ID', 'Saved At', 'Goal Text'], '#1a1a2e');
    createSheetWithHeader_(cfg.SHEET_RETRO, ['Sprint ID', 'Updated At', 'Retro Data (JSON)'], '#1a1a2e');
    createSheetWithHeader_(cfg.SHEET_RETRO_LOG, ['Sprint ID', 'Saved At', 'Retro Data (JSON)'], '#1a1a2e');
    const leave = createSheetWithHeader_(cfg.SHEET_LEAVE, ['Leave ID', 'Sprint ID', 'Full Name', 'Team', 'Leave Date', 'Task Count', 'Hours', 'Note', 'Sprint'], '#1a1a2e');
    leave.getRange(2, 5, leave.getMaxRows() - 1, 1).setNumberFormat('@');
    if (sp.kind === 'discovery') { ensureDiscoveryCycles_(sp); createSheetWithHeader_(cfg.SHEET_IDEAS, IDEA_HEADERS, '#1a1a2e'); }
  });
  if (!ss.getSheetByName(SHEET_DEBUG)) ss.insertSheet(SHEET_DEBUG);
  const blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);
  Logger.log('Workbook ready: shared tabs + ' + getSpaceOrder_().length + ' spaces.');
}


// ---------------------------------------------------------------
// SECTION 6: DEBUG
// ---------------------------------------------------------------

function debugJiraConnection() {
  const me = jiraRequest_('get', '/rest/api/3/myself');
  Logger.log('Authenticated as: ' + me.displayName + ' <' + (me.emailAddress || 'hidden') + '> tz=' + me.timeZone);
  getSpaceOrder_().forEach(function(k) {
    const sp = getSpace(k);
    try {
      const p = jiraRequest_('get', '/rest/api/3/project/' + sp.key);
      Logger.log('Space ' + sp.key + ': "' + p.name + '" type=' + p.projectTypeKey + ' style=' + (p.style || '?'));
      if (sp.boardId) {
        const b = jiraRequest_('get', '/rest/agile/1.0/board/' + sp.boardId);
        Logger.log('   board ' + sp.boardId + ': "' + b.name + '" (' + b.type + ')');
      }
    } catch (e) { Logger.log('Space ' + sp.key + ' ERROR: ' + e.message); }
  });
  const fm = getFieldMap_();
  Logger.log('Sprint field: ' + fm.sprint + ' | Team Category field: ' + fm.teamCategory + ' | Atlassian Team field: ' + fm.atlTeam);
}

// Dump the first few rows a sync would produce for one space (no writes).
function debugSpace() {
  const SPACE = 'MMS';   // ← change as needed
  const sp = getSpace(SPACE);
  const res = fetchJiraData(sp, { mode: 'full' });
  Logger.log('Registry: ' + res.registry.list.map(function(s) { return s.sprintId + ' [' + s.state + '] ' + s.start + ' → ' + s.end; }).join(' | '));
  res.tasks.slice(0, 10).forEach(function(t) { Logger.log(JSON.stringify(t)); });
}

// Writes a health report to the "_Debug Report" tab.
function writeDebugReport() {
  const lines = [];
  const L = function(s) { lines.push([s == null ? '' : s]); };
  const t0 = Date.now();
  const props = PropertiesService.getScriptProperties();
  const cfg = getConfig();
  L('════ 0. CONFIG & SYNC HEALTH ════════════════════════════════════════');
  L('Run at        : ' + Utilities.formatDate(new Date(), 'Asia/Karachi', 'dd MMM yyyy HH:mm:ss') + ' (Asia/Karachi)');
  L('JIRA_BASE_URL : ' + (cfg.JIRA_BASE_URL || 'NOT SET'));
  L('JIRA_EMAIL    : ' + (cfg.JIRA_EMAIL ? 'set' : 'NOT SET'));
  L('JIRA_API_TOKEN: ' + (cfg.JIRA_API_TOKEN ? 'set (' + cfg.JIRA_API_TOKEN.length + ' chars)' : 'NOT SET'));
  try { const me = jiraRequest_('get', '/rest/api/3/myself'); L('Auth          : OK as ' + me.displayName); }
  catch (e) { L('Auth          : FAILED — ' + e.message); }
  const trig = ScriptApp.getProjectTriggers().filter(function(t) { return SYNC_HANDLERS.indexOf(t.getHandlerFunction()) !== -1; });
  L('Triggers      : ' + trig.length + ' (' + trig.map(function(t) { return t.getHandlerFunction(); }).join(', ') + ')');
  if (!trig.length) L('   *** NO TRIGGER — sync only runs when someone presses Run / Sync Now. ***');
  try {
    const fm = getFieldMap_();
    L('Sprint field  : ' + (fm.sprint || 'NOT FOUND'));
    L('Team field    : ' + (resolveFieldId_(fm, getSetting(null, 'TEAM_FIELD')) || fm.teamCategory || fm.atlTeam || 'none — using component / [PREFIX] / Team Capacity'));
  } catch (e) { L('Field map     : ' + e.message); }

  getSpaceOrder_().forEach(function(k) {
    const sp = getSpace(k), c = getConfig(sp);
    L('');
    L('════ SPACE ' + sp.key + ' — ' + sp.name + ' (' + sp.kind + (sp.boardId ? ', board ' + sp.boardId : '') + ') ════');
    L('Last sync     : ' + (props.getProperty('LAST_SYNC_' + sp.key) || 'never') +
      ' | last full: ' + (props.getProperty('LAST_FULL_SYNC_' + sp.key) || 'never'));
    const live = readRows_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(c.SHEET_RAW));
    const snapIds = Object.keys(getSnapshottedSprintIds(sp));
    L('Live rows     : ' + live.length + ' | Frozen sprints: ' + (snapIds.join(', ') || 'none'));
    const exempt = Object.keys(getFreezeExempt(sp));
    if (exempt.length) L('Keep-live     : ' + exempt.join(', '));
    const bySec = {}, noTeam = { n: 0 }, noEst = { n: 0 };
    live.forEach(function(r) {
      bySec[r[IX.SECTION]] = (bySec[r[IX.SECTION]] || 0) + 1;
      if (!r[IX.TEAM]) noTeam.n++;
      if (!(parseFloat(r[IX.EST]) > 0)) noEst.n++;
    });
    L('By section    : ' + Object.keys(bySec).map(function(s) { return s + '=' + bySec[s]; }).join(', '));
    L('No team       : ' + noTeam.n + ' row(s)  | No estimate: ' + noEst.n + ' row(s)' +
      (sp.kind === 'discovery' ? '  (discovery spaces have no time tracking — expected)' : ''));
    const reg = readSprintRegistry_(sp);
    Object.keys(reg).slice(-8).forEach(function(id) {
      L('   ' + id + ' [' + reg[id].state + '] ' + reg[id].start + ' → ' + reg[id].end + (snapIds.indexOf(id) !== -1 ? '  *FROZEN*' : ''));
    });
  });

  L('');
  L('════ DONE in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's ════');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_DEBUG) || ss.insertSheet(SHEET_DEBUG);
  sh.clearContents();
  sh.getRange(1, 1, lines.length, 1).setValues(lines);
  sh.setColumnWidth(1, 900);
  Logger.log(lines.map(function(l) { return l[0]; }).join('\n'));
}

// One-click re-snapshot from the editor.
function resnapshotNow() {
  const SPACE = 'MMS', SPRINT = 'MMS Sprint 1';   // ← change as needed
  Logger.log(JSON.stringify(manualSnapshotSprint(getSpace(SPACE), SPRINT)));
}