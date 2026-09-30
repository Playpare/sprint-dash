/* Playspare Sprint Dashboard — core
   Shared by every space: API + space switching, space-folder loader, helpers,
   page switching, shared pop-ups (detail modal, member modal), theme, sidebar,
   sync bar, loader, login and PDF export. Page state (filters, open tabs,
   timers) also lives here so reloading a space's script never resets it. */
// API = Apps Script web-app URL — set in index.html (next to DASH_VERSION).

// ── Jira spaces ──
// Every request carries &space=KEY (see tok()). The sidebar "Spaces" group
// switches it; the choice is remembered per browser.
var SPACE_KEYS=['MMS','MSSD','MSSDISC','MDP'];
window._space = (function(){
  try { var s=localStorage.getItem('dashSpace'); if(SPACE_KEYS.indexOf(s)!==-1) return s; } catch(e){}
  return SPACE_KEYS[0];
})();
function spaceName(){
  var el=document.querySelector('.sb-item[data-space="'+window._space+'"]');
  return el ? el.getAttribute('data-label') : window._space;
}
// Sidebar names come from Jira (backend listSpaces) so they always match the
// project names there; the names written in the HTML are only the fallback.
function loadSpaceNames(){
  fetch(API+'?action=listSpaces&email='+encodeURIComponent(window._userEmail||'')+tok(),{redirect:'follow'})
    .then(function(r){return r.json();})
    .then(function(j){
      (j&&j.spaces||[]).forEach(function(s){
        var el=document.querySelector('.sb-item[data-space="'+s.key+'"]'); if(!el||!s.name) return;
        el.setAttribute('data-label',s.name); el.setAttribute('title',s.name+' ('+s.key+')');
        var lb=el.querySelector('.sb-label'); if(lb) lb.textContent=s.name;
      });
    }).catch(function(){});
}
function markActiveSpace(){
  document.querySelectorAll('.sb-item[data-space]').forEach(function(el){
    el.classList.toggle('on', el.getAttribute('data-space') === window._space);
  });
}
function selectSpace(key){
  if(SPACE_KEYS.indexOf(key)===-1) return;
  var changed = key !== window._space;
  window._space = key;
  try { localStorage.setItem('dashSpace', key); } catch(e){}
  currentPage='overview';
  markActiveSpace();
  document.querySelectorAll('.sb-item[data-page]').forEach(function(el){ el.classList.remove('on'); });
  document.querySelectorAll('.nv-tab').forEach(function(el){ el.classList.toggle('on',el.dataset.page==='overview'); });
  if(window.innerWidth <= 860) document.getElementById('sidebar').classList.remove('open');
  if(!changed){ switchPage('overview'); return; }
  // Sprint ids differ per space — drop the current selection and reload.
  cur=null; curTeam='All'; raw=null; window._sprintData=null;
  // Clear what belonged to the previous space, so a space with no sprints
  // doesn't keep showing the old sprint list / alerts.
  var sel=document.getElementById('spSel'); if(sel) sel.innerHTML='';
  var ac=document.getElementById('sbAlertsCount'); if(ac) ac.textContent='0';
  var as=document.getElementById('sbAlertsSub'); if(as) as.textContent='No sprint selected';
  var al=document.getElementById('sbAlertsList'); if(al) al.innerHTML='';
  init();
}

// ── Space folders ──
// Each space has its own folder (spaces/<name>/) with space.json, space.html,
// space.css and space.js. The selected space's files are loaded before its
// data is rendered (see init()); reports/ and admin/ are shared by every space.
var SPACE_FOLDERS={
  MMS:'spaces/My Mall Simulator',
  MSSD:'spaces/My Supermarket Simulator- Delivery',
  MSSDISC:'spaces/MSS - Discovery',
  MDP:'spaces/My discovery project'
};
var DASH_PARTS={space:{},spaceKey:null,reports:{},admin:{},live:{}};
function partUrl(folder,file){ return folder.split('/').map(encodeURIComponent).join('/')+'/'+encodeURIComponent(file); }
function fetchText(url){
  return fetch(url,{cache:'no-cache'}).then(function(r){
    if(!r.ok) throw new Error('Could not load '+decodeURIComponent(url)+' ('+r.status+')');
    return r.text();
  });
}
// Page files are written one element per line for reading; line breaks and
// indentation between tags are removed so the markup matches the original.
function cleanPart(html){ return String(html||'').replace(/<!--[\s\S]*?-->/g,'').replace(/\r?\n\s*/g,''); }
function splitPages(html){
  var t=document.createElement('template'); t.innerHTML=cleanPart(html);
  var m={};
  Array.prototype.forEach.call(t.content.children,function(el){ if(el.id) m[el.id.replace(/^page-/,'')]=el.outerHTML; });
  return m;
}
var _sharedPartsPromise=null;
function loadSharedParts(){
  if(!_sharedPartsPromise){
    _sharedPartsPromise=Promise.all([fetchText('reports/reports.html'),fetchText('admin/admin.html'),fetchText('live-view/live-view.html')])
      .then(function(r){ DASH_PARTS.reports=splitPages(r[0]); DASH_PARTS.admin=splitPages(r[1]); DASH_PARTS.live=splitPages(r[2]); })
      .catch(function(e){ _sharedPartsPromise=null; throw e; });
  }
  return _sharedPartsPromise;
}
function loadSpaceStyle(href){
  return new Promise(function(resolve,reject){
    var link=document.createElement('link');
    link.rel='stylesheet'; link.href=href+'?v='+encodeURIComponent(window.DASH_VERSION||'');   // version → no stale cached copy
    link.onload=function(){ resolve(link); };
    link.onerror=function(){ link.remove(); reject(new Error('Could not load '+decodeURIComponent(href))); };
    // Space CSS sits between core.css and reports.css / admin.css.
    var coreCss=document.getElementById('coreCss');
    coreCss.parentNode.insertBefore(link,coreCss.nextSibling);
  });
}
function loadSpaceScript(src){
  return new Promise(function(resolve,reject){
    var s=document.createElement('script');
    s.src=src+'?v='+encodeURIComponent(window.DASH_VERSION||'');                        // version → no stale cached copy
    s.onload=function(){ s.remove(); resolve(); };
    s.onerror=function(){ s.remove(); reject(new Error('Could not load '+decodeURIComponent(src))); };
    document.body.appendChild(s);
  });
}
function loadSpaceAssets(key){
  if(DASH_PARTS.spaceKey===key) return loadSharedParts();
  var folder=SPACE_FOLDERS[key];
  if(!folder) return Promise.reject(new Error('No folder set for space '+key));
  return Promise.all([loadSharedParts(), fetchText(partUrl(folder,'space.json')).then(JSON.parse)])
    .then(function(r){
      var cfg=r[1];
      return Promise.all([fetchText(partUrl(folder,cfg.html)), loadSpaceStyle(partUrl(folder,cfg.css))])
        .then(function(x){ return loadSpaceScript(partUrl(folder,cfg.js)).then(function(){ return {html:x[0],css:x[1]}; }); });
    })
    .then(function(p){
      // The user may have picked another space while this one was loading.
      if(key!==window._space){ p.css.remove(); return; }
      var old=document.getElementById('spaceCss');
      if(old && old!==p.css) old.remove();
      p.css.id='spaceCss';
      DASH_PARTS.space=splitPages(p.html); DASH_PARTS.spaceKey=key;
    });
}
// Markup of the given pages ('space' | 'reports' | 'admin'), in the order asked.
function pagesHtml(part,ids){ return ids.map(function(id){ return (DASH_PARTS[part]||{})[id]||''; }).join(''); }
var CH={},isDark=true,raw=null,cur=null,curTeam='All',curIndvTeam='All';
var _spaceLoadSeq=0;
var TC=['#5b6ef5','#18c97a','#9b72f5','#f5a623','#f05252','#22c4c4','#0aaa62'];
var TEAM_COLORS={};

function tc(team){
  if(!team)return TC[4];
  if(!TEAM_COLORS[team])TEAM_COLORS[team]=TC[Object.keys(TEAM_COLORS).length%TC.length];
  return TEAM_COLORS[team];
}
function cc(){return{text:isDark?'#c2c8df':'#50567a',grid:isDark?'rgba(150,160,220,.08)':'rgba(0,0,0,.06)'}}
function pc(a,b){return b?Math.round(a/b*100):0;}
function rnd(v){return Math.round(v*10)/10;}
// Work-item key order: project, then number (MMS-9 before MMS-10)
function keyOrder(a,b){
  var ma=String(a||'').match(/^(.*)-(\d+)$/), mb=String(b||'').match(/^(.*)-(\d+)$/);
  if(ma&&mb&&ma[1]===mb[1]) return (+ma[2])-(+mb[2]);
  return String(a||'')<String(b||'')?-1:String(a||'')>String(b||'')?1:0;
}
function fmtHours(v){
  var n = Number(v);
  if(!isFinite(n)) return '0.00 hrs';
  return (Math.round(n*100)/100).toFixed(2) + ' hrs';
}
function pd(str){
  if(!str)return null;
  var s=str.toString().replace(/(\d+)(st|nd|rd|th)/i,'$1');
  var d=new Date(s);
  return isNaN(d.getTime())?null:d;
}
function trunc(s,n){return s&&s.length>n?s.slice(0,n)+'…':s||'';}

// Working days in a sprint, using the same rule as dTot:
// start date is D0 (planning) and is NOT counted; D1..DN are the
// weekdays after it, up to and including the end date.
function sprintWorkingDayCount(start, end){
  if(!start||!end) return 0;
  var cur=new Date(start.getFullYear(),start.getMonth(),start.getDate());
  var last=new Date(end.getFullYear(),end.getMonth(),end.getDate());
  var count=0;
  cur.setDate(cur.getDate()+1);
  while(cur<=last){
    var w=cur.getDay();
    if(w!==0&&w!==6) count++;
    cur.setDate(cur.getDate()+1);
  }
  return count;
}

// Leave records stay separate from Asana time logs.
function normPersonName(name){
  return String(name||'').trim().toLowerCase().replace(/\s+/g,' ');
}
function leaveDateValue(record){
  return String(record && (record.date || record.leaveDate) || '');
}
function leaveDateFromISO(value){
  var m=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(+m[1], +m[2]-1, +m[3]) : null;
}
function leaveISODate(date){
  if(!date || isNaN(date.getTime())) return '';
  return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');
}
function isValidLeaveDate(value, sprintStart, sprintEnd){
  var date=leaveDateFromISO(value);
  if(!date || !sprintStart || !sprintEnd) return false;

  var start=new Date(sprintStart.getFullYear(),sprintStart.getMonth(),sprintStart.getDate());
  var end=new Date(sprintEnd.getFullYear(),sprintEnd.getMonth(),sprintEnd.getDate());
  var weekday=date.getDay();

  return date>start && date<=end && weekday!==0 && weekday!==6;
}
function leaveCountsNow(record, sprintStart, sprintEnd){
  var value = leaveDateValue(record);

  if(!isValidLeaveDate(value, sprintStart, sprintEnd))
    return false;

  var leaveDate = leaveDateFromISO(value);

  var today = new Date();
  today = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );

  // Credit only on or after the actual leave date.
  return leaveDate <= today;
}
Chart.defaults.font.family="'Segoe UI',system-ui,-apple-system,sans-serif";
Chart.defaults.font.size=13;
Chart.defaults.font.weight='600';
Chart.defaults.color='#c2c8df';
Chart.defaults.plugins.tooltip.backgroundColor='rgba(17,20,36,.92)';
Chart.defaults.plugins.tooltip.titleColor='#fff';
Chart.defaults.plugins.tooltip.bodyColor='#dde1f5';
Chart.defaults.plugins.tooltip.padding=12;

