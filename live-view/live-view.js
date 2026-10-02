/* Live View — sprint header + countdown, Total work / Work left / Time left /
   Hours behind, Jira burndown (guideline · remaining · time spent · non-working
   days) with a "Day N · behind ideal" marker, and the status donut.
     Total work   = remaining estimate at sprint start (Jira burndown)
     Work left    = remaining estimate now (Jira burndown)
     Time left    = working days left × daily hours of the people in the sprint
                    (Team Capacity, 6h when someone isn't listed)
     Hours behind = work left − time left
   Without Jira burndown data the sprint estimate / logged hours are used. */
var _lvTimer=null;
var LV_STATUS_COLORS={'done':'#3ecf8e','to do':'#4c8df6','in progress':'#fdd33c','in review':'#e5484d','paused':'#9d6bf7'};
// Donut + legend order: Done, To Do, In Progress, In Review, Paused, then any other status.
var LV_STATUS_ORDER=['done','to do','in progress','in review','paused'];
// Any other Jira status (not one of the five above) gets the next colour here.
var LV_EXTRA_COLORS=['#22c4c4','#5b6ef5','#ff8fab','#0aaa62','#ffc56b','#d98a0b'];

function lvMonDay(v, pkt){
  var x=v instanceof Date?v:pd(v);
  return x?x.toLocaleDateString('en-US',pkt?{month:'short',day:'2-digit',timeZone:'Asia/Karachi'}:{month:'short',day:'2-digit'}).toUpperCase():'—';
}

// Live View uses Pakistan time (server-corrected clock, see nowMs in core.js)
// for "today", so a TV with the wrong time / timezone still shows the right
// sprint day, days left and midnight switch.
function lvToday(){
  var p=new Date(nowMs()+5*36e5);   // PKT = UTC+5, no DST
  return new Date(p.getUTCFullYear(),p.getUTCMonth(),p.getUTCDate());
}
// Fully elapsed working days before today (same rule as the space's dDone).
function lvDaysDone(d){
  var sp=d.spInfo||{}, sd=pd(sp.start), ed=pd(sp.end), tot=d.dTot||0, today=lvToday();
  if(!sd||!ed) return d.dDone||0;
  sd=new Date(sd.getFullYear(),sd.getMonth(),sd.getDate()); ed=new Date(ed.getFullYear(),ed.getMonth(),ed.getDate());
  if(today<=sd) return 0;
  if(today>ed) return tot;
  var prev=new Date(today); prev.setDate(prev.getDate()-1);
  return Math.min(tot, sprintWorkingDayCount(sd, prev));
}
function lvHrs(v,unit){ return Math.round(v||0)+(unit||' hrs'); }

// TV screens (same query as the TV block in live-view.css): canvas text on the
// charts is scaled like the CSS, i.e. desktop px × (screen width ÷ 1920).
var LV_TV_MQ='(min-width:861px) and (max-width:1919px) and (orientation:landscape) and (min-height:450px)';
function lvK(){ return (window.matchMedia && window.matchMedia(LV_TV_MQ).matches) ? window.innerWidth/1920 : 1; }

// Working days left (today included while it is a sprint day) × Σ daily hours of the sprint's people.
function lvTimeLeft(d){
  var daysLeft=Math.max(0,(d.dTot||0)-lvDaysDone(d));
  var cap={};
  Object.keys(d.teamCapacity||{}).forEach(function(k){ var c=d.teamCapacity[k]; cap[normPersonName(c.name||k)]=parseFloat(c.hours)||6; });
  var perDay=(d.assignees||[]).filter(function(a){ return a && a.n && a.n!=='Unassigned'; })
    .reduce(function(s,a){ var h=cap[normPersonName(a.n)]; return s+(h!=null?h:6); },0);
  return daysLeft*perDay;
}

