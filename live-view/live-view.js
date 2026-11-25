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
var _lvSyncTimer=null;
var LV_STATUS_COLORS={'done':'#3ee8b5','to do':'#f05252','in progress':'#ffe05c','in review':'#4c8df6','paused':'#9d6bf7'};
// Donut + legend order: Done, To Do, In Progress, In Review, Paused, then any other status.
var LV_STATUS_ORDER=['done','to do','in progress','in review','paused'];
// Any other Jira status (not one of the five above) gets the next colour here.
var LV_EXTRA_COLORS=['#22c4c4','#5b6ef5','#ff8fab','#0aaa62','#ffc56b','#d98a0b'];
// My Supermarket Simulator - Delivery: Jira's requested nine-status legend.
var LV_MSSD_STATUS_ORDER=['to do','done','in progress','in review','dev done','paused','build awaiting','cancelled','reopened'];
var LV_MSSD_STATUS_COLORS={
  'to do':'#f05252','done':'#3ee8b5','in progress':'#ffe05c','in review':'#4c8df6',
  'dev done':'#2f9ab8','paused':'#9d6bf7','build awaiting':'#858890',
  'cancelled':'#4c8df6','reopened':'#f05252'
};

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

// Full countdown days left in PKT, excluding Saturdays and Sundays.
function lvCountdownWorkingDays(now, end){
  if(!end) return 0;
  var fullDays=Math.floor(Math.max(0,end.getTime()-now)/864e5), count=0;
  var pkt=new Date(now+5*36e5);
  var day=new Date(Date.UTC(pkt.getUTCFullYear(),pkt.getUTCMonth(),pkt.getUTCDate()));
  for(var i=1;i<=fullDays;i++){
    var next=new Date(day); next.setUTCDate(day.getUTCDate()+i);
    var w=next.getUTCDay();
    if(w!==0&&w!==6) count++;
  }
  return count;
}

// TV screens (same query as the TV block in live-view.css): canvas text on the
// charts is scaled like the CSS, i.e. desktop px × (screen width ÷ 1920).
var LV_TV_MQ='(min-width:861px) and (max-width:1919px) and (orientation:landscape) and (min-height:450px)';
function lvK(){ return document.getElementById('g2App')&&document.getElementById('g2App').classList.contains('g2-fixed-tv')?1:((window.matchMedia&&window.matchMedia(LV_TV_MQ).matches)?window.innerWidth/1920:1); }

// Working days left (today included while it is a sprint day) × Σ daily hours of the sprint's people.
function lvTimeLeft(d){
  var daysLeft=Math.max(0,(d.dTot||0)-lvDaysDone(d));
  var cap={};
  Object.keys(d.teamCapacity||{}).forEach(function(k){ var c=d.teamCapacity[k]; cap[normPersonName(c.name||k)]=parseFloat(c.hours)||6; });
  var perDay=(d.assignees||[]).filter(function(a){ return a && a.n && a.n!=='Unassigned'; })
    .reduce(function(s,a){ var h=cap[normPersonName(a.n)]; return s+(h!=null?h:6); },0);
  return daysLeft*perDay;
}

// Wall-clock hours remaining, using the same sprint end timestamp as the countdown.
function lvWallTimeLeft(d){
  var sp=d.spInfo||{},end=sp.endIso?new Date(sp.endIso):null;
  if(!end||isNaN(end)){var e=pd(sp.end);if(e)end=new Date(e.getFullYear(),e.getMonth(),e.getDate(),23,59,59);}
  return end&&!isNaN(end)?Math.max(0,end.getTime()-nowMs())/36e5:0;
}
function g2TimeHours(v){
  var n=v<10?Math.round(v*10)/10:Math.round(v);
  return n+'<small>hrs</small>';
}