/* Live-style cursor hover shared by the MMS and MSSD burndown charts. */
function sprintBurnHoverPlugin(){
  return {id:'sprintBurnHover',afterDatasetsDraw:function(ch){
    var h=ch._sprintBurnHover; if(!h) return;
    var ctx=ch.ctx,a=ch.chartArea,x=ch.scales.x.getPixelForValue(h.t);
    ctx.save(); ctx.strokeStyle=isDark?'rgba(255,255,255,.35)':'rgba(0,0,0,.3)';
    ctx.lineWidth=1; ctx.setLineDash([3,3]); ctx.beginPath(); ctx.moveTo(x,a.top); ctx.lineTo(x,a.bottom); ctx.stroke(); ctx.setLineDash([]);
    h.rows.forEach(function(r){ if(r.v==null) return; ctx.beginPath(); ctx.arc(x,ch.scales.y.getPixelForValue(r.v),4.5,0,Math.PI*2); ctx.fillStyle=r.c; ctx.fill(); ctx.lineWidth=2; ctx.strokeStyle='#000'; ctx.stroke(); });
    ctx.restore();
  }};
}
function sprintBurnStepAt(pts,t,k){
  if(!pts.length||t<pts[0][0]||t>pts[pts.length-1][0]) return null;
  var lo=0,hi=pts.length-1;
  while(lo<hi){ var mid=(lo+hi+1)>>1; if(pts[mid][0]<=t) lo=mid; else hi=mid-1; }
  return pts[lo][k];
}
function bindSprintBurnHover(canvas,chartKey){
  if(!canvas||canvas._sprintBurnHoverBound) return;
  canvas._sprintBurnHoverBound=true;
  function hover(e){
    var tip=document.getElementById('sprintBurnTooltip'),ch=CH[chartKey];
    function hide(){ if(tip) tip.classList.remove('show'); if(ch&&ch._sprintBurnHover){ch._sprintBurnHover=null;ch.draw();} }
    if(!e||!ch||!ch._sprintBurnData) return hide();
    var rect=ch.canvas.getBoundingClientRect(),a=ch.chartArea,mx=e.clientX-rect.left,my=e.clientY-rect.top;
    if(mx<a.left-2||mx>a.right+2||my<a.top-2||my>a.bottom+2) return hide();
    var D=ch._sprintBurnData,t=Math.max(D.start,Math.min(D.end,ch.scales.x.getValueForPixel(mx))),u=D.unit;
    var rows=[
      {l:'Guideline',c:'#5b6ef5',v:Math.max(0,D.idealAt(t)),s:u},
      {l:'Remaining Values',c:'#f05252',v:sprintBurnStepAt(D.pts,t,1),s:u},
      {l:'Time Spent',c:'#18c97a',v:sprintBurnStepAt(D.pts,t,2),s:'h'}
    ];
    ch._sprintBurnHover={t:t,rows:rows}; ch.draw();
    if(!tip){tip=document.createElement('div');tip.id='sprintBurnTooltip';tip.className='nv-chart-tooltip sprint-burn-tip';document.body.appendChild(tip);}
    tip.innerHTML='<div class="sbt-title">'+new Date(t).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true})+'</div>'
      +rows.map(function(r){return '<div class="sbt-row"><span class="dot" style="background:'+r.c+'"></span>'+r.l+'<span class="value">'+(r.v==null?'—':rnd(r.v)+(r.s==='h'?'h':r.s.trim()))+'</span></div>';}).join('');
    tip.classList.add('show');
    var w=tip.offsetWidth,h=tip.offsetHeight,left=e.clientX+18;
    if(left+w>window.innerWidth-8) left=e.clientX-18-w;
    tip.style.left=left+'px'; tip.style.top=Math.max(h/2+8,Math.min(window.innerHeight-h/2-8,e.clientY))+'px';
  }
  canvas.addEventListener('mousemove',hover);
  canvas.addEventListener('mouseleave',function(){hover(null);});
}

// Shared access-key param appended to EVERY API request. The key itself is
// never committed — the user types it on the login screen and it lives only
// in this browser's localStorage. Without it the Apps Script returns
// "unauthorized", so a public repo / known URL alone can't read the data.
function tok(){ return '&token=' + encodeURIComponent(window._accessToken || '') + '&space=' + encodeURIComponent(window._space || ''); }

// Offset between the server clock and this device's clock. Some TVs have the
// wrong time/timezone set, which skewed the sprint countdowns by hours.
var _clockSkew = 0;
try { _clockSkew = +localStorage.getItem('clockSkew') || 0; } catch(e){}
function nowMs(){ return Date.now() + _clockSkew; }

// Google sometimes answers with an HTML error page (Sheet busy while a sync
// writes, Apps Script hiccup) or a JSON 'server' error. Those are retried a
// couple of times before the error screen is shown.
function fetchData(attempt){
  attempt = attempt || 0;
  var email = encodeURIComponent(window._userEmail || '');
  var sentAt = Date.now();
  return fetch(API+'?email='+email+tok(), {method:'GET',redirect:'follow',cache:'no-cache'})
    .then(function(r){return r.text();})
    .then(function(t){
      var parsed;
      try { parsed = JSON.parse(t.trim()); }
      catch(e){
        // Show what Google actually sent (page title / first words) so the cause can be seen.
        var title=(t.match(/<title>([^<]*)<\/title>/i)||[])[1]||'';
        var body=t.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,200);
        parsed = { error:'server', message:'Google returned a web page instead of data'+(title?' — "'+title+'"':'')+(body?' · '+body:'') };
        console.warn('[fetchData] non-JSON reply (attempt '+(attempt+1)+'):', t.slice(0,2000));
      }
      if(parsed.error === 'server'){
        if(attempt < 2) return new Promise(function(res){ setTimeout(res, 2000*(attempt+1)); }).then(function(){ return fetchData(attempt+1); });
        throw new Error(parsed.message || 'Server error');
      }
      if(typeof parsed.serverNow === 'number'){
        var recvAt = Date.now();
        _clockSkew = parsed.serverNow - (sentAt + recvAt) / 2;
        // Ignore sub-minute drift (network latency noise); only correct real clock errors
        if(Math.abs(_clockSkew) < 6e4) _clockSkew = 0;
        try { localStorage.setItem('clockSkew', String(_clockSkew)); } catch(e){}
      }
      if(parsed.error === 'unauthorized'){
        // Session expired or access revoked
        localStorage.removeItem('dashUser');
        clearDashCache();
        showLoginScreen();
        throw new Error(parsed.message || 'Access denied');
      }
      return parsed;
    });
}

/* ── RENDER ── */
var currentPage = 'overview';
var PAGES = {
  overview   : { title: 'Overview',       sub: 'Sprint performance at a glance' },
  goals      : { title: 'Sprint Goals',   sub: 'Define and track sprint goals' },
  burndown   : { title: 'Burndown',       sub: 'Sprint progress over time' },
  team       : { title: 'Team',           sub: 'Time distribution and individual performance' },
  bugs       : { title: 'Bugs & Polish',  sub: 'Bug tracking across sprints' },
  spillovers : { title: 'Spillovers',     sub: 'Carried over tasks and backlog items' },
  retro      : { title: 'Retrospective',  sub: 'Sprint reflections and learnings' },
  performance: { title: 'Performance',    sub: 'Individual scorecards and rankings' },
  users      : { title: 'Users',          sub: 'Manage dashboard access and team capacity' },
  leave      : { title: 'Leave',          sub: 'Credit approved leave without creating missing hours' },
  settings   : { title: 'Settings',       sub: 'Theme and preferences' },
  ideas      : { title: 'Ideas list',     sub: 'Every idea with its Jira fields' },
  live       : { title: 'MMS Live View',  sub: 'Sprint burndown and status, live' },
};

// Outliner mode — these sections render together on one long scroll.
// Sidebar items become smooth-scroll anchors instead of page switchers.
// Charts inside each section are lazy-rendered via IntersectionObserver
// (chart only initializes when its section approaches the viewport).
// Users + Settings stay single-page (admin-only, alag mental context).
// Empty = pure tab-switching mode (demo design): one page visible at a time,
// driven by the top tab-row + rail. (Outliner long-scroll mode disabled.)
var OUTLINER_PAGES = [];
function isOutlinerPage(page){ return OUTLINER_PAGES.indexOf(page) !== -1; }

// Tracks which outliner sections have been rendered in the current data cycle.
// Cleared on every render(d) call (data refresh) so stale data doesn't linger.
var _renderedPages = {};
var _outlinerObserver = null;

// Render an outliner section once per data cycle. Subsequent calls are no-ops
// — keeps Chart.js destroy/recreate from firing on every scroll-into-view.
function lazyRenderPage(pageId, d){
  if(!d) d = window._sprintData;
  if(!d) return;
  if(_renderedPages[pageId]) return;
  _renderedPages[pageId] = true;
  var el = document.getElementById('page-' + pageId);
  if(el) el.classList.remove('lazy-pending');
  renderPage(pageId, d);
  // Section just grew from a placeholder to real content — refresh the
  // scroll-progress max so the bar stays accurate as the doc gets longer.
  if(typeof updateScrollProgress === 'function') updateScrollProgress();
}

// Set up IntersectionObserver so each outliner section auto-renders when it
// approaches the viewport. rootMargin:'400px' starts rendering before the user
// actually sees it, so charts are ready by the time they scroll into view.
function setupLazyRender(d){
  if(_outlinerObserver){ try { _outlinerObserver.disconnect(); } catch(e){} _outlinerObserver = null; }
  var pc = document.getElementById('mc');
  if(!pc) return;

  // Mark all outliner sections as pending (shimmer placeholder shows up).
  // Sections already rendered in this cycle keep their content.
  OUTLINER_PAGES.forEach(function(p){
    var el = document.getElementById('page-' + p);
    if(el && !_renderedPages[p]) el.classList.add('lazy-pending');
  });

  if(!('IntersectionObserver' in window)){
    // Fallback for old browsers — render everything upfront
    OUTLINER_PAGES.forEach(function(p){ lazyRenderPage(p, d); });
    return;
  }
  _outlinerObserver = new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      if(!entry.isIntersecting) return;
      var id = entry.target.id.replace('page-','');
      if(isOutlinerPage(id)) lazyRenderPage(id, d);
    });
  }, { root: pc, rootMargin: '400px 0px 400px 0px', threshold: 0.01 });

  OUTLINER_PAGES.forEach(function(p){
    var el = document.getElementById('page-' + p);
    if(el) _outlinerObserver.observe(el);
  });
}

function switchPage(page){
  if(!PAGES[page]) page = 'overview';
  currentPage = page;
  // Live View hides the top bar (except Sync Now) and the tab row.
  document.getElementById('root').classList.toggle('live-mode', page === 'live');
  lvToggleSidebar(false);
  // Reset breakdown box if leaving team page
  var bd = document.getElementById('bdBox');
  if(bd) bd.style.display = 'none';
  // Update active nav (page items only — space items keep their own state)
  var workspacePage = page==='overview' || page==='team' || page==='retro';
  document.querySelectorAll('.sb-item[data-space]').forEach(function(el){
    el.classList.toggle('on', workspacePage && el.getAttribute('data-space')===window._space);
  });
  document.querySelectorAll('.sb-item[data-page]').forEach(function(el){
    el.classList.toggle('on', el.dataset.page === page);
  });
  // Reflect active state on the top tab-row (Overview / Team / Retrospective)
  document.querySelectorAll('.nv-tab').forEach(function(el){
    el.classList.toggle('on', el.dataset.page === page);
  });
  positionSidebarIndicator();
  // Update title (discovery spaces use their own page names)
  var PG = (isDisc() && DISC_PAGES[page]) || PAGES[page];
  document.getElementById('pageTitle').textContent = PG.title;
  document.getElementById('pageSub').textContent = PG.sub;

  var pc = document.getElementById('mc');
  var inOutliner    = isOutlinerPage(page);
  var wasInOutliner = pc.classList.contains('outliner-mode');

  if(inOutliner){
    pc.classList.add('outliner-mode');
    document.querySelectorAll('.page').forEach(function(el){
      var id = el.id.replace('page-','');
      el.classList.toggle('active', isOutlinerPage(id));
    });
  } else {
    pc.classList.remove('outliner-mode');
    document.querySelectorAll('.page').forEach(function(el){
      el.classList.toggle('active', el.id === 'page-' + page);
    });
    pc.scrollTop = 0;
  }

  // Close sidebar on mobile
  if(window.innerWidth <= 860){
    document.getElementById('sidebar').classList.remove('open');
  }

  // Helper: smooth-scroll to the clicked section (used after any render is done).
  // Uses scrollIntoView which auto-finds the scrolling ancestor — simpler and
  // more reliable than offsetTop math.
  function scrollToClicked(){
    var target = document.getElementById('page-' + page);
    if(!target) return;
    target.scrollIntoView({ behavior:'smooth', block:'start' });
  }

  if(isDisc()){
    var dd = window._discData;
    requestAnimationFrame(function(){ renderDiscPage(page, dd); });
    return;
  }
  if(inOutliner){
    if(wasInOutliner){
      // Already in outliner mode — make sure the target is rendered before
      // scrolling to it (otherwise scrollIntoView lands at the wrong height
      // because the placeholder min-height is shorter than the real content).
      lazyRenderPage(page);
      requestAnimationFrame(scrollToClicked);
    } else if(raw && window._sprintData){
      // Just entered outliner mode (from a single-page section). Set up the
      // observer, render the clicked section immediately so scroll lands true,
      // and let the observer fill in the rest as the user scrolls.
      requestAnimationFrame(function(){
        setupLazyRender(window._sprintData);
        lazyRenderPage(page, window._sprintData);
        requestAnimationFrame(scrollToClicked);
      });
    }
  } else if(raw && window._sprintData){
    requestAnimationFrame(function(){ renderPage(page, window._sprintData); });
  }
}