function lvCountdown(d){
  if(_lvTimer){ clearInterval(_lvTimer); _lvTimer=null; }
  var sp=d.spInfo||{}, end=sp.endIso?new Date(sp.endIso):null;
  if(!end||isNaN(end)){ var e2=pd(sp.end); if(e2) end=new Date(e2.getFullYear(),e2.getMonth(),e2.getDate(),23,59,59); }
  var el=document.getElementById('lvCount'), lb=document.getElementById('lvCountL');
  if(!el) return;
  var day=lvToday().getTime();
  function tick(){
    if(!document.body.contains(el)){ clearInterval(_lvTimer); _lvTimer=null; return; }
    // New day (past midnight PKT): recount sprint day / days left / time left
    // straight away instead of waiting for the next sync.
    var today=lvToday().getTime();
    if(today!==day){
      day=today;
      if(currentPage==='live' && raw && cur){ clearInterval(_lvTimer); _lvTimer=null; render(process(raw,cur)); return; }
    }
    var ms=end?Math.max(0,end.getTime()-nowMs()):0;
    var dd=Math.floor(ms/864e5), hh=Math.floor(ms%864e5/36e5), mm=Math.floor(ms%36e5/6e4);
    // LINE Seed Sans has proportional digits only, so each digit gets a fixed-width
    // box — the countdown doesn't shift sideways when a digit changes.
    var txt=String(dd).padStart(2,'0')+'D '+String(hh).padStart(2,'0')+':'+String(mm).padStart(2,'0');
    el.innerHTML=txt.replace(/\d/g,'<span class="dg">$&</span>');
    el.parentNode.classList.toggle('ended',ms<=0);
    if(lb) lb.textContent=(sp.state==='closed'||sp.completed)?'Sprint completed':(ms<=0?'Sprint ended':'Time Remaining');
    if(ms<=0 && _lvTimer){ clearInterval(_lvTimer); _lvTimer=null; }
  }
  tick(); if(end && end.getTime()>nowMs()) _lvTimer=setInterval(tick,1000);
}

// Right padding the burndown needs so the ideal-gap label fits beside the latest
// point without being pushed back over the lines (6px when it already fits).
function lvLabelRoom(ch, last, B, gap, unit, k){
  if(B.notStarted || !ch || !ch.ctx) return 6;
  var txt=gap>0.5?'+'+Math.round(gap)+unit.trim()+' BEHIND IDEAL':(gap<-0.5?Math.round(-gap)+unit.trim()+' AHEAD OF IDEAL':'ON IDEAL');
  k=k||lvK();
  ch.ctx.save(); ch.ctx.font='800 '+Math.round(23*k)+'px '+LV_FONT; var pw=ch.ctx.measureText(txt).width+24*k; ch.ctx.restore();
  var f=Math.max(0.01,Math.min(1,(last[0]-B.start)/Math.max(1,B.end-B.start)));
  var W=ch.width, axis=70*k, A=W-axis;            // ≈ y-axis label width on the left
  // Point sits at axis + f·(A − r); label needs point + 6 + pw ≤ W − 4.
  var r=(axis+f*A+10+pw-W)/f;
  return Math.max(6, Math.ceil(r)+8);
}