function lvCountdown(d, valueId, labelId){
  if(_lvTimer){ clearInterval(_lvTimer); _lvTimer=null; }
  var sp=d.spInfo||{}, end=sp.endIso?new Date(sp.endIso):null;
  if(!end||isNaN(end)){ var e2=pd(sp.end); if(e2) end=new Date(e2.getFullYear(),e2.getMonth(),e2.getDate(),23,59,59); }
  valueId=valueId||'lvCount'; labelId=labelId||'lvCountL';
  var el=document.getElementById(valueId), lb=document.getElementById(labelId);
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
    var dd=lvCountdownWorkingDays(nowMs(),end), hh=Math.floor(ms%864e5/36e5), mm=Math.floor(ms%36e5/6e4);
    // LINE Seed Sans has proportional digits only, so each digit gets a fixed-width
    // box — the countdown doesn't shift sideways when a digit changes.
    var txt=String(dd).padStart(2,'0')+'D '+String(hh).padStart(2,'0')+':'+String(mm).padStart(2,'0');
    el.innerHTML=valueId==='g2Count'
      ? String(dd).padStart(2,'0')+'<span class="sep">d</span> '+String(hh).padStart(2,'0')+'<span class="sep">:</span>'+String(mm).padStart(2,'0')
      : txt.replace(/\d/g,'<span class="dg">$&</span>');
    if(valueId==='g2Count'){
      var timeCard=document.getElementById('g2Time');if(timeCard)timeCard.innerHTML=g2TimeHours(ms/36e5);
    }
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
function lvBurn(B, dayNo){
  if(CH.lv) CH.lv.destroy();
  var c=cc(), unit=B.unit==='h'?'h':' pts', pts=B.p;
  var nw=(B.nw||[]).slice().sort(function(a,b){return a[0]-b[0];});
  var startVal=pts[0][1], total=B.end-B.start, off=nw.reduce(function(a,r){return a+(r[1]-r[0]);},0), work=Math.max(1,total-off);
  function workedTo(t){ var w=Math.min(t,B.end)-B.start; nw.forEach(function(r){ if(r[0]<t) w-=Math.min(t,r[1])-r[0]; }); return Math.max(0,w); }
  function idealAt(t){ return startVal*(1-workedTo(t)/work); }
  var gT=[B.start]; nw.forEach(function(r){gT.push(r[0],r[1]);}); gT.push(B.end);
  var guide=gT.map(function(t){ return {x:t,y:Math.round(idealAt(t)*100)/100}; });
  var rem=pts.map(function(x){return {x:x[0],y:x[1]};}), spent=pts.map(function(x){return {x:x[0],y:x[2]};});
  var last=pts[pts.length-1], gap=last[1]-idealAt(last[0]);
  var font=LV_FONT, k=lvK();
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
  CH.lv=new Chart(document.getElementById('lvC'),{type:'line',plugins:[shade,marker,hoverLine],data:{datasets:[
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
  // Everything the hover pop-up needs to work out the values at any moment.
  CH.lv._lvData={pts:pts, idealAt:idealAt, unit:unit, start:B.start, end:B.end};
  lvBindBurnHover(document.getElementById('lvC'));
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

// Time the latest Jira sync finished in Apps Script (Sync Log, sent as
// lastSync), top-right of the donut card, e.g. "3:00 AM" (PKT, 12-hour). It
// moves on with every completed sync, changes or not, as soon
// as the dashboard's 2-min refresh picks it up. lastSync arrives either as a
// date (ISO) or as the Sync Log text "dd MMM yyyy HH:mm" in PKT.
function lvSyncDate(v){
  if(!v) return null;
  var s=String(v), m=s.match(/^(\d{1,2}) (\w{3}) (\d{4}) (\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if(m){
    var mon=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(m[2]);
    if(mon>=0) return new Date(Date.UTC(+m[3], mon, +m[1], +m[4]-5, +m[5], +(m[6]||0)));   // PKT = UTC+5
  }
  var t=Date.parse(s); return isNaN(t) ? null : new Date(t);
}
function lvSyncTime(){
  var el=document.getElementById('lvSync'); if(!el) return;
  var d=lvSyncDate(raw && raw.lastSync);
  // The Apps Script trigger runs every 5 minutes. Allow a 1-minute execution
  // buffer, then remain at 00:00 until a successful sync supplies a new
  // lastSync timestamp and restarts this 6-minute timer.
  var step=6*60000;
  var stamp=String(raw && raw.lastSync || ''), deadline=d?d.getTime()+step:0;
  // A newly received sync gets a full six-minute display window. Persist its
  // deadline so reloading the dashboard does not restart that window.
  try {
    var syncKey='lv_sync_countdown:'+(window._space||'MMS');
    var saved=JSON.parse(localStorage.getItem(syncKey)||'null');
    if(saved && saved.stamp===stamp && isFinite(saved.deadline)){
      deadline=Number(saved.deadline);
    } else if(d){
      deadline=saved && saved.stamp ? nowMs()+step : d.getTime()+step;
      localStorage.setItem(syncKey,JSON.stringify({stamp:stamp,deadline:deadline}));
    }
  } catch(e){}
  if(_lvSyncTimer){ clearInterval(_lvSyncTimer); _lvSyncTimer=null; }
  function tick(){
    if(!document.body.contains(el)){ clearInterval(_lvSyncTimer); _lvSyncTimer=null; return; }
    if(!d){
      el.innerHTML='<div class="lv-sync-next">Next Update: —</div><div class="lv-sync-last">Last Updated: —</div>';
      return;
    }
    var now=nowMs(), left=Math.max(0,deadline-now), totalSeconds=Math.ceil(left/1000), mm=Math.floor(totalSeconds/60), ss=totalSeconds%60;
    var timerClass=left>3*60000?'safe':(left>60000?'warning':'due');
    var last=d.toLocaleTimeString('en-US',{timeZone:'Asia/Karachi',hour:'numeric',minute:'2-digit',hour12:true});
    var nextHtml;
    if(now>=deadline+3*60000){
      nextHtml='<div class="lv-sync-next delayed">Update delayed<span class="lv-sync-dots">...</span></div>';
    } else if(now>=deadline){
      nextHtml='<div class="lv-sync-next pending">Update in progress<span class="lv-sync-dots">...</span></div>';
    } else {
      nextHtml='<div class="lv-sync-next">Next Update: <span class="lv-sync-timer '+timerClass+'">'+String(mm).padStart(2,'0')+':'+String(ss).padStart(2,'0')+'</span></div>';
    }
    el.innerHTML=nextHtml
      +'<div class="lv-sync-last">Last Updated: '+last+'</div>';
  }
  tick();
  if(d) _lvSyncTimer=setInterval(tick,1000);
}
// Day number = today's sprint day (D1…DN; D0 = planning day).
function lvDayNo(d){
  var sp=d.spInfo||{}, today=lvToday(), sd=pd(sp.start), ed=pd(sp.end), dayNo=0;
  if(sd && today>=new Date(sd.getFullYear(),sd.getMonth(),sd.getDate()+1)) dayNo=Math.min(d.dTot||0,lvDaysDone(d)+1);
  if(ed && today>new Date(ed.getFullYear(),ed.getMonth(),ed.getDate(),23,59,59)) dayNo=d.dTot||0;
  return dayNo;
}

/* Sprint board (MMS + MSSD) ---------------------------------------------------
   One 1920×1080 composition (scaled to the screen in TV mode). Everything that
   matters sits in the top ~800px; the bottom strip (hidden behind the desk
   monitors on the office TV) only carries the sprint timeline + sync status.
   KPIs: Total work · Work left · Time spent · Hours behind (with trend lines).  */
var _g2ChartArgs=null, _g2ResizeBound=false;
var G2_C={blue:'#6ea8fe',amber:'#f5b942',green:'#3dd68c',rose:'#ff6b81',sky:'#7cc4fa',ink:'#eef0f5',mute:'#8b91a3'};
var G2_COLORS={'done':'#3dd68c','to do':'#ff6b81','in progress':'#f5b942','in review':'#6ea8fe','paused':'#a78bfa'};
// MMS list order on the board.
var G2_STATUS_ORDER=['to do','done','in progress','in review','paused'];
// MSS3D: statuses grouped by stage in the Items by status card (MMS keeps the plain list).
// A status not listed here goes into an extra "Other" group.
var G2_MSSD_GROUPS=[['To start',['to do','reopened']],['Closed',['done','cancelled']],
  ['In flight',['in progress','in review','paused']],['Ready to ship',['dev done','build awaiting']]];
// MSS3D colour tweaks on the board so every status has its own colour.
var G2_MSSD_COLOR_FIX={'dev done':'#22d3ee','cancelled':'#d4a373','reopened':'#ff8fab','build awaiting':'#fb923c'};
var G2_TV_DISPLAY={enabled:true,width:1920,height:1080};
function g2TvEnabled(){return G2_TV_DISPLAY.enabled&&!/[?&]tv=0(?:&|$)/.test(location.search);}
function g2FitTv(){
  var app=document.getElementById('g2App');if(!app||!app.classList.contains('g2-fixed-tv'))return;
  var scale=Math.min(window.innerWidth/G2_TV_DISPLAY.width,window.innerHeight/G2_TV_DISPLAY.height);
  app.style.transform='translate(-50%,-50%) scale('+scale+')';app.style.webkitTransform=app.style.transform;
}
function g2SetupDisplay(){
  var app=document.getElementById('g2App'),root=document.getElementById('root'),on=g2TvEnabled();if(!app)return;
  app.classList.toggle('g2-fixed-tv',on);if(root)root.classList.toggle('g2-fixed-tv-mode',on);
  if(on){app.style.width=G2_TV_DISPLAY.width+'px';app.style.height=G2_TV_DISPLAY.height+'px';g2FitTv();}
  else{app.style.width='';app.style.height='';app.style.transform='';app.style.webkitTransform='';}
  if(!window._g2FitBound){window._g2FitBound=true;window.addEventListener('resize',g2FitTv);}
}
function g2Num(v,unit){ return Math.round(v||0)+'<small>'+(unit==='hrs'?'h':(unit||'h'))+'</small>'; }
function g2Date(v){ var x=v instanceof Date?v:pd(v); return x?x.toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'Asia/Karachi'}):'—'; }

// Last sync + next-update countdown (footer). Same 6-minute window as before.
function g2SyncTime(){
  var state=document.getElementById('g2SyncState'), updated=document.getElementById('g2Updated');
  if(!state||!updated) return;
  var d=lvSyncDate(raw&&raw.lastSync), step=6*60000, stamp=String(raw&&raw.lastSync||''), deadline=d?d.getTime()+step:0;
  try{
    var key='lv_sync_countdown:'+(window._space||'MMS'), saved=JSON.parse(localStorage.getItem(key)||'null');
    if(saved&&saved.stamp===stamp&&isFinite(saved.deadline)) deadline=Number(saved.deadline);
    else if(d){ deadline=saved&&saved.stamp?nowMs()+step:d.getTime()+step; localStorage.setItem(key,JSON.stringify({stamp:stamp,deadline:deadline})); }
  }catch(e){}
  if(_lvSyncTimer){clearInterval(_lvSyncTimer);_lvSyncTimer=null;}
  function tick(){
    if(!document.body.contains(state)){clearInterval(_lvSyncTimer);_lvSyncTimer=null;return;}
    if(!d){state.className='g2-live-pill';state.innerHTML='<span class="g2-pulse"></span>Next update —';updated.textContent='—';return;}
    var now=nowMs(), left=Math.max(0,deadline-now), sec=Math.ceil(left/1000), mm=Math.floor(sec/60), ss=sec%60;
    updated.textContent=d.toLocaleTimeString('en-US',{timeZone:'Asia/Karachi',hour:'numeric',minute:'2-digit',hour12:true});
    if(now>=deadline+3*60000){state.className='g2-live-pill delayed';state.innerHTML='<span class="g2-pulse"></span>Update delayed…';}
    else if(now>=deadline){state.className='g2-live-pill';state.innerHTML='<span class="g2-pulse"></span>Update in progress…';}
    else{state.className='g2-live-pill '+(left>3*60000?'safe':'');state.innerHTML='<span class="g2-pulse"></span>Next update '+String(mm).padStart(2,'0')+':'+String(ss).padStart(2,'0');}
  }
  tick(); if(d)_lvSyncTimer=setInterval(tick,1000);
}

// Ideal (guideline) remaining at time t: straight burn over working time only.
function g2Ideal(B){
  var nw=(B.nw||[]).slice().sort(function(a,b){return a[0]-b[0];}), span=Math.max(1,B.end-B.start), startVal=B.p[0][1];
  var off=nw.reduce(function(s,r){return s+Math.max(0,Math.min(r[1],B.end)-Math.max(r[0],B.start));},0), work=Math.max(1,span-off);
  function workedTo(t){ t=Math.min(Math.max(t,B.start),B.end); var w=t-B.start;
    nw.forEach(function(r){ var a=Math.max(r[0],B.start), b=Math.min(r[1],t); if(b>a) w-=b-a; }); return Math.max(0,w); }
  return function(t){ return Math.max(0,startVal*(1-workedTo(t)/work)); };
}

// Small trend line for a KPI card.
function g2Spark(vals,col){
  vals=(vals||[]).filter(function(v){return isFinite(v);});
  if(vals.length>160){ var k=vals.length/160, s=[]; for(var i=0;i<160;i++) s.push(vals[Math.floor(i*k)]); s.push(vals[vals.length-1]); vals=s; }
  if(vals.length<2) return '';
  var W=340,H=64,lo=Math.min.apply(null,vals),hi=Math.max.apply(null,vals),pad=(hi-lo)*.12+1;lo-=pad;hi+=pad;
  var P=vals.map(function(v,i){return [W*i/(vals.length-1),H-H*(v-lo)/(hi-lo)];});
  var d='M'+P.map(function(p){return p[0].toFixed(1)+','+p[1].toFixed(1);}).join(' L'), id='g2s'+Math.random().toString(36).slice(2,8);
  return '<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none"><defs><linearGradient id="'+id+'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="'+col+'" stop-opacity=".35"/><stop offset="1" stop-color="'+col+'" stop-opacity="0"/></linearGradient></defs>'
    +'<path d="'+d+' L'+W+','+H+' L0,'+H+' Z" fill="url(#'+id+')"/><path d="'+d+'" fill="none" stroke="'+col+'" stroke-width="3" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>';
}

function g2NiceStep(top){
  var c=[5,10,20,25,50,100,200,250,500,1000,2000,5000];
  for(var i=0;i<c.length;i++) if(top*1.08/c[i]<=5) return c[i];
  return c[c.length-1];
}

// Burndown: guideline · remaining · time spent · non-working days, a TODAY
// marker and the "+Xh behind ideal" gap, with the lines labelled directly.
function g2DrawChart(B){
  var el=document.getElementById('g2Chart');if(!el||!B||!B.p||!B.p.length)return;
  var W=el.clientWidth||1120,H=el.clientHeight||360,fs=20,L=70,R=24,T=36,Bm=40,pw=W-L-R,ph=H-T-Bm;
  var pts=B.p,start=B.start,end=B.end,span=Math.max(1,end-start),last=pts[pts.length-1],ideal=g2Ideal(B),unit=B.unit==='h'?'h':' pts';
  var nw=(B.nw||[]).slice().sort(function(a,b){return a[0]-b[0];});
  var top=Math.max(pts[0][1],Math.max.apply(null,pts.map(function(p){return Math.max(p[1]||0,p[2]||0);})));
  var step=g2NiceStep(top),yMax=Math.max(step,Math.ceil(top*1.08/step)*step);
  var X=function(t){return L+(Math.min(Math.max(t,start),end)-start)/span*pw;},Y=function(v){return T+ph-(v||0)/yMax*ph;};
  var uid='g2'+Math.random().toString(36).slice(2,7),s=[];
  s.push('<svg viewBox="0 0 '+W+' '+H+'" width="'+W+'" height="'+H+'"><defs>'
    +'<linearGradient id="'+uid+'r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="'+G2_C.rose+'" stop-opacity=".32"/><stop offset="1" stop-color="'+G2_C.rose+'" stop-opacity=".02"/></linearGradient>'
    +'<linearGradient id="'+uid+'s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="'+G2_C.green+'" stop-opacity=".28"/><stop offset="1" stop-color="'+G2_C.green+'" stop-opacity=".02"/></linearGradient>'
    +'<filter id="'+uid+'sh" x="-20%" y="-40%" width="140%" height="180%"><feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#000" flood-opacity=".55"/></filter></defs>');
  // non-working days
  nw.forEach(function(r){ var x0=X(r[0]),x1=X(r[1]); if(x1-x0<2) return;
    s.push('<rect x="'+x0+'" y="'+T+'" width="'+(x1-x0)+'" height="'+ph+'" fill="#fff" opacity=".035"/>');
    if(x1-x0>80) s.push('<text x="'+((x0+x1)/2)+'" y="'+(T+fs+2)+'" fill="rgba(255,255,255,.33)" font-size="'+(fs*.7)+'" font-weight="700" text-anchor="middle" letter-spacing="3">WEEKEND</text>'); });
  // grid + y labels
  for(var v=0;v<=yMax;v+=step) s.push('<line x1="'+L+'" x2="'+(L+pw)+'" y1="'+Y(v)+'" y2="'+Y(v)+'" stroke="rgba(255,255,255,.08)" stroke-width="1.5"/>'
    +'<text x="'+(L-16)+'" y="'+(Y(v)+fs*.35)+'" fill="rgba(255,255,255,.5)" font-size="'+fs+'" font-weight="600" text-anchor="end">'+v+'</text>');
  // x labels: every 3 days + the last day (PKT)
  var ticks=[],D=864e5; for(var t=start;t<=end;t+=3*D) if(end-t>2.5*D) ticks.push(t); ticks.push(end);
  ticks.forEach(function(t,i){ s.push('<text x="'+X(t)+'" y="'+(T+ph+fs+12)+'" fill="rgba(255,255,255,.62)" font-size="'+fs+'" font-weight="600" text-anchor="'+(i===0?'start':(i===ticks.length-1?'end':'middle'))+'">'
    +new Date(t).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'Asia/Karachi'}).toUpperCase()+'</text>'); });
  // lines and shading are clipped to the plot area so nothing draws past the axes
  s.push('<defs><clipPath id="'+uid+'c"><rect x="'+L+'" y="'+T+'" width="'+pw+'" height="'+ph+'"/></clipPath></defs><g clip-path="url(#'+uid+'c)">');
  // guideline (exact: straight over working time, flat over non-working days)
  var gT=[start]; nw.forEach(function(r){gT.push(r[0],r[1]);}); gT.push(end);
  gT=gT.filter(function(t){return t>=start&&t<=end;}).sort(function(a,b){return a-b;});
  s.push('<path d="M'+gT.map(function(t){return X(t).toFixed(1)+','+Y(ideal(t)).toFixed(1);}).join(' L')+'" fill="none" stroke="'+G2_C.sky+'" stroke-width="3" stroke-dasharray="10 9" opacity=".75"/>');
  // remaining + time spent (stepped, like Jira)
  function stepD(k){ var d=''; pts.forEach(function(p,i){ var x=X(p[0]).toFixed(1),y=Y(p[k]).toFixed(1); d+=i?' H'+x+' V'+y:'M'+x+','+y; }); return d; }
  var rD=stepD(1),sD=stepD(2),x0=X(pts[0][0]),xn=X(last[0]),base=Y(0);
  s.push('<path d="'+rD+' V'+base+' H'+x0+' Z" fill="url(#'+uid+'r)"/><path d="'+sD+' V'+base+' H'+x0+' Z" fill="url(#'+uid+'s)"/>'
    +'<path d="'+rD+'" fill="none" stroke="'+G2_C.rose+'" stroke-width="3.5" stroke-linejoin="round"/>'
    +'<path d="'+sD+'" fill="none" stroke="'+G2_C.green+'" stroke-width="3.5" stroke-linejoin="round"/></g>');
  if(!B.notStarted){
    var iNow=ideal(last[0]),gap=(last[1]||0)-iNow,yR=Y(last[1]),yS=Y(last[2]),yI=Y(iNow);
    // TODAY marker
    s.push('<line x1="'+xn+'" x2="'+xn+'" y1="'+T+'" y2="'+(T+ph)+'" stroke="rgba(255,255,255,.35)" stroke-width="2" stroke-dasharray="4 6"/>');
    var px=Math.max(L+60,Math.min(L+pw-60,xn));
    s.push('<rect x="'+(px-60)+'" y="'+(T-30)+'" width="120" height="'+(fs+18)+'" rx="'+((fs+18)/2)+'" fill="'+G2_C.sky+'"/>'
      +'<text x="'+px+'" y="'+(T-30+(fs+18)/2+fs*.36)+'" fill="#000" font-size="'+fs+'" font-weight="800" text-anchor="middle">TODAY</text>');
    // gap to the guideline
    var behind=gap>0.5,ahead=gap<-0.5,gc=behind?G2_C.rose:G2_C.green;
    var gtxt=behind?'+'+Math.round(gap)+unit.trim():(ahead?Math.round(-gap)+unit.trim():'On ideal'),gsub=behind?' behind ideal':(ahead?' ahead of ideal':'');
    if(behind||ahead) s.push('<line x1="'+xn+'" x2="'+xn+'" y1="'+yR+'" y2="'+yI+'" stroke="'+gc+'" stroke-width="4"/>');
    var bf=fs*1.3,bw=(gtxt.length+gsub.length)*bf*.56+40,bh=bf+30;
    var lf=fs*1.35,remT='Remaining '+Math.round(last[1])+unit.trim(),spT='Spent '+Math.round(last[2]||0)+'h';
    var lw=Math.max(remT.length,spT.length)*lf*.56,pL=L+6,pR=L+pw-6,roomL=xn-pL,roomR=pR-xn,G=24;
    // Pick sides so labels + gap pill always stay inside the plot area:
    // labels left / pill right → labels right / pill left → both right → both left → pill on top.
    var labSide,bx,pillTop=false;
    if(roomL>=lw+G&&roomR>=bw+G){labSide='L';bx=xn+G;}
    else if(roomR>=lw+G&&roomL>=bw+G){labSide='R';bx=xn-G-bw;}
    else if(roomR>=lw+bw+3*G){labSide='R';bx=xn+G+lw+G;}
    else if(roomL>=lw+bw+3*G){labSide='L';bx=xn-G-lw-G-bw;}
    else {labSide=roomR>=roomL?'R':'L';pillTop=true;bx=Math.max(pL,Math.min(pR-bw,xn-bw/2));}
    bx=Math.max(pL,Math.min(pR-bw,bx));
    var by=pillTop?T+bh/2+46:(yR+yI)/2;
    by=Math.max(T+bh/2+4,Math.min(T+ph-bh/2-4,by));
    s.push('<rect x="'+bx+'" y="'+(by-bh/2)+'" width="'+bw+'" height="'+bh+'" rx="'+(bh/2)+'" fill="'+(behind?'#2a0f17':'#0e2419')+'" stroke="'+gc+'" stroke-width="2.5" filter="url(#'+uid+'sh)"/>'
      +'<text x="'+(bx+20)+'" y="'+(by+bf*.36)+'" fill="#fff" font-size="'+bf+'" font-weight="800">'+gtxt+'<tspan fill="'+gc+'" font-weight="700">'+gsub+'</tspan></text>');
    // points + direct labels
    [[yR,G2_C.rose],[yS,G2_C.green],[yI,G2_C.sky]].forEach(function(q){ s.push('<circle cx="'+xn+'" cy="'+q[0]+'" r="9" fill="#000" stroke="'+q[1]+'" stroke-width="4"/>'); });
    // Remaining label under its point, Spent label above its point — moved below
    // the Spent point if the two would overlap; both kept inside the plot area.
    var lx=labSide==='L'?Math.max(pL+lw,xn-20):Math.min(pR-lw,xn+20),la=labSide==='L'?'end':'start',yTop=T+lf+4,yBot=T+ph-8;
    var ly1=Math.max(yTop,Math.min(yBot,yR+lf+16)),ly2=yS-18;
    if(Math.abs(ly2-ly1)<lf*1.25) ly2=yS+lf+16;
    if(Math.abs(ly2-ly1)<lf*1.25) ly2=ly1+lf*1.25;
    ly2=Math.max(yTop,Math.min(yBot,ly2));
    if(Math.abs(ly2-ly1)<lf*1.25) ly1=ly2-lf*1.25;
    // Dark outline in a deep shade of each line's colour, set inline so app-wide styles can't strip it.
    function halo(dark){ return '" stroke="'+dark+'" stroke-width="8" stroke-linejoin="round" paint-order="stroke" text-anchor="'+la+'" style="stroke:'+dark+'!important;stroke-width:8px!important;paint-order:stroke!important;stroke-linejoin:round">'; }
    s.push('<text x="'+lx+'" y="'+ly1+'" fill="'+G2_C.rose+'" font-size="'+lf+'" font-weight="800'+halo('#3d0a14')+remT+'</text>'
      +'<text x="'+lx+'" y="'+ly2+'" fill="'+G2_C.green+'" font-size="'+lf+'" font-weight="800'+halo('#06301d')+spT+'</text>');
    if(end-last[0]>864e5){ var tl=last[0]+(end-last[0])*.45,ix=Math.min(pR-fs*1.3*3,X(tl)+18),iy=Math.max(yTop,Math.min(yBot,Y(ideal(tl))-20)); s.push('<text x="'+ix+'" y="'+iy+'" fill="'+G2_C.sky+'" font-size="'+(fs*1.3)+'" font-weight="800" stroke="#0a2638" stroke-width="8" stroke-linejoin="round" paint-order="stroke" style="stroke:#0a2638!important;stroke-width:8px!important;paint-order:stroke!important;stroke-linejoin:round">Ideal</text>'); }
  }
  s.push('</svg>');
  el.innerHTML=s.join('');
}

function doGlow2Live(d){
  if(CH.lv){CH.lv.destroy();CH.lv=null;}if(CH.lvD){CH.lvD.destroy();CH.lvD=null;}
  g2SetupDisplay();
  var $=function(id){return document.getElementById(id);};
  var sp=d.spInfo||{},dayNo=lvDayNo(d),title=sp.id||cur;
  if(window._space==='MSSD') title=String(title||'').replace(/^MSSD\s+/i,'');
  $('g2Title').textContent=title||'—';
  $('g2Start').textContent=g2Date(sp.start);$('g2End').textContent=g2Date(sp.end);
  g2SyncTime();lvCountdown(d,'g2Count','g2CountL');

  // Totals (Jira burndown when available, else sprint estimate / logged hours)
  var B=d.burn,hasB=!!(B&&B.p&&B.p.length),unit='hrs',total,left,spent;
  if(hasB){var lp=B.p[B.p.length-1];total=B.p[0][1];left=lp[1];spent=lp[2]||0;if(B.unit!=='h')unit='pts';}
  else{total=d.totEst||0;left=Math.max(0,(d.totEst||0)-(d.totLog||0));spent=d.totLog||0;}
  var ideal=hasB?g2Ideal(B):null,behind=left-lvTimeLeft(d);
  // MMS: Hours behind = Remaining now − Ideal now (matches the burndown gap).
  if(window._space==='MMS'&&hasB) behind=left-ideal(B.p[B.p.length-1][0]);

  // Total work — bar = hours logged vs. estimate (or burned share for points)
  var barPct=unit==='hrs'?(total?spent/total*100:0):(total?(total-left)/total*100:0);
  $('g2Total').innerHTML=g2Num(total,unit);
  $('g2TotalBar').style.width=Math.max(0,Math.min(100,barPct))+'%';
  // Work left
  $('g2Left').innerHTML=g2Num(left,unit);
  $('g2LeftSub').textContent=(total?Math.round(left/total*100):0)+'% of total';
  $('g2LeftSpark').innerHTML=hasB?g2Spark(B.p.map(function(p){return p[1];}),G2_C.amber):'';
  // Time spent
  $('g2Spent').innerHTML=g2Num(spent,'hrs');
  $('g2SpentSub').textContent=unit==='hrs'&&total?Math.round(spent/total*100)+'% of estimate':'logged in Jira';
  $('g2SpentSpark').innerHTML=hasB?g2Spark(B.p.map(function(p){return p[2]||0;}),G2_C.green):'';
  // Hours behind / ahead
  var isBehind=behind>0;
  $('g2Behind').innerHTML=g2Num(Math.abs(behind),'hrs');
  $('g2BehindL').textContent=isBehind?'Hours behind':'Hours ahead';
  $('g2BehindSub').textContent=window._space==='MMS'?(isBehind?'vs. ideal':'ahead of ideal'):'vs. time left';
  $('g2BehindCard').classList.toggle('g2-ahead',!isBehind);
  $('g2BehindSpark').innerHTML=hasB?g2Spark(B.p.map(function(p){return p[1]-ideal(p[0]);}),isBehind?G2_C.rose:G2_C.green):'';

  // Burndown
  if(hasB){_g2ChartArgs=[B];requestAnimationFrame(function(){g2DrawChart(B);});}
  else $('g2Chart').innerHTML='<div class="nv-dt-empty">Jira burndown data is not available for this sprint.</div>';

  // Items by status (same data / order / colours rules as before)
  var m=(window._bpMode==='without'&&d.exBP)?d.exBP:d,so0=m.statusOv||d.statusOv||{rows:[],total:0};
  var statusOrder=window._space==='MSSD'?LV_MSSD_STATUS_ORDER:G2_STATUS_ORDER,statusColors=window._space==='MSSD'?LV_MSSD_STATUS_COLORS:G2_COLORS;
  var rank=function(r){var i=statusOrder.indexOf(String(r.name||'').toLowerCase());return i<0?99:i;},rows=(so0.rows||[]).slice();
  if(window._space==='MSSD'){
    var present={};rows.forEach(function(r){present[String(r.name||'').toLowerCase()]=true;});
    var labels={'to do':'To Do','done':'Done','in progress':'In Progress','in review':'In Review','dev done':'Dev Done','paused':'Paused','build awaiting':'Build Awaiting','cancelled':'Cancelled','reopened':'Reopened'};
    statusOrder.forEach(function(k){if(!present[k])rows.push({name:labels[k]||k,n:0,items:[]});});
  }
  rows=rows.map(function(r,i){return{r:r,i:i};}).sort(function(a,b){return(rank(a.r)-rank(b.r))||(a.i-b.i);}).map(function(x){return x.r;});
  var ex=0,colors=rows.map(function(r){var k=String(r.name||'').toLowerCase();return (window._space==='MSSD'&&G2_MSSD_COLOR_FIX[k])||statusColors[k]||LV_EXTRA_COLORS[ex++%LV_EXTRA_COLORS.length];});
  var statusTotal=so0.total||0,doneRow=rows.filter(function(r){return String(r.name||'').toLowerCase()==='done';})[0]||{name:'Done',n:0};
  var maxN=Math.max.apply(null,rows.map(function(r){return r.n||0;}).concat([1]));
  $('g2StatusTotal').textContent=statusTotal;
  $('g2StatusCard').classList.toggle('g2-compact',rows.length>6);
  window._g2Open=function(i){var r=rows[i];if(r)nvDetail('Status · '+r.name,r.n+' work item(s)',nvTaskRows(r.items));};
  var mssd=window._space==='MSSD';
  $('g2StatusCard').classList.toggle('g2-grouped',mssd);
  if(mssd){
    // Grouped by stage: big group total + split bar + the statuses inside it.
    var at={},used={},groups=[];
    rows.forEach(function(r,i){at[String(r.name||'').toLowerCase()]=i;});
    G2_MSSD_GROUPS.forEach(function(g){var m=g[1].filter(function(k){return at[k]!=null;}).map(function(k){used[at[k]]=1;return at[k];});if(m.length)groups.push({name:g[0],m:m});});
    var other=rows.map(function(r,i){return i;}).filter(function(i){return !used[i];});
    if(other.length) groups.push({name:'Other',m:other});
    $('g2StatusList').innerHTML=groups.map(function(g){
      var tot=g.m.reduce(function(s,i){return s+(rows[i].n||0);},0);
      var nz=g.m.filter(function(i){return rows[i].n>0;}),segs=nz.map(function(i){return '<span class="g2-seg" style="flex:'+rows[i].n+';background:'+colors[i]+'"></span>';}).join('');
      var chips=g.m.map(function(i){var r=rows[i];return '<span class="g2-chip'+(r.n?'':' g2-zero')+'" onclick="_g2Open('+i+')"><span class="sw" style="background:'+colors[i]+'"></span>'+escHtml(r.name)+'<b>'+r.n+'</b></span>';}).join('');
      return '<div class="g2-grp"><div class="g2-grp-head"><span class="g2-grp-name">'+escHtml(g.name)+'</span><span class="g2-grp-ct">'+tot+'<span class="pc">'+pc(tot,statusTotal)+'%</span></span></div>'
        +'<div class="g2-grp-bar"><span class="g2-grp-fill" style="width:'+(statusTotal?tot/statusTotal*100:0)+'%;min-width:'+(nz.length*20)+'px">'+segs+'</span></div>'
        +'<div class="g2-grp-chips">'+chips+'</div></div>';
    }).join('');
  } else $('g2StatusList').innerHTML=rows.map(function(r,i){
    return '<div class="g2-srow" data-status="'+escAttr(String(r.name||'').toLowerCase())+'" style="--g2c:'+colors[i]+'" onclick="_g2Open('+i+')">'
      +'<span class="nm"><span class="sw"></span>'+escHtml(r.name)+'</span>'
      +'<span class="ct">'+r.n+'<span class="pc">'+pc(r.n,statusTotal)+'%</span></span>'
      +'<span class="bar"><span class="g2-fill" style="width:'+((r.n||0)/maxN*100)+'%"></span></span></div>';
  }).join('');

  // Footer: sprint timeline (working days) — low priority, may be hidden on the TV
  var tot=d.dTot||0,cells='';
  for(var i=0;i<tot;i++) cells+='<span class="g2-tl-cell'+(i<dayNo-1?' g2-tl-done':(i===dayNo-1?' g2-tl-now':''))+'"></span>';
  $('g2Timeline').innerHTML=cells;
  $('g2DayLabel').textContent=tot?(dayNo?'Day '+dayNo+' of '+tot+' working days':'Planning day · '+tot+' working days'):'';
  $('g2DayLabel').style.display=tot?'':'none';

  if(!_g2ResizeBound){_g2ResizeBound=true;window.addEventListener('resize',function(){if(currentPage==='live'&&(window._space==='MMS'||window._space==='MSSD')&&_g2ChartArgs)requestAnimationFrame(function(){g2DrawChart(_g2ChartArgs[0]);});});}
}

function doLiveView(d){
  lvWhenFontReady(d);
  var page=document.getElementById('page-live');
  if(!page) return;
  page.classList.toggle('mss3d-live',window._space==='MSSD');
  var useGlow2=window._space==='MMS'||window._space==='MSSD';
  page.classList.toggle('glow2-live',useGlow2);
  var rootEl=document.getElementById('root');if(rootEl){rootEl.classList.toggle('glow2-mode',useGlow2);if(!useGlow2)rootEl.classList.remove('g2-fixed-tv-mode');}
  if(useGlow2){doGlow2Live(d);return;}
  var sp=d.spInfo||{}, dayNo=lvDayNo(d);
  lvSyncTime();
  var titleEl=document.getElementById('lvTitle');
  var liveTitle=sp.id||cur;
  if(window._space==='MSSD') liveTitle=String(liveTitle||'').replace(/^MSSD\s+/i,'');
  titleEl.textContent=liveTitle;
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
  var statusOrder=window._space==='MSSD'?LV_MSSD_STATUS_ORDER:LV_STATUS_ORDER;
  var statusColors=window._space==='MSSD'?LV_MSSD_STATUS_COLORS:LV_STATUS_COLORS;
  var rank=function(r){ var i=statusOrder.indexOf(String(r.name||'').toLowerCase()); return i<0?99:i; };
  var so={total:so0.total, rows:(so0.rows||[]).map(function(r,i){ return {r:r,i:i}; })
    .sort(function(a,b){ return (rank(a.r)-rank(b.r))||(a.i-b.i); }).map(function(x){ return x.r; })};
  var ex=0, cols=so.rows.map(function(row){ return statusColors[String(row.name||'').toLowerCase()]||LV_EXTRA_COLORS[ex++ % LV_EXTRA_COLORS.length]; });
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