// Scroll-spy for outliner mode using IntersectionObserver — far more accurate
// than scrollTop math because it doesn't depend on offsetTop staying stable
// while lazy-loaded sections grow underneath it.
//
// rootMargin shifts the "trigger zone" so a section becomes "active" when its
// top edge crosses ~30% from the top of the viewport (and stays active until
// it leaves the bottom 60%). This matches the natural reading position.
var _spyObserver = null;
var _spyVisible  = {};

function initOutlinerScrollSpy(){
  if(_spyObserver){ try { _spyObserver.disconnect(); } catch(e){} _spyObserver = null; }
  _spyVisible = {};
  var pc = document.getElementById('mc');
  if(!pc) return;
  if(!('IntersectionObserver' in window)) return;

  _spyObserver = new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      var id = entry.target.id.replace('page-','');
      _spyVisible[id] = entry.isIntersecting;
    });
    updateOutlinerActiveSection();
  }, {
    root: pc,
    // Active band = roughly top 25% to 60% of viewport (35% wide).
    // Wider than a thin line so short sections (e.g. Goals) don't get skipped
    // during fast scrolling. We pick the LAST intersecting section so during
    // transitions the highlight follows what the user is scrolling INTO.
    rootMargin: '-25% 0px -40% 0px',
    threshold: 0
  });

  OUTLINER_PAGES.forEach(function(p){
    var el = document.getElementById('page-' + p);
    if(el) _spyObserver.observe(el);
  });
}

function updateOutlinerActiveSection(){
  // Pick the LAST (deepest in DOM) section currently inside the spy band.
  // During transitions both old + new sections briefly intersect — picking
  // the last one matches what the user is scrolling INTO, not away from.
  var active = null;
  for(var i = OUTLINER_PAGES.length - 1; i >= 0; i--){
    if(_spyVisible[OUTLINER_PAGES[i]]){ active = OUTLINER_PAGES[i]; break; }
  }
  if(!active || active === currentPage) return;
  currentPage = active;
  document.querySelectorAll('.sb-item[data-page]').forEach(function(el){
    el.classList.toggle('on', el.dataset.page === active);
  });
  if(PAGES[active]){
    document.getElementById('pageTitle').textContent = PAGES[active].title;
    document.getElementById('pageSub').textContent = PAGES[active].sub;
  }
  positionSidebarIndicator();
}

// ── Sliding sidebar indicator ──
// Reads the active .sb-item's geometry and translates the floating .sb-indicator
// to match. Using transform instead of top/height keeps movement on the GPU.
function positionSidebarIndicator(){
  var ind = document.getElementById('sbIndicator');
  if(!ind) return;
  var nav = ind.parentElement;
  if(!nav) return;
  var active = nav.querySelector('.sb-item[data-page].on');
  if(!active || active.getAttribute('data-hidden') === '1'){
    ind.classList.remove('ready');
    return;
  }
  var top = active.offsetTop;
  var h   = active.offsetHeight;
  ind.style.transform = 'translateY(' + top + 'px)';
  ind.style.height    = h + 'px';
  ind.classList.add('ready');
}

// ── Scroll-progress bar ──
// Throttled with rAF so it stays buttery during fast scrolls. Updates the
// width fill based on how far through the page-content the user has scrolled.
var _scrollRaf = null;
function updateScrollProgress(){
  _scrollRaf = null;
  var pc = document.getElementById('mc');
  var fill = document.getElementById('scrollProgressFill');
  if(!pc || !fill) return;
  var max = pc.scrollHeight - pc.clientHeight;
  var pct = max > 0 ? Math.min(100, Math.max(0, (pc.scrollTop / max) * 100)) : 0;
  fill.style.width = pct.toFixed(2) + '%';
}
function onContentScroll(){
  if(_scrollRaf != null) return;
  _scrollRaf = requestAnimationFrame(updateScrollProgress);
}
function bindScrollProgress(){
  var pc = document.getElementById('mc');
  if(!pc) return;
  pc.removeEventListener('scroll', onContentScroll);
  pc.addEventListener('scroll', onContentScroll, { passive: true });
  updateScrollProgress();
}

function renderPage(page, d){
  if(page === 'overview'){
    doOverview(d);
  } else if(page === 'team'){
    doTeamDemo(d);
  } else if(page === 'bugs'){
    doBugsBacklog(d);
    doPolish(d);
  } else if(page === 'spillovers'){
    doSpillovers(d);
  } else if(page === 'retro'){
    doRetrospective(d);
  } else if(page === 'performance'){
    doDrainersStars(d); doPerformance(d); doEarly(d);
  } else if(page === 'users'){
    doUsersPage(d);
  } else if(page === 'leave'){
    doLeavePage(d);
  } else if(page === 'live'){
    doLiveView(d);
  } else if(page === 'settings'){
    doSettingsPage(d);
  }
}

function render(d){
  document.getElementById('mc').innerHTML = shell();
  window._sprintData = d;
  document.getElementById('root').classList.toggle('live-mode', currentPage === 'live');
  // Reset rendered-pages tracking — fresh data means everything needs re-render
  _renderedPages = {};
  // Show Users page only for Admin
  var usersNav = document.getElementById('nav-users');
  if(usersNav){
    if((window._userRole||'').toLowerCase() === 'admin') usersNav.removeAttribute('data-hidden');
    else usersNav.setAttribute('data-hidden', '1');
  }
  // Render subtasks data (used across pages)
  if(typeof doSubtasks === 'function') doSubtasks(d);
  if(typeof doSidebarAlerts === 'function') doSidebarAlerts(d);
  // Bind outliner scroll-spy now that #mc exists
  initOutlinerScrollSpy();
  bindScrollProgress();
  // Position the sliding sidebar indicator after layout settles
  requestAnimationFrame(positionSidebarIndicator);
  // Activate the right pages based on current mode
  var pc = document.getElementById('mc');
  if(isOutlinerPage(currentPage)){
    pc.classList.add('outliner-mode');
    document.querySelectorAll('.page').forEach(function(el){
      var id = el.id.replace('page-','');
      el.classList.toggle('active', isOutlinerPage(id));
    });
    // Render the landing section eagerly (so first paint isn't a placeholder),
    // then let IntersectionObserver lazy-render the rest as they scroll into view.
    lazyRenderPage(currentPage, d);
    setupLazyRender(d);
  } else {
    pc.classList.remove('outliner-mode');
    document.querySelectorAll('.page').forEach(function(el){
      el.classList.toggle('active', el.id === 'page-' + currentPage);
    });
    renderPage(currentPage, d);
  }
}

/* ── OVERVIEW HERO (demo design): donuts + status + missing hours,
   then reuse the rich burndown / sprint-progress / goal renderers ── */
function nvDonut(id, data, colors, onSeg, labels){
  var el=document.getElementById(id); if(!el) return null;
  if(CH[id]) CH[id].destroy();
  var externalTip=null;
  if(id==='crD'){
    externalTip=document.getElementById('crDTooltip');
    if(!externalTip){ externalTip=document.createElement('div'); externalTip.id='crDTooltip'; externalTip.className='nv-chart-tooltip'; document.body.appendChild(externalTip); }
  }
  var donutBorder=getComputedStyle(document.querySelector('.d')||document.documentElement).getPropertyValue('--sur').trim()||'#0b0c0f';
  var donutSeparators={
    id:'donutSeparators',
    afterDatasetsDraw:function(chart){
      var arcs=chart.getDatasetMeta(0).data;
      var visible=arcs.filter(function(arc,i){return Number(data[i])>0;});
      if(visible.length<2) return;
      var ctx=chart.ctx;
      ctx.save();
      ctx.strokeStyle=donutBorder;
      ctx.lineWidth=3;
      ctx.lineCap='butt';
      visible.forEach(function(arc){
        var a=arc.startAngle;
        ctx.beginPath();
        ctx.moveTo(arc.x+Math.cos(a)*(arc.innerRadius-1),arc.y+Math.sin(a)*(arc.innerRadius-1));
        ctx.lineTo(arc.x+Math.cos(a)*(arc.outerRadius+1),arc.y+Math.sin(a)*(arc.outerRadius+1));
        ctx.stroke();
      });
      ctx.restore();
    }
  };
  CH[id]=new Chart(el,{type:'doughnut',
    data:{labels:labels||[],datasets:[{data:data, backgroundColor:colors, borderWidth:0, spacing:0}]},
    plugins:[donutSeparators],
    options:{cutout:'72%', responsive:true, maintainAspectRatio:false,
      onResize:function(ch){ requestAnimationFrame(function(){ nvFitDonutCenter(id); }); },
      onClick:function(evt,els){ if(onSeg && els && els.length) onSeg(els[0].index); },
      onHover:function(evt,els){ if(onSeg && evt.native) evt.native.target.style.cursor = els.length?'pointer':'default'; },
      plugins:{legend:{display:false}, tooltip:id==='crD'?{enabled:false,external:function(ctx){
        var tip=externalTip, model=ctx.tooltip;
        if(!tip) return;
        if(!model || model.opacity===0){ tip.classList.remove('show'); return; }
        var item=model.dataPoints&&model.dataPoints[0];
        if(!item){ tip.classList.remove('show'); return; }
        var tipColor=colors[item.dataIndex]||'#dde1f5';
        tip.style.borderColor=tipColor;
        tip.innerHTML='<span class="dot" style="background:'+tipColor+'"></span><span>'+escHtml(item.label||'Status')+'</span><span class="value">'+item.formattedValue+'</span>';
        tip.classList.add('show');
        var rect=ctx.chart.canvas.getBoundingClientRect(), tipW=tip.offsetWidth, gap=12;
        var left=rect.right+gap;
        if(left+tipW>window.innerWidth-8) left=rect.left-tipW-gap;
        tip.style.left=Math.max(8,left)+'px';
        tip.style.top=Math.max(18,Math.min(window.innerHeight-18,rect.top+model.caretY))+'px';
      }}:{enabled:true}}}});
  return CH[id];
}
// Sprint Overview donuts (Status overview crD, Scope Creep scD): the centre
// value (+ its small label) is sized from the donut hole, so both centres are
// filled the same way — about 60% of the hole's width, with even space around.
function nvFitDonutCenter(id){
  if(id!=='crD' && id!=='scD') return;
  var ch=CH[id], box=document.getElementById(id+'c');
  var arc=ch && ch.getDatasetMeta(0).data[0];
  if(!box || !arc || !arc.innerRadius) return;
  var hole=arc.innerRadius*2, sub=box.querySelector('.nv-donut-sub');
  var main=(box.textContent||'').replace(sub?sub.textContent:'','').trim();
  var fs=Math.min(hole*0.60/(Math.max(1,main.length)*0.6), hole*(sub?0.36:0.42));
  box.style.fontSize=Math.round(fs)+'px';
  if(sub){
    var sl=Math.max(1,sub.textContent.length);
    sub.style.fontSize=Math.round(Math.min(Math.max(11,fs*0.32), hole*0.78/(sl*0.55)))+'px';
    sub.style.marginTop=Math.round(fs*0.12)+'px';
  }
}
function nvChips(arr){
  return arr.map(function(k){
    return '<span class="nv-chip"><span class="n" style="background:'+k.c+'">'+k.n+'</span>'+k.l+'</span>';
  }).join('');
}
/* Bugs & polish filter for the Overview cards.
   'with'    → counts sprint tasks plus bugs and polishes (default)
   'without' → task-only figures, bugs and polishes excluded
   Affects: Completion Rate, Status, Sprint progress, Burndown, Expected Hours
   and the sidebar Alerts (including every drill-down opened from them).
   Scope Creep and the Bugs & Polishes card are deliberately unaffected. */