// Jira-style burndown in the Live View look. Returns the ideal remaining now.
// opt (quarter panels): {canvas, key, scale} — draw into another canvas, keep
// the chart under CH[key], text × scale, no hover pop-up.
function lvBurn(B, dayNo, opt){
  opt=opt||{};
  var cid=opt.canvas||'lvC', key=opt.key||'lv';
  if(CH[key]) CH[key].destroy();
  var c=cc(), unit=B.unit==='h'?'h':' pts', pts=B.p;
  var nw=(B.nw||[]).slice().sort(function(a,b){return a[0]-b[0];});
  var startVal=pts[0][1], total=B.end-B.start, off=nw.reduce(function(a,r){return a+(r[1]-r[0]);},0), work=Math.max(1,total-off);
  function workedTo(t){ var w=Math.min(t,B.end)-B.start; nw.forEach(function(r){ if(r[0]<t) w-=Math.min(t,r[1])-r[0]; }); return Math.max(0,w); }
  function idealAt(t){ return startVal*(1-workedTo(t)/work); }
  var gT=[B.start]; nw.forEach(function(r){gT.push(r[0],r[1]);}); gT.push(B.end);
  var guide=gT.map(function(t){ return {x:t,y:Math.round(idealAt(t)*100)/100}; });
  var rem=pts.map(function(x){return {x:x[0],y:x[1]};}), spent=pts.map(function(x){return {x:x[0],y:x[2]};});
  var last=pts[pts.length-1], gap=last[1]-idealAt(last[0]);
  var font=LV_FONT, k=lvK()*(opt.scale||1);
  var shade={id:'lvShade',beforeDatasetsDraw:function(ch){ var a=ch.chartArea,x=ch.scales.x,ctx=ch.ctx; ctx.save(); ctx.fillStyle=isDark?'rgba(150,160,220,.07)':'rgba(0,0,0,.05)';
    nw.forEach(function(r){ var x0=Math.max(a.left,x.getPixelForValue(r[0])), x1=Math.min(a.right,x.getPixelForValue(r[1])); if(x1>x0) ctx.fillRect(x0,a.top,x1-x0,a.bottom-a.top); }); ctx.restore(); }};
  // "DAY N" chip above the latest point, "+Xh BEHIND IDEAL" pill to its right.
  var marker={id:'lvMarker',afterDatasetsDraw:function(ch){
    if(B.notStarted) return;
    var ctx=ch.ctx, px=ch.scales.x.getPixelForValue(last[0]), py=ch.scales.y.getPixelForValue(last[1]), a=ch.chartArea;
    function pill(txt, x, y, bg, bd, fg, size){
      size=Math.round(size*k);
      ctx.font='800 '+size+'px '+font;
      var w=ctx.measureText(txt).width+24*k, h=size+16*k;
      // May use the chart's right margin (up to the canvas edge) so it stays clear
      // of the lines; only pushed left when even that isn't enough.
      if(x+w>ch.width-4) x=ch.width-4-w;
      if(y<a.top) y=a.top;
      if(y+h>a.bottom-2) y=a.bottom-2-h;   // stay above the date labels (e.g. when 0h is left)
      ctx.beginPath(); ctx.roundRect(x,y,w,h,6*k); ctx.fillStyle=bg; ctx.fill();
      if(bd){ ctx.lineWidth=1.5; ctx.strokeStyle=bd; ctx.stroke(); }
      ctx.fillStyle=fg; ctx.textBaseline='middle'; ctx.fillText(txt,x+12*k,y+h/2+1);
      return {x:x,y:y,w:w,h:h};
    }
    ctx.save();
    var behind=gap>0.5, ahead=gap<-0.5;
    var txt=behind?'+'+Math.round(gap)+unit.trim()+' BEHIND IDEAL':(ahead?Math.round(-gap)+unit.trim()+' AHEAD OF IDEAL':'ON IDEAL');
    var col=behind?'#f05252':'#18c97a';
    var fg=behind?(isDark?'#ffd0d0':'#b42323'):(isDark?'#8ff0c2':'#0a7a48');
    var p=pill(txt, px+6*k, py-19*k, behind?'rgba(240,82,82,.22)':'rgba(24,201,122,.2)', col, fg, 23);
    // "DAY N" sits above the pill; below it when there is no room at the top.
    var dayH=(20+16)*k, dayY=p.y-dayH-8*k;
    if(dayY<a.top) dayY=p.y+p.h+8*k;
    pill('DAY '+dayNo, p.x, dayY, isDark?'rgba(150,160,220,.28)':'rgba(0,0,0,.12)', null, isDark?'#fff':'#1a1d2e', 20);
    ctx.restore();
  }};
  var tick={color:c.text,font:{family:font,size:Math.round(17*k),weight:'800'}};   // axis numbers / dates: ExtraBold
  // Zoomed in: the y axis stops just above the highest value instead of the next big round number.
  var topVal=Math.max(startVal, Math.max.apply(null,pts.map(function(x){return Math.max(x[1]||0,x[2]||0);})));
  var yStep=topVal>400?50:(topVal>150?25:(topVal>40?10:5));
  var yMax=Math.max(yStep, Math.ceil(topVal*1.04/yStep)*yStep);
  // Hover: a thin line at the cursor + a dot on each line at that moment
  // (the pop-up itself is HTML, see lvBurnHover).
  var hoverLine={id:'lvHover',afterDatasetsDraw:function(ch){
    var h=ch._lvHover; if(!h) return;
    var ctx=ch.ctx, a=ch.chartArea, x=ch.scales.x.getPixelForValue(h.t);
    ctx.save();
    ctx.strokeStyle=isDark?'rgba(255,255,255,.35)':'rgba(0,0,0,.3)'; ctx.lineWidth=1; ctx.setLineDash([3,3]);
    ctx.beginPath(); ctx.moveTo(x,a.top); ctx.lineTo(x,a.bottom); ctx.stroke(); ctx.setLineDash([]);
    h.rows.forEach(function(r){ if(r.v==null) return; ctx.beginPath(); ctx.arc(x, ch.scales.y.getPixelForValue(r.v), 4.5, 0, Math.PI*2); ctx.fillStyle=r.c; ctx.fill(); ctx.lineWidth=2; ctx.strokeStyle='#000'; ctx.stroke(); });
    ctx.restore();
  }};
  CH[key]=new Chart(document.getElementById(cid),{type:'line',plugins:[shade,marker,hoverLine],data:{datasets:[
    {label:'Guideline',data:guide,borderColor:'#4d7cff',borderDash:[7,6],borderWidth:2.5,pointRadius:0,pointHoverRadius:0,fill:false,tension:0},
    {label:'Remaining Values',data:rem,borderColor:'#f05252',backgroundColor:'rgba(240,82,82,.14)',fill:'origin',borderWidth:2.5,pointRadius:0,pointHoverRadius:0,stepped:'after'},
    {label:'Time Spent',data:spent,borderColor:'#18c97a',borderWidth:2.5,pointRadius:0,pointHoverRadius:0,stepped:'after',fill:false}
  ]},options:{responsive:true,maintainAspectRatio:false,parsing:false,animation:false,
    // Keep room on the right for the "BEHIND / AHEAD OF IDEAL" label next to the latest point.
    layout:{padding:function(c){ return {top:4,right:lvLabelRoom(c.chart, last, B, gap, unit, k)}; }},
    events:[],                                  // hover is handled by lvBurnHover (cursor-following pop-up)
    plugins:{legend:{display:false},tooltip:{enabled:false}},
    scales:{
      x:{type:'linear',min:B.start,max:B.end,grid:{display:false},border:{display:false},
        ticks:Object.assign({stepSize:3*864e5,maxRotation:0,callback:function(v){ return lvMonDay(new Date(v), true); }},tick)},
      y:{beginAtZero:true,max:yMax,grid:{color:c.grid},border:{display:false},
        ticks:Object.assign({maxTicksLimit:8,callback:function(v){ return v?Math.round(v)+unit.trim():''; }},tick)}}}});
  if(key==='lv'){
    // Everything the hover pop-up needs to work out the values at any moment.
    CH.lv._lvData={pts:pts, idealAt:idealAt, unit:unit, start:B.start, end:B.end};
    lvBindBurnHover(document.getElementById(cid));
  }
  return {start:startVal, left:last[1], unit:unit};
}

// Burndown pop-up: follows the cursor across the whole chart and shows, for the
// exact moment under it, the guideline (interpolated), the remaining estimate
// and the time spent (last known values; blank after the latest sync).
function lvBindBurnHover(canvas){
  if(!canvas || canvas._lvHoverBound) return;
  canvas._lvHoverBound=true;
  canvas.addEventListener('mousemove',function(e){ lvBurnHover(e); });
  canvas.addEventListener('mouseleave',function(){ lvBurnHover(null); });
}
function lvStepAt(pts, t, k){
  // value of column k at time t (stepped: last point at or before t)
  if(!pts.length || t<pts[0][0]) return null;
  if(t>pts[pts.length-1][0]) return null;
  var lo=0, hi=pts.length-1;
  while(lo<hi){ var mid=(lo+hi+1)>>1; if(pts[mid][0]<=t) lo=mid; else hi=mid-1; }
  return pts[lo][k];
}
function lvBurnHover(e){
  var tip=document.getElementById('lvBTooltip'), ch=CH.lv;
  function hide(){ if(tip) tip.classList.remove('show'); if(ch && ch._lvHover){ ch._lvHover=null; ch.draw(); } }
  if(!e || !ch || !ch._lvData) return hide();
  var rect=ch.canvas.getBoundingClientRect(), a=ch.chartArea, mx=e.clientX-rect.left, my=e.clientY-rect.top;
  if(mx<a.left-2 || mx>a.right+2 || my<a.top-2 || my>a.bottom+2) return hide();
  var D=ch._lvData, t=Math.max(D.start, Math.min(D.end, ch.scales.x.getValueForPixel(mx)));
  var u=D.unit, rows=[
    {l:'Guideline', c:'#4d7cff', v:Math.max(0,D.idealAt(t)), s:u},
    {l:'Remaining Values', c:'#f05252', v:lvStepAt(D.pts,t,1), s:u},
    {l:'Time Spent', c:'#18c97a', v:lvStepAt(D.pts,t,2), s:'h'}
  ];
  ch._lvHover={t:t, rows:rows}; ch.draw();
  if(!tip){ tip=document.createElement('div'); tip.id='lvBTooltip'; tip.className='nv-chart-tooltip lv-burn-tip'; document.body.appendChild(tip); }
  tip.style.borderColor='var(--bor)';
  tip.innerHTML='<div class="lv-bt-t">'+new Date(t).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true,timeZone:'Asia/Karachi'})+'</div>'
    +rows.map(function(r){ return '<div class="lv-bt-r"><span class="dot" style="background:'+r.c+'"></span>'+r.l+'<span class="value">'+(r.v==null?'—':rnd(r.v)+(r.s==='h'?'h':r.s.trim()))+'</span></div>'; }).join('');
  tip.classList.add('show');
  var w=tip.offsetWidth, h=tip.offsetHeight, left=e.clientX+18;
  if(left+w>window.innerWidth-8) left=e.clientX-18-w;                          // flip to the left near the right edge
  var top=Math.max(h/2+8, Math.min(window.innerHeight-h/2-8, e.clientY));      // .nv-chart-tooltip is centred on `top`
  tip.style.left=left+'px'; tip.style.top=top+'px';
}