window._bpMode = 'with';   // bugs & polish always included (the toggle was removed)

/* ══ CLICKABLE-CHART DETAIL SYSTEM ══════════════════════════════
   One reusable modal. Each chart/tile click builds a filtered task
   list from the current sprint data and opens it. ═══════════════ */
function escAttr(s){ return String(s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;'); }

function nvDetail(title, sub, html, kind){
  var m=document.getElementById('nvDetailModal'); if(!m) return;
  m.classList.toggle('alert-detail', kind === 'alert');
  document.getElementById('nvDetailTitle').textContent = title || 'Details';
  document.getElementById('nvDetailSub').textContent   = sub || '';
  document.getElementById('nvDetailBody').innerHTML     = html || '';
  m.classList.add('open');
}
function nvCloseDetail(){ var m=document.getElementById('nvDetailModal'); if(m) m.classList.remove('open'); }
document.addEventListener('keydown', function(e){ if(e.key==='Escape') nvCloseDetail(); });

/* ── SPRINT COMPLETION + COUNTDOWN (Jira dashboard gadgets, our design) ── */
var _cdTimer=null;
document.addEventListener('click',function(){ var dd=document.getElementById('pbDD'); if(dd) dd.classList.remove('open'); });

/* ── SUBTASKS ── */
var subFilter='all';

/* ── BUGS & POLISH ── */
var bugsActiveTab = 'current'; // current | all | byStatus
var bugsActiveAsn = 'All';     // assignee filter pill

/* ── POLISH (Feedback tickets) ──
   Mirrors doBugsBacklog but for Ticket Type = Feedback. Polish has its own
   "Current Sprint" filter (in-sprint dueDate, Priority ≠ Deferred) and an
   "All Time" tab that shows every Feedback-type ticket — including Deferred —
   so the team can audit the parked backlog. */
var polishActiveTab = 'current'; // current | all | byStatus
var polishActiveAsn = 'All';     // assignee filter pill

function escHtml(s){
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Build per-member buckets from sprint data. Returns map of name→bucket.
// A "bucket" includes parent tasks the person owns + subtasks they own
// (across any parent). Counts are de-duped against rolled-up parent ests.
function buildMemberBuckets(d){
  var tasks    = (d && d.tasks)    || [];
  var subtasks = (d && d.subtasks) || [];

  var parentsWithSubs = {};
  subtasks.forEach(function(s){
    var p = (s.parentTask||'').trim();
    if(p) parentsWithSubs[p] = true;
  });

  var byAsn = {};
  function bucket(asn, team){
    if(!byAsn[asn]){
      byAsn[asn] = {name:asn, team:team||'', tasks:[], ownedSubs:[], orphanSubs:[],
                    bugs:[], polish:[],
                    totEst:0, totLog:0, done:0, prog:0, ns:0, total:0};
    } else if(!byAsn[asn].team && team){
      byAsn[asn].team = team;
    }
    // older buckets may pre-date bugs/polish arrays — patch in for safety
    if(!byAsn[asn].bugs)   byAsn[asn].bugs   = [];
    if(!byAsn[asn].polish) byAsn[asn].polish = [];
    return byAsn[asn];
  }

  tasks.forEach(function(t){
    var asn = (t.assignee||'').trim() || 'Unassigned';
    var b = bucket(asn, t.teamCategory);
    b.tasks.push(t);
    var hasSubs = parentsWithSubs[(t.taskName||'').trim()];
    if(!hasSubs){
      b.totEst += parseFloat(t.estTime)||0;
      b.totLog += parseFloat(t.timeLog)||0;
      b.total++;
      var st = (t.status||'').trim();
      if(st==='Done') b.done++;
      else if(st==='In Progress'||st==='In Review'||st==='Build Awaiting') b.prog++;
      else b.ns++;
    }
  });

  subtasks.forEach(function(s){
    var asn = (s.assignee||'').trim() || 'Unassigned';
    var b = bucket(asn, s.teamCategory);
    b.ownedSubs.push(s);
    b.totEst += parseFloat(s.estTime)||0;
    b.totLog += parseFloat(s.timeLog)||0;
    b.total++;
    var st = (s.status||'').trim();
    if(st==='Done') b.done++;
    else if(st==='In Progress'||st==='In Review'||st==='Build Awaiting') b.prog++;
    else b.ns++;
    var parentName = (s.parentTask||'').trim();
    var ownsParent = b.tasks.some(function(t){ return (t.taskName||'').trim() === parentName; });
    if(!ownsParent) b.orphanSubs.push(s);
  });

  // ── Parent owner's "own" portion ──
  // Same idea as in process(): parent.est/log includes rolled-up subtask
  // totals. Subtract subtask totals to get parent's own work, then attribute
  // that to the parent's owner. Doesn't touch task counts (.total/.done/etc.)
  // — those still belong to leaves + subtasks.
  var subEstByParent = {}, subLogByParent = {};
  subtasks.forEach(function(s){
    var p = (s.parentTask||'').trim();
    if(!p) return;
    subEstByParent[p] = (subEstByParent[p]||0) + (parseFloat(s.estTime)||0);
    subLogByParent[p] = (subLogByParent[p]||0) + (parseFloat(s.timeLog)||0);
  });
  tasks.forEach(function(t){
    var name = (t.taskName||'').trim();
    if(!parentsWithSubs[name]) return; // only parents-with-subs
    var rolledEst = parseFloat(t.estTime)||0;
    var rolledLog = parseFloat(t.timeLog)||0;
    var ownEst = Math.max(0, rolledEst - (subEstByParent[name]||0));
    var ownLog = Math.max(0, rolledLog - (subLogByParent[name]||0));
    if(!ownEst && !ownLog) return;
    var asn = (t.assignee||'').trim() || 'Unassigned';
    var bk = bucket(asn, t.teamCategory);
    bk.totEst += ownEst;
    bk.totLog += ownLog;
    // intentionally NOT touching .total/.done/.prog/.ns — parent counts
    // are derived from subtasks; this only credits the parent owner with
    // their non-subtask hours
  });

  // ── Merge bugs + polish into per-member counts and time ──
  // Mirrors process(): bugs/polish (in-sprint, priority ≠ Deferred, by ticket
  // type) are real work the assignee owns, so they go into:
  //   • .totEst / .totLog   — keeps roster hours matching team charts
  //   • .total / .done / .prog / .ns — so the card "items" count + done %
  //     match what the user sees on the Bugs & Polish page
  //   • .bugs[] / .polish[] — for a dedicated section in the modal
  function mergeBugLike(list, kind){
    (list||[]).forEach(function(b){
      var est = parseFloat(b.estTime)||0;
      var log = parseFloat(b.timeLog)||0;
      var asn = (b.assignee||'').trim() || 'Unassigned';
      var bk = bucket(asn, b.teamCategory);
      bk.totEst += est;
      bk.totLog += log;
      bk.total++;
      var st = (b.status||'').trim();
      if(st==='Done') bk.done++;
      else if(st==='In Progress'||st==='In Review'||st==='Build Awaiting') bk.prog++;
      else bk.ns++;
      bk[kind].push(b);
    });
  }
  mergeBugLike((d&&d.bugs)||[],   'bugs');
  mergeBugLike((d&&d.polish)||[], 'polish');

  // Keep member-detail totals aligned with process().
  (d&&d.appliedLeaves||[]).forEach(function(leave){
  var matched = Object.keys(byAsn).filter(function(name){
    return normPersonName(name) === normPersonName(leave.fullName);
  })[0];

  if(matched){
    byAsn[matched].totLog += leave.hours;
  }
});

  return byAsn;
}

function memberInitials(name){
  var parts = (name||'?').trim().split(/\s+/);
  if(parts.length >= 2) return (parts[0][0] + parts[parts.length-1][0]).toUpperCase();
  return (parts[0]||'?').slice(0,2).toUpperCase();
}

function mmNormName(s){
  return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function openMemberDetail(name){
  var d = window._sprintData;
  if(!d){ console.warn('[MEMBER] no data'); return; }
  var buckets = buildMemberBuckets(d);
  var a = buckets[name];
  if(!a){
    var wanted = mmNormName(name);
    var matchKey = Object.keys(buckets).filter(function(k){ return mmNormName(k) === wanted; })[0];
    if(matchKey) a = buckets[matchKey];
  }
  if(!a){
    alert('No tasks found for: ' + name);
    return;
  }
  window._mmCurrentMember = a.name;
  _mmStatusFilter = 'All';
  renderMemberDetail(a, d);
  var modalBody = document.getElementById('mmBody');
  if(modalBody) modalBody.scrollTop = 0;
  document.getElementById('memberModal').classList.add('on');
  document.body.style.overflow = 'hidden';
}

function closeMemberModal(){
  document.getElementById('memberModal').classList.remove('on');
  document.body.style.overflow = '';
}

function renderMemberDetail(a, d){
  var teamCol = a.team ? tc(a.team) : 'var(--mut)';
  var subtaskGroups = (d && d.subtaskGroups) || {};
  var totalItems = a.total || (a.tasks.length + a.ownedSubs.length);
  var pct = totalItems>0 ? Math.round(a.done/totalItems*100) : 0;
  var totalVar = rnd(a.totLog - a.totEst);

  // Header
  document.getElementById('mmAvatar').textContent = memberInitials(a.name);
  document.getElementById('mmAvatar').style.background = 'linear-gradient(135deg,'+teamCol+',var(--pur))';
  document.getElementById('mmName').textContent = a.name;
  var nBugs   = (a.bugs   && a.bugs.length)   || 0;
  var nPolish = (a.polish && a.polish.length) || 0;
  var metaHtml = (a.team ? '<span class="pill" style="background:'+teamCol+'">'+a.team+'</span>' : '')
    + '<span>'+a.tasks.length+' parent task'+(a.tasks.length===1?'':'s')+'</span>'
    + (a.ownedSubs.length ? '<span>· '+a.ownedSubs.length+' subtask'+(a.ownedSubs.length===1?'':'s')+'</span>' : '')
    + (nBugs   ? '<span>· '+nBugs+' bug'+(nBugs===1?'':'s')+'</span>' : '')
    + (nPolish ? '<span>· '+nPolish+' polish</span>' : '');
  document.getElementById('mmMeta').innerHTML = metaHtml;

  // Stats grid
  // Under estimate only once everything is done; otherwise the gap is hours still left.
  var allDone  = totalItems > 0 && a.done >= totalItems;
  var varCol   = totalVar > 0 ? 'var(--red)' : (totalVar < 0 ? (allDone ? 'var(--grn)' : 'var(--acc)') : 'var(--mut)');
  var varLabel = totalVar > 0 ? 'Over estimate' : (totalVar < 0 ? (allDone ? 'Under estimate' : 'Left vs estimate') : 'On estimate');
  var varText  = totalVar > 0 ? '+'+totalVar : (totalVar < 0 ? '−'+Math.abs(totalVar) : '0');
  document.getElementById('mmStats').innerHTML = ''
    + '<div class="mm-stat"><div class="mm-stat-v">'+totalItems+'</div><div class="mm-stat-l">Total items</div></div>'
    + '<div class="mm-stat"><div class="mm-stat-v" style="color:var(--grn)">'+a.done+'</div><div class="mm-stat-l">Completed</div></div>'
    + '<div class="mm-stat"><div class="mm-stat-v">'+rnd(a.totEst)+'<span class="unit">h</span></div><div class="mm-stat-l">Estimated</div></div>'
    + '<div class="mm-stat"><div class="mm-stat-v" style="color:var(--acc)">'+rnd(a.totLog)+'<span class="unit">h</span></div><div class="mm-stat-l">Logged</div></div>'
    + '<div class="mm-stat"><div class="mm-stat-v" style="color:'+varCol+'">'+varText+'<span class="unit">h</span></div><div class="mm-stat-l">'+varLabel+'</div></div>';

  var activePct = totalItems>0 ? Math.round(a.prog/totalItems*100) : 0;
  document.getElementById('mmProgressDone').style.width = pct + '%';
  document.getElementById('mmProgressActive').style.width = activePct + '%';
  document.getElementById('mmProgressLead').textContent = a.done+' of '+totalItems+' done';
  document.getElementById('mmProgressMeta').textContent = pct+'% · '+a.prog+' in progress · '+a.ns+' to do';

  // Status filter pills
  var countItems = a.tasks.filter(function(t){
    var subs = subtaskGroups[t.taskName] || subtaskGroups[(t.taskName||'').trim()] || [];
    return !subs.length;
  }).concat(a.ownedSubs||[], a.bugs||[], a.polish||[]);
  var counts = {
    All: countItems.length,
    Done: countItems.filter(function(x){ return (x.status||'').trim()==='Done'; }).length,
    'In Progress': countItems.filter(function(x){ return (x.status||'').trim()==='In Progress'; }).length,
    'Not Started': countItems.filter(function(x){ var s=(x.status||'').trim(); return s==='Not Started'||s==='To Do'||s==='To do'; }).length
  };
  var filters = ['All','Done','In Progress','Not Started'];
  document.getElementById('mmFilters').innerHTML = filters.map(function(f){
    var label = f==='In Progress' ? 'In progress' : (f==='Not Started' ? 'To do' : f);
    return '<button class="mm-filter'+(f===_mmStatusFilter?' on':'')
      + '" onclick="setMmFilter(\''+f.replace(/'/g,"\\'")+'\')">'
      + label + ' <span style="opacity:.7">'+(counts[f]||0)+'</span></button>';
  }).join('');

  // Body sections
  var body = document.getElementById('mmBody');
  var matchesFilter = function(status){
    if(_mmStatusFilter === 'All') return true;
    var st = (status||'').trim();
    if(_mmStatusFilter === 'Done') return st === 'Done';
    if(_mmStatusFilter === 'In Progress') return st === 'In Progress';
    if(_mmStatusFilter === 'Not Started') return st === 'Not Started' || st === 'To Do' || st === 'To do';
    return true;
  };

  var html = '';

  // ── Section 1: Parent tasks owned ──
  // A subtask only belongs in a member's list when they are the assignee on
  // it — even if the parent task is theirs. So when deciding whether to keep
  // a parent, we look at the owner's OWN subs of that parent (not all subs).
  // Parent is kept if its own status matches OR any of the owner's subs
  // under it match.
  var ownerName = a.name;
  var ownerKey  = mmNormName(ownerName);
  var strictStatusView = _mmStatusFilter !== 'All';
  var ownedParents = a.tasks.filter(function(t){
    var subs = subtaskGroups[t.taskName] || subtaskGroups[(t.taskName||'').trim()] || [];
    if(strictStatusView) return !subs.length && matchesFilter(t.status);
    return true;
  });
  if(a.tasks.length && (!strictStatusView || ownedParents.length)){
    html += '<div class="mm-section">'
      + '<div class="mm-section-title">'+(strictStatusView?'Tasks':'Owned tasks')+' <span class="mm-section-count">'+ownedParents.length+'</span></div>';
    if(!ownedParents.length){
      html += '<div class="mm-empty">No owned tasks match this filter.</div>';
    } else {
      html += ownedParents.map(function(t){ return renderMmTask(t, subtaskGroups, a.name, matchesFilter); }).join('');
    }
    html += '</div>';
  }

  // ── Section 2: Subtasks owned where parent belongs to someone else ──
  // Status tabs list matching subtasks independently, so a parent with a
  // different status never leaks into Done, In progress, or To do.
  if(strictStatusView){
    var strictSubs = (a.ownedSubs||[]).filter(function(s){ return matchesFilter(s.status); });
    if(strictSubs.length){
      html += '<div class="mm-section"><div class="mm-section-title">Sub-tasks <span class="mm-section-count">'+strictSubs.length+'</span></div>'
        + '<div class="mm-subtree">'
        + strictSubs.map(function(s){ return renderMmSub(s, a.name); }).join('')
        + '</div></div>';
    }
  }

  if(!strictStatusView && a.orphanSubs && a.orphanSubs.length){
    var orphanFiltered = a.orphanSubs.filter(function(s){ return matchesFilter(s.status); });
    var grouped = {};
    orphanFiltered.forEach(function(s){
      var p = (s.parentTask||'(no parent)').trim();
      if(!grouped[p]) grouped[p] = [];
      grouped[p].push(s);
    });
    html += '<div class="mm-section">'
      + '<div class="mm-section-title">Subtasks under others\' tasks <span class="mm-section-count">'+orphanFiltered.length+'</span></div>';
    if(!orphanFiltered.length){
      html += '<div class="mm-empty">No subtasks match this filter.</div>';
    } else {
      Object.keys(grouped).forEach(function(parentName){
        html += '<div class="mm-orphan-head">Parent: '+parentName+'</div>'
          + '<div class="mm-subtree" style="margin-top:2px">'
          + grouped[parentName].map(function(s){return renderMmSub(s, a.name);}).join('')
          + '</div>';
      });
    }
    html += '</div>';
  }

  // ── Section 3: Bugs & Polish owned by this member ──
  // Same shape as renderMmTask but tagged by ticket type. Counts honor the
  // active status filter so the visible rows match the filter pill totals.
  function renderMmBugLike(b, kind){
    var est = parseFloat(b.estTime)||0;
    var log = parseFloat(b.timeLog)||0;
    var v   = rnd(log - est);
    var st  = (b.status||'').trim() || 'Not Started';
    var isDone = st === 'Done';
    var tagColor = kind==='bug' ? 'var(--red)' : 'var(--pur)';
    var tagLabel = kind==='bug' ? 'BUG' : 'POLISH';
    var varBadge = mmVarBadge(log, est, isDone);
    return '<div class="mm-task" data-status="'+st+'">'
      + '<div class="mm-task-main">'
        + '<div class="mm-task-title'+(isDone?' done':'')+'">'+(b.taskName||'(unnamed)')+'</div>'
        + '<div class="mm-task-meta">'
          + '<span style="color:'+tagColor+';font-weight:700;letter-spacing:.5px">'+tagLabel+'</span>'
          + (b.mssTicket ? '<span class="mm-mss">'+b.mssTicket+'</span>' : '')
          + '<span class="mm-status-badge">'+escHtml(stName(b))+'</span>'
          + (b.priority ? '<span>'+b.priority+'</span>' : '')
          + (b.dueDate ? '<span>Due '+b.dueDate+'</span>' : '')
        + '</div>'
      + '</div>'
      + '<div class="mm-task-side">'
        + '<div class="mm-task-hrs">'+log+'<span class="est">/'+est+'h</span></div>'
        + varBadge
      + '</div>'
      + '</div>';
  }
  var ownedBugs   = (a.bugs   || []).filter(function(b){ return matchesFilter(b.status); });
  var ownedPolish = (a.polish || []).filter(function(b){ return matchesFilter(b.status); });
  if((a.bugs && a.bugs.length) || (a.polish && a.polish.length)){
    var bpTotal = ownedBugs.length + ownedPolish.length;
    html += '<div class="mm-section">'
      + '<div class="mm-section-title">Bugs &amp; Polish <span class="mm-section-count">'+bpTotal+'</span></div>';
    if(!bpTotal){
      html += '<div class="mm-empty">No bugs or polish match this filter.</div>';
    } else {
      if(ownedBugs.length){
        html += '<div class="mm-orphan-head">Bugs (' + ownedBugs.length + ')</div>'
          + ownedBugs.map(function(b){ return renderMmBugLike(b, 'bug'); }).join('');
      }
      if(ownedPolish.length){
        html += '<div class="mm-orphan-head">Polish (' + ownedPolish.length + ')</div>'
          + ownedPolish.map(function(b){ return renderMmBugLike(b, 'polish'); }).join('');
      }
    }
    html += '</div>';
  }

  if(!a.tasks.length && !(a.orphanSubs && a.orphanSubs.length)
     && !(a.bugs && a.bugs.length) && !(a.polish && a.polish.length)){
    html = '<div class="mm-empty">No tasks, subtasks, bugs, or polish for ' + a.name + ' in this sprint.</div>';
  }

  body.innerHTML = html;
}

// Hours label on a task: over budget → "Xh over"; nothing logged yet and not
// done → "Not started"; still open with hours left → "Xh left"; finished
// under budget → "Xh under"; exactly on budget → "On estimate".
function mmVarLabel(log, est, isDone){
  var v = rnd(log - est);
  if(v > 0) return {cls:'over', text:v+'h over'};
  if(!isDone && log <= 0) return {cls:'ns', text:'Not started'};
  if(!isDone && v < 0) return {cls:'left', text:Math.abs(v)+'h left'};
  if(v < 0) return {cls:'under', text:Math.abs(v)+'h under'};
  return {cls:'ns', text:'On estimate'};
}
function mmVarBadge(log, est, isDone){ var l=mmVarLabel(log, est, isDone); return '<span class="mm-task-var '+l.cls+'">'+l.text+'</span>'; }

function renderMmTask(t, subtaskGroups, ownerName, matchesFilter){
  var est = parseFloat(t.estTime)||0;
  var log = parseFloat(t.timeLog)||0;
  var v   = rnd(log - est);
  var st  = (t.status||'').trim() || 'Not Started';
  var isDone = st === 'Done';
  // Look up subs by both raw + trimmed key — Asana sync sometimes leaves
  // trailing whitespace on parent task names, which would otherwise miss.
  var subs = subtaskGroups[t.taskName] || subtaskGroups[(t.taskName||'').trim()] || [];
  // Only render subs assigned to the modal's owner — work belongs to the
  // person on the assignee field, not to whoever happens to own the parent.
  // Subs assigned to others appear in their own member's modal instead.
  // Compare with a defensive normalize (collapse whitespace + lowercase) so
  // a stray space or capitalization difference can't accidentally surface
  // someone else's work on this card.
  var ownerKey = mmNormName(ownerName);
  subs = subs.filter(function(s){ return mmNormName(s.assignee) === ownerKey; });
  // When a status filter is active, narrow further to just matching subs so
  // the visible items match the active filter pill count.
  if(typeof matchesFilter === 'function'){
    subs = subs.filter(function(s){ return matchesFilter(s.status); });
  }
  var unp  = (typeof isUnplanned === 'function') ? isUnplanned(t) : false;

  var varBadge = mmVarBadge(log, est, isDone);

  return '<div class="mm-task" data-status="'+st+'">'
    + '<div class="mm-task-head">'
      + '<div class="mm-task-main">'
        + '<div class="mm-task-title'+(isDone?' done':'')+'">'+escHtml(t.taskName)+'</div>'
        + '<div class="mm-task-meta">'
          + (t.mssTicket ? '<span class="mm-mss">'+escHtml(t.mssTicket)+'</span>' : '')
          + '<span class="mm-status-badge">'+escHtml(stName(t))+'</span>'
          + (unp ? '<span style="color:var(--red);font-weight:600">UNPLANNED</span>' : '')
          + (t.priority ? '<span>'+escHtml(t.priority)+'</span>' : '')
          + '<span>'+subs.filter(function(s){return nvIsDone(s);}).length+'/'+subs.length+' sub-tasks done</span>'
        + '</div>'
      + '</div>'
      + '<div class="mm-task-side"><div class="mm-task-hrs">'+log+'<span class="est"> / '+est+'h</span></div>'+varBadge+'</div>'
    + '</div>'
    + (subs.length ? '<div class="mm-subtree">' + subs.map(function(s){return renderMmSub(s, ownerName);}).join('') + '</div>' : '')
    + '</div>';
}

function renderMmSub(s, ownerName){
  var sEst = parseFloat(s.estTime)||0;
  var sLog = parseFloat(s.timeLog)||0;
  var sSt  = (s.status||'').trim() || 'Not Started';
  var done = sSt === 'Done';
  var dotCol = done ? 'var(--grn)' : (sSt==='In Progress' ? 'var(--acc)' : (/re-?open/i.test(stName(s)) ? 'var(--red)' : 'var(--mut)'));
  var meterPct = sEst>0 ? Math.max(0,Math.min(100,Math.round(sLog/sEst*100))) : 0;
  var meterCol = sLog>sEst ? 'var(--red)' : (done ? 'var(--grn)' : (sLog>0 ? 'var(--acc)' : 'transparent'));
  var ownTag = mmNormName(s.assignee) === mmNormName(ownerName) ? '' : '<span class="mm-sub-owner">→ '+(s.assignee||'?')+'</span>';
  return '<div class="mm-sub">'
    + '<span class="mm-sub-dot" style="background:'+dotCol+'"></span>'
    + '<div class="mm-sub-mid">'
    +   '<span class="mm-sub-name'+(done?' done':'')+'">'+escHtml(s.taskName)+'</span>'
    +   '<div class="mm-sub-submeta"><span>'+escHtml(stName(s))+'</span>'+ownTag+'</div>'
    + '</div>'
    + '<span class="mm-sub-meter"><i style="width:'+meterPct+'%;background:'+meterCol+'"></i></span>'
    + '<span class="mm-sub-hrs">'+sLog+'<span style="color:var(--mut)"> / '+sEst+'h</span></span>'
    + '</div>';
}

function setMmFilter(f){
  _mmStatusFilter = f;
  var d = window._sprintData;
  if(!d || !window._mmCurrentMember) return;
  var buckets = buildMemberBuckets(d);
  var a = buckets[window._mmCurrentMember];
  if(!a){
    var wanted = mmNormName(window._mmCurrentMember);
    var matchKey = Object.keys(buckets).filter(function(k){ return mmNormName(k) === wanted; })[0];
    if(matchKey) a = buckets[matchKey];
  }
  if(a) renderMemberDetail(a, d);
}

document.addEventListener('keydown', function(e){
  if(e.key === 'Escape'){
    var m = document.getElementById('memberModal');
    if(m && m.classList.contains('on')) closeMemberModal();
  }
});

function applyTheme(mode){
  mode = mode || localStorage.getItem('themePref') || 'dark';
  var dark = true;
  if(mode === 'light') dark = false;
  else if(mode === 'auto'){
    dark = !window.matchMedia('(prefers-color-scheme: light)').matches;
  }
  isDark = dark;
  document.getElementById('root').classList.toggle('light', !dark);
}

if(window.matchMedia){
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function(){
    if(localStorage.getItem('themePref') === 'auto'){
      applyTheme('auto');
      if(raw && window._sprintData) renderPage(currentPage, window._sprintData);
    }
  });
}

// ── SIDEBAR HANDLERS ──
function toggleSidebar(){
  var sb = document.getElementById('sidebar');
  if(window.innerWidth <= 860){
    sb.classList.toggle('open');
  } else {
    sb.classList.toggle('collapsed');
    // Save preference
    localStorage.setItem('sidebarCollapsed', sb.classList.contains('collapsed') ? '1' : '0');
  }
  syncSidebarToggle();
  // Indicator geometry depends on item width/padding — re-measure after the
  // collapse transition (CSS transition is .2s; give it a beat to settle).
  setTimeout(positionSidebarIndicator, 220);
}
// Live View: the sidebar is hidden and the top-left logo opens/closes it as an
// overlay. Picking anything in the sidebar closes it again.
function lvToggleSidebar(open){
  var root=document.getElementById('root'); if(!root) return;
  if(open===undefined) open=!root.classList.contains('lv-sb-open');
  root.classList.toggle('lv-sb-open', !!open);
  if(open) setTimeout(positionSidebarIndicator, 50);
}
document.addEventListener('click', function(e){
  if(e.target.closest && e.target.closest('#sidebar .sb-item')) lvToggleSidebar(false);
});
// Hover text of the sidebar arrow follows the state.
function syncSidebarToggle(){
  var b=document.getElementById('sbToggle'), sb=document.getElementById('sidebar'); if(!b||!sb) return;
  var t=sb.classList.contains('collapsed')?'Expand sidebar':'Collapse sidebar';
  b.title=t; b.setAttribute('aria-label',t);
}

// Re-measure on viewport resize so the indicator stays aligned when the
// layout reflows (e.g. wrapping topbar pushes content height around).
window.addEventListener('resize', function(){
  positionSidebarIndicator();
  if(typeof updateScrollProgress === 'function') updateScrollProgress();
});

function setupSidebar(){
  document.querySelectorAll('.sb-item[data-page]').forEach(function(el){
    el.addEventListener('click', function(){
      if(this.getAttribute('data-hidden') === '1') return;
      switchPage(this.dataset.page);
    });
  });
  // Jira spaces — same page, different data.
  document.querySelectorAll('.sb-item[data-space]').forEach(function(el){
    el.addEventListener('click', function(){ selectSpace(this.getAttribute('data-space')); });
  });
  markActiveSpace();
  // Top tab-row (demo design)
  document.querySelectorAll('.nv-tab').forEach(function(el){
    el.addEventListener('click', function(){ switchPage(this.dataset.page); });
  });
}

// ── SYNC BAR ──
function updateSyncBar(json){
  var now = new Date();
  var loadEl = document.getElementById('syncLoadTime');
  if(loadEl) loadEl.textContent = now.toLocaleString('en-US', {
    timeZone:'Asia/Karachi',
    month:'short', day:'numeric', hour:'2-digit', minute:'2-digit', hour12:true
  }) + ' PKT';

  // Sheet last synced — from json.lastSync. Apps Script returns an ISO/UTC
  // string; format it in Pakistan time so the dashboard matches the rest of
  // the sync schedule (which is also expressed in PKT).
  var sheetEl = document.getElementById('syncSheetTime');
  var hoursAgo = null, lastSyncDate = null;
  if(sheetEl){
    var lastSync = json && json.lastSync;
    if(lastSync){
      try {
        var lastDate = new Date(lastSync.toString().replace(/(\d+)(st|nd|rd|th)/i,'$1'));
        if(!isNaN(lastDate.getTime())){
          sheetEl.textContent = lastDate.toLocaleString('en-US', {
            timeZone:'Asia/Karachi',
            month:'short', day:'numeric',
            hour:'2-digit', minute:'2-digit', hour12:true
          }) + ' PKT';
          hoursAgo = (now - lastDate) / 3600000;
          lastSyncDate = lastDate;
        } else {
          sheetEl.textContent = lastSync;
        }
      } catch(e){
        sheetEl.textContent = lastSync;
      }
    } else {
      sheetEl.textContent = 'Never';
    }
  }

  // Next auto-sync — last sync + 30 min (incremental sync runs every 30 min)
  var nextEl = document.getElementById('syncNextTime');
  if(nextEl){
    nextEl.textContent = getNextSyncTime(lastSyncDate);
  }

  // Compact pill summary
  var pillEl = document.getElementById('syncPillText');
  if(pillEl){
    var label;
    if(hoursAgo === null){ label = 'Synced —'; }
    else if(hoursAgo < 1)  { label = 'Synced ' + Math.max(1, Math.round(hoursAgo*60)) + 'm ago'; }
    else if(hoursAgo < 24) { label = 'Synced ' + Math.round(hoursAgo) + 'h ago'; }
    else                   { label = 'Synced ' + Math.round(hoursAgo/24) + 'd ago'; }
    pillEl.textContent = label;
    pillEl.className = 'sync-pill-text' + (hoursAgo !== null && hoursAgo >= 24 ? ' stale' : '');
  }
}

// Incremental sync runs every 10 min (Code.gs setupIncrementalTrigger), so the
// next one is due 10 min after the last sync, e.g. "1:40 PM PKT (in 3m) · every 10 min".
var SYNC_EVERY_MIN = 10;
function getNextSyncTime(lastSync){
  var now = new Date();
  if(lastSync && !isNaN(lastSync.getTime())){
    var step = SYNC_EVERY_MIN * 60000;
    var nextT = lastSync.getTime() + step;
    // Last sync is older than one interval (e.g. a run was skipped) → next slot after now.
    while(nextT <= now.getTime()) nextT += step;
    var nextStr = new Date(nextT).toLocaleTimeString('en-US', { timeZone:'Asia/Karachi', hour:'numeric', minute:'2-digit', hour12:true });
    var left = Math.max(1, Math.ceil((nextT - now.getTime()) / 60000));
    return nextStr + ' PKT (in ' + left + 'm) · every ' + SYNC_EVERY_MIN + ' min';
  }
  // No sync recorded yet — fall back to the full syncs at 8am / 6pm PKT.
  // Convert current time to PKT (UTC+5)
  var utcHours = now.getUTCHours();
  var utcMinutes = now.getUTCMinutes();
  var pktHours = (utcHours + 5) % 24;
  var pktMinutes = utcMinutes;

  var next, diff;
  if(pktHours < 8 || (pktHours === 8 && pktMinutes === 0)){
    // Next is 8am today
    next = '8:00 AM PKT';
    diff = (8 - pktHours) * 60 - pktMinutes;
  } else if(pktHours < 18 || (pktHours === 18 && pktMinutes === 0)){
    // Next is 6pm today
    next = '6:00 PM PKT';
    diff = (18 - pktHours) * 60 - pktMinutes;
  } else {
    // Next is 8am tomorrow
    next = '8:00 AM PKT (tomorrow)';
    diff = (24 - pktHours + 8) * 60 - pktMinutes;
  }

  var hours = Math.floor(diff / 60);
  var mins  = diff % 60;
  var inText = hours > 0 ? (hours + 'h ' + mins + 'm') : (mins + 'm');
  return next + ' (in ' + inText + ')';
}

/* ── INIT ── */
/* ══════════════ DISCOVERY SPACES (Jira Product Discovery) ══════════════
   Discovery spaces have ideas, not sprints / estimates / time logs. Same
   cards, charts, pills and pop-ups as the sprint pages; every number comes
   straight from the idea fields synced from Jira (names exactly as in Jira).
   Roles (Theme, Roadmap, Impact …) come from the Jira Config DISC_* settings;
   a card whose field the space doesn't have is replaced or hidden. */
var DISC_PAGES={
  overview:{title:'Overview',sub:'Ideas, status and delivery at a glance'},
  team:{title:'Prioritization',sub:'Top ideas by score · impact vs effort'},
  retro:{title:'People',sub:'Who raises and owns the ideas'},
  ideas:{title:'Ideas list',sub:''},
  users:PAGES.users, settings:PAGES.settings
};
var DISC_TABS={overview:'Overview',team:'Prioritization',retro:'People'};
var SPRINT_TABS={overview:'Overview',team:'Team',retro:'Retrospective'};
var _discPrioTheme='All', _discPeopleBy='creator', _discQuery='';
function isDisc(){ return !!window._discData; }
window._dSets={};

// Themed hover tooltip for stacked-row segments (replaces the native title popup)
(function(){
  var tip=null;
  function seg(e){ return e.target&&e.target.closest?e.target.closest('[data-tip-k]'):null; }
  document.addEventListener('mousemove',function(e){
    var s=seg(e);
    if(!s){ if(tip) tip.classList.remove('show'); return; }
    if(!tip){ tip=document.createElement('div'); tip.className='nv-chart-tooltip'; document.body.appendChild(tip); }
    tip.innerHTML='<span class="dot" style="background:'+escAttr(s.getAttribute('data-tip-c'))+'"></span>'+escHtml(s.getAttribute('data-tip-k'))+'<span class="value">'+escHtml(s.getAttribute('data-tip-v'))+'</span>';
    var x=e.clientX+14, w=tip.offsetWidth;
    if(x+w>window.innerWidth-8) x=e.clientX-14-w;
    tip.style.left=x+'px'; tip.style.top=e.clientY+'px';
    tip.classList.add('show');
  });
  document.addEventListener('mouseleave',function(){ if(tip) tip.classList.remove('show'); });
})();
// Tabs / sidebar / top bar follow the space type.
function setDiscMode(on){
  var root=document.getElementById('root'); if(root) root.classList.toggle('disc-mode',!!on);
  var labels=on?DISC_TABS:SPRINT_TABS;
  document.querySelectorAll('.nv-tab').forEach(function(t){ var p=t.dataset.page, n=t.lastChild; if(labels[p]&&n&&n.nodeType===3) n.nodeValue=labels[p]; });
  if(!on){
    window._discData=null;
    if(!PAGES[currentPage] || currentPage==='ideas') currentPage='overview';
    document.getElementById('pageTitle').textContent=PAGES[currentPage].title;
    document.getElementById('pageSub').textContent=PAGES[currentPage].sub;
    document.querySelectorAll('.sb-item[data-page]').forEach(function(el){ el.classList.toggle('on', el.dataset.page===currentPage); });
    document.querySelectorAll('.nv-tab').forEach(function(el){ el.classList.toggle('on', el.dataset.page===currentPage); });
  }
}

var _dashLoadTimer=null, _dashLoadValue=0;
function dashboardLoaderMarkup(){
  return '<div class="loading"><div class="dash-loader">'
    +'<div class="dash-loader-top"><span class="dash-loader-title">Loading dashboard</span><span class="dash-loader-pct" id="dashLoadPct">0%</span></div>'
    +'<div class="dash-loader-track"><div class="dash-loader-fill" id="dashLoadFill"></div></div>'
    +'<div class="dash-loader-status" id="dashLoadStatus">Connecting to dashboard data…</div>'
    +'</div></div>';
}
function setDashboardLoadProgress(value, status){
  _dashLoadValue=Math.max(0,Math.min(100,Number(value)||0));
  var pct=document.getElementById('dashLoadPct'), fill=document.getElementById('dashLoadFill'), msg=document.getElementById('dashLoadStatus');
  if(pct) pct.textContent=(_dashLoadValue>=100?100:Math.floor(_dashLoadValue))+'%';
  if(fill) fill.style.width=_dashLoadValue+'%';
  if(msg && status) msg.textContent=status;
}
// Loading bar — shown on every normal load (browser refresh, switching space,
// Sync Now, Snapshot, saving leave …). Only the automatic 2-min refresh
// (silentRefresh) updates without it. The bar keeps moving the whole time —
// quickly to ~70%, then slowly towards 95% — and the text says what it is
// waiting for, so a slow reply never looks frozen.
// kind 'sync' = Sync Now is pulling from Jira; if the bar is already on screen
// (e.g. Sync Now → reload), it carries on from where it is instead of restarting.
var _dashLoadKind='load';
function startDashboardLoader(kind){
  kind=kind||'load';
  if(_dashLoadTimer && document.getElementById('dashLoadFill')){ _dashLoadKind=kind; return; }
  if(_dashLoadTimer) clearInterval(_dashLoadTimer);
  _dashLoadKind=kind;
  var countdown=document.getElementById('headerCountdown');
  if(countdown) countdown.style.visibility='hidden';
  document.getElementById('mc').innerHTML=dashboardLoaderMarkup();
  var now=function(){ return (window.performance&&performance.now) ? performance.now() : Date.now(); };
  var t0=now(), tKind=t0, lastKind=kind;
  _dashLoadValue=4;
  setDashboardLoadProgress(4, kind==='sync'?'Syncing with Jira…':'Connecting to dashboard data…');
  _dashLoadTimer=setInterval(function(){
    if(!document.getElementById('dashLoadFill')){ clearInterval(_dashLoadTimer); _dashLoadTimer=null; return; }
    if(_dashLoadKind!==lastKind){ lastKind=_dashLoadKind; tKind=now(); }
    var s=(now()-t0)/1000, sk=(now()-tKind)/1000;
    // 0→70% in 3s, then eases towards 95% (≈78% at 8s, 88% at 15s, 93% at 30s).
    var v=s<3 ? 4+66*(1-Math.pow(1-s/3,2)) : 95-25*Math.exp(-(s-3)/12);
    var msg=_dashLoadKind==='sync'
      ? (sk<15 ? 'Syncing with Jira…' : 'Syncing with Jira — this can take a minute…')
      : (sk<4 ? 'Fetching sprint data…' : (sk<12 ? 'Waiting for Google Apps Script…' : 'Google Apps Script is slow to respond — still loading…'));
    setDashboardLoadProgress(Math.max(_dashLoadValue,v), msg);
  },100);
}
// Earlier versions kept a copy of each space's data in the browser; remove it.
function clearDashCache(){
  try{ Object.keys(localStorage).forEach(function(k){ if(k.indexOf('dashCache:')===0 || k.indexOf('dashSnap:')===0) localStorage.removeItem(k); }); }catch(e){}
  try{ if(window.indexedDB) indexedDB.deleteDatabase('sprintDash'); }catch(e){}
}
clearDashCache();
function finishDashboardLoader(callback){
  if(_dashLoadTimer){ clearInterval(_dashLoadTimer); _dashLoadTimer=null; }
  setDashboardLoadProgress(100,'Dashboard ready');
  callback();
  var countdown=document.getElementById('headerCountdown');
  if(countdown) countdown.style.visibility=isDisc()?'hidden':'visible';
}

function init(preserveSprint){
  var loadSeq=++_spaceLoadSeq;
  var requestedSpace=window._space;
  var stale=function(){ return loadSeq!==_spaceLoadSeq || requestedSpace!==window._space; };
  TEAM_COLORS={};
  startDashboardLoader();
  Promise.all([fetchData(), loadSpaceAssets(requestedSpace)])
    .then(function(r){ return r[0]; })
    .then(function(json){
      // Ignore a response belonging to an older space selection. Without this,
      // a slower previous request can overwrite the space the user clicked last.
      if(stale()) return;
      applyDashData(json, preserveSprint, loadSeq, requestedSpace);
    })
    .catch(function(e){
      if(stale()) return;
      if(_dashLoadTimer){ clearInterval(_dashLoadTimer); _dashLoadTimer=null; }
      document.getElementById('mc').innerHTML='<div class="err" style="text-align:left;line-height:2"><b>Failed to load data</b><br><br>Error: '+e.message+'<br><br>Please check:<br>1. Web App deployed with Access = Anyone<br>2. URL is correct in HTML<br><br><small>URL: '+API+'</small></div>';
    });
}

// Puts one space's data on screen (sprint list, selected sprint, pages).
function applyDashData(json, preserveSprint, loadSeq, requestedSpace){
      raw=json;
      updateSyncBar(json);
      // Discovery spaces (Jira Product Discovery) → ideas view, no sprints.
      if(json.kind==='discovery'){
        setDashboardLoadProgress(Math.max(_dashLoadValue,94),'Preparing discovery dashboard…');
        finishDashboardLoader(function(){ if(loadSeq===_spaceLoadSeq && requestedSpace===window._space) renderDisc(json); });
        return;
      }
      setDiscMode(false);
      // Only show actual sprints:
      // Valid sprint must have start & end that look like real dates
      // e.g. "30th March 2026" — not empty, not "BACKLOG", not "BUGS"
      var sps=(json.sprints||[]).filter(function(s){
        if(!s.id || !s.start || !s.end) return false;
        if(s.id.match(/^(BUGS|BACKLOG)$/i)) return false;
        if(s.start.match(/^(BUGS|BACKLOG)$/i)) return false;
        // Start must contain a 4-digit year (e.g. 2025 or 2026)
        return s.start.match(/20\d{2}/) && s.end.match(/20\d{2}/);
      }).slice().reverse();
      if(!sps.length){
        document.getElementById('mc').innerHTML='<div class="err">No sprint data found.<br>Run manualSync() in Apps Script first.</div>';
        return;
      }
      var sel=document.getElementById('spSel');
      sel.innerHTML='';
      sps.forEach(function(s){
        var o=document.createElement('option');
        o.value=s.id; o.textContent=s.id+' · '+s.start+' – '+s.end;
        sel.appendChild(o);
      });
      if(preserveSprint && sps.some(function(s){return s.id===preserveSprint;})){
        cur=preserveSprint;
      } else {
        cur=sps[0].id;
      }
      sel.value=cur; curTeam='All';
      setDashboardLoadProgress(Math.max(_dashLoadValue,94),'Rendering sprint dashboard…');
      var processed=process(raw,cur);
      finishDashboardLoader(function(){
        if(loadSeq===_spaceLoadSeq && requestedSpace===window._space) render(processed);
      });
}

// ── Quiet auto-refresh ──
// The Sheet is updated by the 10-min Jira sync. Every 2 minutes the dashboard
// checks the Sheet in the background; when a newer sync is there, the numbers
// and charts are redrawn in place — no loading bar, same page, same sprint,
// same scroll position, no chart animation. So a screen (e.g. the TV) shows
// new Jira data at most ~2 min after each sync, without anyone touching it.
var AUTO_REFRESH_MIN = 2;
var _silentBusy = false;
function silentRefresh(){
  if(_silentBusy || !raw || !window._userEmail || document.hidden) return;
  if(_dashLoadTimer || document.querySelector('#mc .dash-loader')) return;      // a normal load is running
  // Don't wipe something the user is typing (retro, sprint goal, leave, users…).
  var ae=document.activeElement;
  if(ae && ae.closest && ae.closest('#mc') && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
  if(document.querySelector('#mc .sg-editor-wrap')) return;                      // sprint goal is being edited
  var seq=_spaceLoadSeq, space=window._space, prevSync=raw.lastSync;
  _silentBusy=true;
  fetchData().then(function(json){
    if(seq!==_spaceLoadSeq || space!==window._space) return;                      // user switched space meanwhile
    if(!json || json.error==='unauthorized' || String(json.lastSync||'')===String(prevSync||'')) return;  // nothing new
    var isDiscNow=json.kind==='discovery';
    if(isDiscNow!==!!window._discData) return;                                    // space type changed — leave it to a normal load
    if(!isDiscNow && cur && !(json.sprints||[]).some(function(s){ return s.id===cur; })) return;
    var pcEl=document.getElementById('mc'), scroll=pcEl?pcEl.scrollTop:0, winScroll=window.scrollY;
    var anim=Chart.defaults.animation;
    Chart.defaults.animation=false;
    raw=json;
    updateSyncBar(json);
    if(isDiscNow) renderDisc(json);
    else render(process(raw,cur));
    // Pages draw on the next frame (switchPage uses requestAnimationFrame).
    requestAnimationFrame(function(){ requestAnimationFrame(function(){
      if(pcEl) pcEl.scrollTop=scroll;
      window.scrollTo(window.scrollX, winScroll);
      Chart.defaults.animation=anim;
    }); });
  }).catch(function(e){ console.warn('[auto-refresh]', e && e.message); })
    .then(function(){ _silentBusy=false; });
}
setInterval(silentRefresh, AUTO_REFRESH_MIN*60000);
document.addEventListener('visibilitychange', function(){ if(!document.hidden) silentRefresh(); });

document.getElementById('spSel').addEventListener('change',function(){
  cur=this.value; curTeam='All'; TEAM_COLORS={};
  if(raw)render(process(raw,cur));
});
// Theme toggle now handled via Settings page

// ── Sync Now button ──
// Triggers Apps Script's `manualSync` (Jira → Sheet pull, current space), then refreshes
// the dashboard. Useful at standup time when the cron schedule hasn't fired
// yet but a fresh number is needed. Throttled so a double-click can't fire
// two syncs at once (each one hits the Jira API).
async function triggerManualSync(){
  var btn = document.getElementById('syncNowBtn');
  if(!btn || btn.disabled) return;
  var origHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<svg class="icn spinning" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3.84-7.39"/></svg>Syncing…';
  // Loading bar for the whole sync; init() below carries it on while the data reloads.
  _spaceLoadSeq++;                       // a quiet auto-refresh in flight must not draw over it
  startDashboardLoader('sync');
  try{
    var url = API + '?action=manualSync&email=' + encodeURIComponent(window._userEmail||'') + tok() + '&_cb=' + Date.now();
    console.log('[manualSync] hitting URL:', url);
    var res = await fetch(url, { method:'GET', redirect:'follow' });
    var txt = await res.text();
    console.log('[manualSync] raw response (first 300 chars):', txt.slice(0, 300));
    var json;
    try { json = JSON.parse(txt.trim()); }
    catch(e){ throw new Error('Invalid response from server'); }
    if(json.error) throw new Error(json.message || json.error);
    if(!json.ok){
      // Most common cause: Apps Script not redeployed → request fell through
      // to default dashboard handler. The response will contain "sprints" and
      // "tasks" keys but no `ok`. Surface this so we know what's wrong.
      var keys = Object.keys(json).slice(0, 5).join(', ');
      throw new Error('No ok flag. Response keys: ' + keys + '. Likely: Apps Script not redeployed (Deploy → Manage deployments → ✏️ → New version).');
    }
    // Sync succeeded — pull fresh data into the dashboard
    btn.innerHTML = '<svg class="icn" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>Synced';
    if((json.failed||[]).length || (json.continuing||[]).length){
      alert('Synced: '+(json.synced||[]).join(', ')
        +((json.failed||[]).length?'\nFailed: '+json.failed.join(' | '):'')
        +((json.continuing||[]).length?'\nStill syncing in the background (ready in ~2 min): '+json.continuing.join(', '):''));
    }
    await new Promise(function(r){ setTimeout(r, 600); });
    init(); // re-fetches the sheet
  } catch(err){
    btn.innerHTML = '<svg class="icn" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>Failed';
    console.error('[manualSync]', err);
    alert('Sync failed: ' + err.message);
    init(cur);                            // take the loading bar down and show the data again
  } finally {
    setTimeout(function(){ btn.innerHTML = origHTML; btn.disabled = false; }, 1500);
  }
}
document.getElementById('syncNowBtn').addEventListener('click', triggerManualSync);

// ── Snapshot / Re-snapshot button ──
// Freezes the currently-selected sprint into "Sprint Snapshots" using the
// latest Jira data. If the sprint is already frozen it REFRESHES it — handy
// when the automatic Monday-freeze fired during a holiday, before the team
// finished logging time, so the snapshot is missing that work.
// Server side: action=snapshotSprint → manualSnapshotSprint() in Code.gs.
async function triggerSnapshot(){
  var btn = document.getElementById('snapBtn');
  if(!btn || btn.disabled) return;
  if(!cur){ alert('No sprint selected.'); return; }
  if(!confirm('Snapshot sprint "'+cur+'"?\n\n'+
              'This freezes its data using the latest Jira numbers. '+
              'If it is already snapshotted, it will be refreshed with the newest data.\n\n'+
              'Note: a frozen sprint stops receiving live updates from future syncs.')) return;
  var origHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<svg class="icn spinning" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3.84-7.39"/></svg>Snapshotting…';
  try{
    var url = API + '?action=snapshotSprint&sprintId=' + encodeURIComponent(cur) +
              '&email=' + encodeURIComponent(window._userEmail||'') + tok() + '&_cb=' + Date.now();
    console.log('[snapshot] hitting URL:', url);
    var res = await fetch(url, { method:'GET', redirect:'follow' });
    var txt = await res.text();
    console.log('[snapshot] raw response (first 300 chars):', txt.slice(0, 300));
    var json;
    try { json = JSON.parse(txt.trim()); }
    catch(e){ throw new Error('Invalid response from server'); }
    if(json.error) throw new Error(json.message || json.error);
    if(!json.ok){
      var keys = Object.keys(json).slice(0, 5).join(', ');
      throw new Error('No ok flag. Response keys: ' + keys + '. Likely: Apps Script not redeployed (Deploy → Manage deployments → ✏️ → New version).');
    }
    btn.innerHTML = '<svg class="icn" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>'+(json.refreshed?'Refreshed':(json.kept?'Kept':'Snapshotted'));
    if(json.message){ console.log('[snapshot]', json.message); }
    if(json.kept){ alert(json.message); } // Jira had no live data — old snapshot kept
    await new Promise(function(r){ setTimeout(r, 700); });
    init(); // re-fetch so the (re)snapshot is what we now display
  } catch(err){
    btn.innerHTML = '<svg class="icn" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>Failed';
    console.error('[snapshot]', err);
    alert('Snapshot failed: ' + err.message);
  } finally {
    setTimeout(function(){ btn.innerHTML = origHTML; btn.disabled = false; }, 1800);
  }
}
document.getElementById('snapBtn').addEventListener('click', triggerSnapshot);

// ── AUTH FLOW ──
function showLoginScreen(){
  document.getElementById('loginScreen').style.display='flex';
  document.getElementById('dashboardView').style.display='none';
  setTimeout(function(){
    var ie=document.getElementById('loginEmail');
    if(ie) ie.focus();
  },50);
}

function showDashboard(name){
  document.getElementById('loginScreen').style.display='none';
  document.getElementById('dashboardView').style.display='flex';
  var displayName = name || window._userEmail;
  document.getElementById('userName').textContent = displayName;
  document.getElementById('userRole').textContent = window._userRole || 'Viewer';
  var avatarEl = document.getElementById('userAvatar');
  if(avatarEl) avatarEl.textContent = displayName.charAt(0).toUpperCase();
  // Hide users nav for non-admin
  var usersNav = document.getElementById('nav-users');
  if(usersNav){
    if((window._userRole||'').toLowerCase() === 'admin') usersNav.removeAttribute('data-hidden');
    else usersNav.setAttribute('data-hidden', '1');
  }
  // Apply saved theme
  applyTheme(localStorage.getItem('themePref') || 'dark');
  // Restore sidebar collapsed state
  if(localStorage.getItem('sidebarCollapsed') === '1' && window.innerWidth > 860){
    document.getElementById('sidebar').classList.add('collapsed');
    syncSidebarToggle();
  }
  // Setup sidebar click handlers
  setupSidebar();
  loadSpaceNames();
  init();
}

function logoutUser(){
  localStorage.removeItem('dashUser');
  clearDashCache();                       // don't leave sprint data in this browser
  window._userEmail = null;
  showLoginScreen();
}

async function tryLogin(email, token){
  var btn=document.getElementById('loginBtn');
  var errEl=document.getElementById('loginErr');
  errEl.classList.remove('show');
  btn.disabled=true; btn.textContent='Checking...';

  // Set the token first so checkAccess (which also requires it) goes through.
  window._accessToken = token;

  try {
    var url = API + '?action=checkAccess&email=' + encodeURIComponent(email) + tok();
    var res = await fetch(url, {method:'GET', redirect:'follow'});
    var txt = await res.text();
    var json = JSON.parse(txt.trim());
    if(json.error === 'unauthorized'){
      window._accessToken = null;
      errEl.textContent = 'Invalid access key. Please check the team key and try again.';
      errEl.classList.add('show');
    } else if(json.allowed){
      localStorage.setItem('dashUser', JSON.stringify({
        email: email, name: json.name, role: json.role, token: token, ts: Date.now()
      }));
      window._userEmail = email;
      window._userName = json.name;
      window._userRole = json.role;
      showDashboard(json.name);
    } else {
      errEl.textContent = 'Access denied. This email is not on the allowed list. Please contact your admin to be added.';
      errEl.classList.add('show');
    }
  } catch(e) {
    errEl.textContent = 'Error: ' + e.message + '. Check that the Web App is deployed correctly.';
    errEl.classList.add('show');
  } finally {
    btn.disabled=false; btn.textContent='Continue';
  }
}

// Login button
document.getElementById('loginBtn').addEventListener('click', function(){
  var email = document.getElementById('loginEmail').value.trim().toLowerCase();
  var token = document.getElementById('loginToken').value.trim();
  var errEl=document.getElementById('loginErr');
  if(!email || email.indexOf('@') === -1){
    errEl.textContent='Please enter a valid email address.';
    errEl.classList.add('show');
    return;
  }
  // Team access key paused — email-only login (token stays '' and is ignored).
  tryLogin(email, token);
});
// Enter key to submit (from either field)
['loginEmail','loginToken'].forEach(function(id){
  document.getElementById(id).addEventListener('keydown', function(e){
    if(e.key === 'Enter'){
      document.getElementById('loginBtn').click();
    }
  });
});

// ── PDF EXPORT ──
function openPdfModal(){
  document.getElementById('pdfModal').classList.add('on');
}
function closePdfModal(){
  document.getElementById('pdfModal').classList.remove('on');
}

function generatePDF(){
  var scope = document.querySelector('input[name="pdfScope"]:checked').value;
  closePdfModal();

  // Collapse sections based on scope
  applyPdfScope(scope);

  // Inject sprint info header for print
  injectPrintHeader();

  // Switch to light mode for better PDF quality (save user preference)
  var wasLight = !isDark;
  if(isDark){
    isDark=false;
    document.getElementById('root').classList.add('light');
    document.getElementById('thBtn').textContent='Dark mode';
    if(raw) render(process(raw,cur));
  }

  // Wait for charts to re-render then print
  setTimeout(function(){
    window.print();
    // After print dialog closes, restore
    setTimeout(function(){
      removePdfScope();
      removePrintHeader();
      if(!wasLight){
        isDark=true;
        document.getElementById('root').classList.remove('light');
        document.getElementById('thBtn').textContent='Light mode';
        if(raw) render(process(raw,cur));
      }
    }, 500);
  }, 600);
}

function applyPdfScope(scope){
  // Section IDs/selectors to show/hide per scope
  var allSections = document.querySelectorAll('.sec, #goalsS, #sprintGoalBox, #impactS, #subS, #bugsS, #carryS, #backlogS, #perfS, #eS, #retroS, #starsS, #drainS, .g2, .krow, .sp-card');

  if(scope === 'summary'){
    // Hide: burndown, area, individual, scope, effort, impact, spillovers, subtasks, bugs, assignee charts, early, retro
    var hide = ['#bC', '#aC', '#indvC', '#scB', '#dC', '#impactS', '#carryS', '#backlogS', '#subS', '#bugsS', '#cC', '#eS', '#retroS', '#starsS', '#drainS'];
    hide.forEach(function(sel){
      var el = document.querySelector(sel);
      if(el){
        var card = el.closest('.cc') || el.closest('.g2') || el;
        card.setAttribute('data-pdf-hidden', '1');
        card.style.display='none';
      }
    });
    // Also hide "sec" headers for hidden sections
    var secsToHide = ['Burndown', 'Time logs', 'Spillovers', 'Subtask breakdown', 'Bugs and polish', 'Early completions', 'Sprint retrospective'];
    document.querySelectorAll('.sec').forEach(function(s){
      secsToHide.forEach(function(h){
        if(s.textContent.indexOf(h) !== -1){
          s.setAttribute('data-pdf-hidden', '1');
          s.style.display='none';
        }
      });
    });
  } else if(scope === 'retro'){
    // Keep only: sprint goal + retrospective + sprint progress header
    var keepSecs = ['Sprint goal', 'Sprint retrospective'];
    document.querySelectorAll('.sec').forEach(function(s){
      var keep = false;
      keepSecs.forEach(function(k){ if(s.textContent.indexOf(k) !== -1) keep = true; });
      if(!keep){
        s.setAttribute('data-pdf-hidden', '1');
        s.style.display='none';
      }
    });
    // Hide everything else
    var hideSelectors = ['.krow', '.sp-card', '.cc', '.g2', '.early-grid', '#starsS', '#drainS', '#perfS'];
    hideSelectors.forEach(function(sel){
      document.querySelectorAll(sel).forEach(function(el){
        // Don't hide if it's the sprint goal or retro container
        if(el.id === 'sprintGoalBox' || el.id === 'retroS') return;
        if(el.querySelector && (el.querySelector('#sprintGoalBox') || el.querySelector('#retroS'))) return;
        el.setAttribute('data-pdf-hidden', '1');
        el.style.display='none';
      });
    });
  }
  // Full: don't hide anything
}

function removePdfScope(){
  document.querySelectorAll('[data-pdf-hidden]').forEach(function(el){
    el.style.display='';
    el.removeAttribute('data-pdf-hidden');
  });
}

function injectPrintHeader(){
  // Add a visible sprint info block that shows in PDF
  var existing = document.getElementById('pdfHeader');
  if(existing) existing.remove();
  var sel = document.getElementById('spSel');
  var sprintText = sel && sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : cur;
  var userName = window._userName || window._userEmail || '';
  var hdr = document.createElement('div');
  hdr.id = 'pdfHeader';
  hdr.className = 'pdf-sprint-info';
  hdr.style.cssText = 'display:none;padding:10px 0;border-bottom:1px solid #ccc;margin-bottom:14px';
  hdr.innerHTML = '<div style="font-size:16px;font-weight:600;color:#000">Sprint Report — ' + sprintText + '</div>'
    + '<div style="font-size:11px;color:#555;margin-top:3px">Exported by ' + userName + ' on ' + new Date().toLocaleString() + ' · Playspare · ' + spaceName() + '</div>';
  var brand = document.querySelector('.brand');
  if(brand) brand.parentNode.insertBefore(hdr, brand.nextSibling);
}

function removePrintHeader(){
  var hdr = document.getElementById('pdfHeader');
  if(hdr) hdr.remove();
}

// Close modal on outside click
document.getElementById('pdfModal').addEventListener('click', function(e){
  if(e.target === this) closePdfModal();
});

// PDF button handler
document.getElementById('pdfBtn').addEventListener('click', openPdfModal);