// Live View font (live-view/fonts, see live-view.css). Charts are drawn on a
// canvas, so they are redrawn once the font files have loaded.
var LV_FONT="'LINE Seed Sans',sans-serif";
var _lvFontReady=false;
function lvWhenFontReady(d){
  if(_lvFontReady || !document.fonts || !document.fonts.load) return;
  Promise.all(['400','700','800'].map(function(w){ return document.fonts.load(w+" 16px 'LINE Seed Sans'"); }))
    .then(function(){ _lvFontReady=true; if(currentPage==='live' && window._sprintData===d) doLiveView(d); })
    .catch(function(){});
}

// Donut centre: the total + "TOTAL" are sized from the hole's real size, so the
// block fills the centre (≈70% of the hole's width) on any screen.
function lvSizeCenter(ch){
  var meta=ch && ch.getDatasetMeta(0), arc=meta && meta.data && meta.data[0];
  var v=document.getElementById('lvDTotal'), l=v && v.parentNode.querySelector('.l');
  if(!arc || !v || !arc.innerRadius) return;
  var hole=arc.innerRadius*2, digits=Math.max(1,String(v.textContent).length);
  // Numbers are ~0.62em wide per digit in LINE Seed Sans; aim for ~70% of the hole's width, max ~48% of its height.
  var fs=Math.min(hole*0.70/(digits*0.62), hole*0.48);
  v.style.fontSize=Math.round(fs)+'px';
  if(l){ l.style.fontSize=Math.round(Math.max(13*lvK(), fs*0.24))+'px'; l.style.marginTop=Math.round(fs*0.06)+'px'; l.style.letterSpacing='.04em'; }
}

// ── Slideshow ──
// Team view for 8 min, then the people with an individual burndown (same people
// as the MMS Team page's individual chart) in groups of 4: the screen splits
// into 4 equal quarters, one person each (name, dates, countdown, 4 stat boxes,
// burndown — no donut). Each group shows for 1 min: after 30 s the top row
// slides down while the bottom row slides up (a 3 s slide + fade that is NOT
// counted in the minute, so both halves get a full 30 s), then the next group
// comes in. After the last group it goes back to the team view. The position
// survives the quiet auto-refresh / midnight re-render; leaving Live View resets it.
var LV_MAIN_MS=8*60e3, LV_GROUP_MS=60e3, LV_SWAP_MS=30e3, LV_SWAP_ANIM_MS=3000;   // keep LV_SWAP_ANIM_MS = .lvq-panel transition in live-view.css
var _lvShow={idx:0, start:0, timer:null, swapped:false};   // idx 0 = team, 1..n = groups[idx-1]
function lvPeople(d){
  var B=d && d.burn;
  if(!B || !B.p || !B.p.length || !B.people) return [];
  return Object.keys(B.people).filter(function(n){ return (B.people[n]||[]).length; }).sort();
}
function lvGroups(d){
  var p=lvPeople(d), g=[];
  for(var i=0;i<p.length;i+=4) g.push(p.slice(i,i+4));
  return g;
}
// Group slide = 1 min of viewing + the swap animation (not counted). A group
// of one person doesn't swap, so it stays exactly 1 min.
function lvSlideMs(){
  if(!_lvShow.idx) return LV_MAIN_MS;
  var g=lvGroups(window._sprintData)[_lvShow.idx-1];
  return LV_GROUP_MS + (g && g.length>1 ? LV_SWAP_ANIM_MS : 0);
}
// Time the latest Jira sync finished in Apps Script (Sync Log, sent as
// lastSync), top-right of the donut card, e.g. "3:00 AM" (PKT, 12-hour). It
// moves on with every completed sync (≈ every 10 min), changes or not, as soon
// as the dashboard's 2-min refresh picks it up. lastSync arrives either as a
// date (ISO) or as the Sync Log text "dd MMM yyyy HH:mm" in PKT.
function lvSyncDate(v){
  if(!v) return null;
  var s=String(v), m=s.match(/^(\d{1,2}) (\w{3}) (\d{4}) (\d{1,2}):(\d{2})/);
  if(m){
    var mon=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(m[2]);
    if(mon>=0) return new Date(Date.UTC(+m[3], mon, +m[1], +m[4]-5, +m[5]));   // PKT = UTC+5
  }
  var t=Date.parse(s); return isNaN(t) ? null : new Date(t);
}
function lvSyncTime(){
  var el=document.getElementById('lvSync'); if(!el) return;
  var d=lvSyncDate(raw && raw.lastSync);
  el.textContent=d ? d.toLocaleTimeString('en-US',{timeZone:'Asia/Karachi',hour:'numeric',minute:'2-digit',hour12:true})+' Sync' : '';
}
function lvShowTick(){
  if(currentPage!=='live' || !document.getElementById('page-live')){
    clearInterval(_lvShow.timer); _lvShow.timer=null; _lvShow.idx=0; return;
  }
  var el=Date.now()-_lvShow.start;
  // Group slide, 30 s in: calm slide + fade — the rows glide past each other
  // (3 s) while their contents dim to ~35% and back (CSS .lvq-moving).
  if(_lvShow.idx && !_lvShow.swapped && el>=LV_SWAP_MS){
    _lvShow.swapped=true;
    var q=document.getElementById('lvQuad');
    if(q && !q.classList.contains('lvq-solo')){
      q.classList.add('lvq-moving','swapped');
      setTimeout(function(){ q.classList.remove('lvq-moving'); }, LV_SWAP_ANIM_MS+50);
    }
  }
  if(el < lvSlideMs()) return;
  var d=window._sprintData, n=lvGroups(d).length;
  _lvShow.idx = _lvShow.idx>=n ? 0 : _lvShow.idx+1;
  _lvShow.start=Date.now()+750; _lvShow.swapped=false;   // the 0.75 s fade-out isn't counted in the slide's time
  if(!d) return;
  var boxes=document.querySelectorAll('#page-live .lv-wrap, #page-live .lv-quad');
  if(!boxes.length){ doLiveView(d); return; }
  boxes.forEach(function(b){ b.classList.add('lv-out'); });                  // fade out (0.7s)…
  setTimeout(function(){
    if(currentPage!=='live') return;
    doLiveView(window._sprintData||d);                                        // …redraw while invisible…
    // …and fade in only after the new slide has been painted, so the chart
    // rebuild never happens during the fade.
    requestAnimationFrame(function(){ requestAnimationFrame(function(){
      document.querySelectorAll('#page-live .lv-wrap, #page-live .lv-quad').forEach(function(b){ b.classList.remove('lv-out'); });
    }); });
  }, 750);
}

// Day number = today's sprint day (D1…DN; D0 = planning day).
function lvDayNo(d){
  var sp=d.spInfo||{}, today=lvToday(), sd=pd(sp.start), ed=pd(sp.end), dayNo=0;
  if(sd && today>=new Date(sd.getFullYear(),sd.getMonth(),sd.getDate()+1)) dayNo=Math.min(d.dTot||0,lvDaysDone(d)+1);
  if(ed && today>new Date(ed.getFullYear(),ed.getMonth(),ed.getDate(),23,59,59)) dayNo=d.dTot||0;
  return dayNo;
}

// 4 quarters, one person each: name · dates · countdown, the 4 stat boxes and
// their burndown (smaller chart text). Slots: 0 top-left, 1 top-right,
// 2 bottom-left, 3 bottom-right; fewer than 4 people → the rest stay empty.
// "Last updated: 1 Oct 2026" — the newest Jira "updated" time (any change to
// the issue: status, estimate, worklog, comment, moving it out of the sprint…)
// across all of the person's issues the dashboard has (sprint, sub-tasks, bugs,
// backlog). Jira sends it as "2026-10-01T10:15:30.000+0500" or the Sheet as a date.
function lvPersonUpdated(name){
  var best=0, me=normPersonName(name);
  ['tasks','subtasks','bugsTasks','bugSubtasks','backlogTasks','carriedOver','containers'].forEach(function(k){
    ((raw && raw[k]) || []).forEach(function(t){
      if(!t || !t.updated || normPersonName(t.assignee)!==me) return;
      var ms=Date.parse(String(t.updated).replace(/([+-]\d{2})(\d{2})$/,'$1:$2'));
      if(ms>best) best=ms;
    });
  });
  return best ? 'Last updated: '+new Date(best).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Karachi'}) : '';
}
function lvQuadDestroy(){ for(var i=0;i<4;i++){ if(CH['lvq'+i]){ CH['lvq'+i].destroy(); CH['lvq'+i]=null; } } }
function lvRenderQuad(d, names, dayNo){
  var q=document.getElementById('lvQuad'); if(!q) return;
  lvQuadDestroy();
  var sp=d.spInfo||{}, B=d.burn, unit=B.unit==='h'?' hrs':' pts';
  var daysLeft=Math.max(0,(d.dTot||0)-lvDaysDone(d));
  var stat=function(l,id){ return '<div class="lv-stat"><div class="l"'+(id?' data-k="'+id+'"':'')+'>'+l+'</div><div class="v"></div></div>'; };
  // Layout by group size: [grid-column, grid-row, row] per person.
  //   4 → 2 × 2 · 3 → two on top + one full-width bottom
  //   2 → one full-width top + one full-width bottom · 1 → one full-width top (no swap)
  var cnt=names.length;
  var place = cnt===1 ? [['1 / -1','1','top']]
    : cnt===2 ? [['1 / -1','1','top'],['1 / -1','2','bottom']]
    : cnt===3 ? [['1','1','top'],['2','1','top'],['1 / -1','2','bottom']]
    : [['1','1','top'],['2','1','top'],['1','2','bottom'],['2','2','bottom']];
  // One progress line across the top of the screen (above the top cards) that
  // fills up over the group's 20 s — stays put when the rows swap.
  var html='<div class="lvq-prog"><i id="lvqProg"></i></div>';
  for(var i=0;i<cnt;i++){
    var n=names[i], pl=place[i];
    html+='<div class="lv-card lvq-panel" data-slot="'+i+'" data-row="'+pl[2]+'" style="grid-column:'+pl[0]+';grid-row:'+pl[1]+'"><div class="lvq-in">'
      +'<div class="lvq-head"><div class="lvq-name">'+escHtml(n)+'</div><div class="lvq-upd">'+escHtml(lvPersonUpdated(n))+'</div></div>'
      +'<div class="lv-stats">'+stat('Total Work')+stat('Work Left To Do')+stat('Left To Do It')+stat('Hours Behind','b')+'</div>'
      +'<div class="lv-chart lvq-chart"><canvas id="lvqC'+i+'"></canvas></div>'
      +'</div></div>';
  }
  // New panels must appear in place (swapped or not) without sliding there.
  q.classList.add('lvq-still');
  q.classList.toggle('lvq-solo', cnt===1);                  // one person: stays put
  q.classList.toggle('swapped', !!_lvShow.swapped && cnt>1);
  q.innerHTML=html;
  void q.offsetWidth;
  q.classList.remove('lvq-still');
  names.forEach(function(n,i){
    var panel=q.querySelector('.lvq-panel[data-slot="'+i+'"]'); if(!panel) return;
    var r=lvBurn(Object.assign({}, B, {p:B.people[n]}), dayNo, {canvas:'lvqC'+i, key:'lvq'+i, scale:.85});
    var timeLeft=daysLeft*lvPersonHours(d, n), behind=r.left-timeLeft;
    var v=panel.querySelectorAll('.lv-stat .v');
    v[0].textContent=lvHrs(r.start,unit); v[1].textContent=lvHrs(r.left,unit); v[2].textContent=lvHrs(timeLeft);
    panel.querySelector('[data-k="b"]').textContent=behind>0?'Hours Behind':'Hours Ahead';
    v[3].textContent=lvHrs(Math.abs(behind)); v[3].className='v '+(behind>0?'bad':'good');
  });
}
// Thin line at the top that fills up until the next slide (team card, or the
// one line above the top cards on a group slide).
function lvSlideProgress(){
  var bar=document.getElementById(_lvShow.idx ? 'lvqProg' : 'lvProg'); if(!bar) return;
  var dur=lvSlideMs(), done=Math.min(1,(Date.now()-_lvShow.start)/dur);
  bar.style.transition='none'; bar.style.width=(done*100)+'%';
  void bar.offsetWidth;
  bar.style.transition='width '+Math.max(0,(1-done)*dur)+'ms linear'; bar.style.width='100%';
}
function lvPersonHours(d, name){
  var h=null;
  Object.keys(d.teamCapacity||{}).forEach(function(k){ var c=d.teamCapacity[k]; if(normPersonName(c.name||k)===normPersonName(name)) h=parseFloat(c.hours)||6; });
  return h!=null?h:6;
}

function doLiveView(d){
  lvWhenFontReady(d);
  var page=document.getElementById('page-live');
  if(!page) return;
  if(!_lvShow.timer){ _lvShow.idx=0; _lvShow.start=Date.now(); _lvShow.swapped=false; _lvShow.timer=setInterval(lvShowTick,1000); }
  var groups=lvGroups(d);
  if(_lvShow.idx>groups.length) _lvShow.idx=0;
  var sp=d.spInfo||{}, dayNo=lvDayNo(d);

  // Group slide: 4 quarters (the team view is hidden while it shows).
  if(_lvShow.idx){
    page.classList.add('lv-quad-on');
    lvRenderQuad(d, groups[_lvShow.idx-1], dayNo);
    lvSlideProgress();
    lvCountdown(d);
    return;
  }
  page.classList.remove('lv-quad-on');
  lvQuadDestroy();

  lvSlideProgress();
  lvSyncTime();
  var titleEl=document.getElementById('lvTitle');
  titleEl.textContent=sp.id||cur;
  titleEl.classList.remove('is-person');
  var capEl=document.getElementById('lvCap');
  if(capEl) capEl.textContent='';
  document.getElementById('lvStart').textContent=lvMonDay(sp.start);
  document.getElementById('lvEnd').textContent=lvMonDay(sp.end);
  lvCountdown(d);

  // Burndown + totals
  var B=d.burn, wrap=document.getElementById('lvChartWrap'), total, left, unit=' hrs';
  if(B && B.p && B.p.length){
    if(!wrap.querySelector('canvas')) wrap.innerHTML='<canvas id="lvC"></canvas>';
    var r=lvBurn(B, dayNo);
    total=r.start; left=r.left; if(B.unit!=='h') unit=' pts';
  } else {
    if(CH.lv){ CH.lv.destroy(); CH.lv=null; }
    wrap.innerHTML='<div class="nv-dt-empty">Jira burndown data is not available for this sprint.</div>';
    total=d.totEst||0; left=Math.max(0,(d.totEst||0)-(d.totLog||0));
  }
  var timeLeft=lvTimeLeft(d), behind=left-timeLeft;
  document.getElementById('lvTotal').textContent=lvHrs(total,unit);
  document.getElementById('lvLeft').textContent=lvHrs(left,unit);
  document.getElementById('lvTime').textContent=lvHrs(timeLeft);
  var bEl=document.getElementById('lvBehind');
  document.getElementById('lvBehindL').textContent=behind>0?'Hours Behind':'Hours Ahead';
  bEl.textContent=lvHrs(Math.abs(behind));
  bEl.className='v '+(behind>0?'bad':'good');

  // Status donut — every work item in the sprint by Jira status (same data as the Overview).
  var m=(window._bpMode==='without' && d.exBP) ? d.exBP : d;
  var so0=m.statusOv||d.statusOv||{rows:[],total:0};
  var rank=function(r){ var i=LV_STATUS_ORDER.indexOf(String(r.name||'').toLowerCase()); return i<0?99:i; };
  var so={total:so0.total, rows:(so0.rows||[]).map(function(r,i){ return {r:r,i:i}; })
    .sort(function(a,b){ return (rank(a.r)-rank(b.r))||(a.i-b.i); }).map(function(x){ return x.r; })};
  var ex=0, cols=so.rows.map(function(row){ return LV_STATUS_COLORS[String(row.name||'').toLowerCase()]||LV_EXTRA_COLORS[ex++ % LV_EXTRA_COLORS.length]; });
  var open=function(i){ var row=so.rows[i]; if(row) nvDetail('Status · '+row.name, row.n+' work item(s)', nvTaskRows(row.items)); };
  window._lvOpen=open;
  document.getElementById('lvDTotal').textContent=so.total||0;
  if(CH.lvD) CH.lvD.destroy();
  var gapCol=getComputedStyle(document.querySelector('#page-live .lv-side')).backgroundColor||'#0b0c0f';
  CH.lvD=new Chart(document.getElementById('lvD'),{type:'doughnut',
    data:{labels:so.rows.map(function(row){return row.name;}),datasets:[{data:so.rows.map(function(row){return row.n;}),
      // Solid slices, cut apart by even gaps in the card colour, with slightly
      // rounded corners — crisp edges, nothing overlapping.
      backgroundColor:cols,hoverBackgroundColor:cols,borderWidth:6,borderColor:gapCol,hoverBorderColor:gapCol,
      spacing:0,borderRadius:7,hoverOffset:0,borderJoinStyle:'round'}]},
    options:{responsive:true,maintainAspectRatio:true,cutout:'58%',animation:false,layout:{padding:8},
      onResize:function(ch){ requestAnimationFrame(function(){ lvSizeCenter(ch); }); },
      onClick:function(e,els){ if(els&&els.length) open(els[0].index); },
      onHover:function(e,els){ if(e.native) e.native.target.style.cursor=els.length?'pointer':'default'; },
      plugins:{legend:{display:false},tooltip:{enabled:false}}}});   // no hover pop-up; click a slice for its list
  lvSizeCenter(CH.lvD);
  document.getElementById('lvLegend').innerHTML=so.rows.map(function(row,i){
    return '<div class="lv-leg" onclick="_lvOpen('+i+')"><span class="sq" style="background:'+cols[i]+'"></span>'
      +'<span class="n">'+escHtml(row.name)+'</span><span class="c">'+row.n+'</span>'
      +'<span class="p" style="color:'+cols[i]+'">'+pc(row.n,so.total)+'%</span></div>';
  }).join('');
}
