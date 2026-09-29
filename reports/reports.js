/* Reports — Spillovers, Performance, Leave, Ideas list */
/* ── SPILLOVERS — Carried-over tasks dropdown only ── */
function doSpillovers(d){
  // Sprint status detection
  var now = new Date();
  var spEnd = d.spEnd ? new Date(d.spEnd) : null;
  var isSprintEnded = spEnd && now > spEnd;
  var sprintStatus = isSprintEnded ? 'ended' : 'active';

  // ── Carried over tasks ──
  var carried = d.carried || [];
  var carryStatusText = '';
  var carryHeaderBadge = '';

  if(isSprintEnded){
    // Full view after sprint ends
    carryStatusText = 'Final view — Sprint ended '+d.endDate;
    carryHeaderBadge = '<span class="badge red" style="margin-left:8px">Sprint Ended</span>';
  } else {
    // Preview during active sprint
    carryStatusText = 'Live preview — Sprint still in progress';
    carryHeaderBadge = '<span class="badge acc" style="margin-left:8px">Live Preview</span>';
  }

  if(!carried.length){
    document.getElementById('carryS').innerHTML =
        '<div class="cc-t" style="margin-bottom:4px">Carried over tasks '+carryHeaderBadge+'</div>'
      + '<div class="cc-s" style="margin-bottom:10px">'+carryStatusText+'</div>'
      + '<div class="empty">No tasks carried over from previous sprint.</div>';
    return;
  }

  // Count by status
  var doneCount = carried.filter(function(c){return(c.status||'')==='Done';}).length;
  var wipCount  = carried.filter(function(c){
    var s=(c.status||'').trim();
    return s==='In Progress'||s==='In Review'||s==='Build Awaiting';
  }).length;
  var nsCount = carried.length - doneCount - wipCount;

  var summary = '<b style="color:var(--text)">'+carried.length+'</b> total · '
    + '<span style="color:var(--grn)">'+doneCount+' done</span> · '
    + '<span style="color:var(--amb)">'+wipCount+' in progress</span> · '
    + '<span style="color:var(--red)">'+nsCount+' not started</span>';

  var listHtml = carried.map(function(c){
    var st=stName(c);
    var badgeCls = c.status==='Done'?'grn':(c.status==='In Progress'?'acc':'amb');
    return '<div class="ul-row"><div class="ul-name">'+trunc(c.taskName,55)
      +'<br><span style="font-size:10px;color:var(--mut)">'+(c.assignee||'Unassigned')+' · '+(c.estTime||0)+'h est · '+(c.timeLog||0)+'h logged</span></div>'
      +'<div class="ul-meta"><span class="badge '+badgeCls+'">'+st+'</span></div></div>';
  }).join('');

  document.getElementById('carryS').innerHTML =
      '<div class="bugs-dd-header" onclick="toggleCarryList()" id="carryDdHeader">'
    + '<div class="bugs-dd-title">'
    + '<span class="bugs-dd-chev">▶</span>'
    + '<span class="cc-t" style="margin:0">Carried over tasks</span>'
    + '<span class="bugs-dd-count">'+carried.length+'</span>'
    + carryHeaderBadge
    + '</div>'
    + '<div class="cc-s" style="margin:0">'+carryStatusText+' · '+summary+'</div>'
    + '</div>'
    + '<div class="bugs-dd-body" id="carryDdBody" style="display:none">'+listHtml+'</div>';
}

function toggleCarryList(){
  var header = document.getElementById('carryDdHeader');
  var body   = document.getElementById('carryDdBody');
  if(!header || !body) return;
  var isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  header.classList.toggle('open', !isOpen);
}

/* ── STARS + DRAINERS ── */
function doDrainersStars(d){
  document.getElementById('starsS').innerHTML=d.stars.length
    ? d.stars.map(function(s){
        return '<div class="ul-row"><div class="ul-name"><b>'+s.asn+'</b> on<br><span style="font-size:10px;color:var(--mut)">'+trunc(s.name,50)+'</span></div>'
          +'<div class="ul-meta"><span class="badge" style="background:'+tc(s.team)+';color:#fff">'+s.team+'</span></div></div>';
      }).join('')
    : '<div class="empty">No exceptional ratings yet. Fill Impact Score in the sheet.</div>';

  document.getElementById('drainS').innerHTML=d.drainers.length
    ? d.drainers.map(function(x){
        return '<div class="ul-row"><div class="ul-name"><b>'+trunc(x.name,45)+'</b><br><span style="font-size:10px;color:var(--mut)">'+x.asn+' · Est: '+x.est+' h / Logged: '+x.log+' h</span></div>'
          +'<div class="ul-meta"><span class="badge red">+'+x['var']+' hrs</span></div></div>';
      }).join('')
    : '<div class="empty">All tasks within budget.</div>';
}

/* ── PERFORMANCE SCORECARD ── */
function doPerformance(d){
  var el=document.getElementById('perfS');
  if(!el)return;
  var starCnt={},drainCnt={},earlyCnt={};
  (d.stars||[]).forEach(function(s){var k=s.asn;starCnt[k]=(starCnt[k]||0)+1;});
  (d.drainers||[]).forEach(function(x){var k=x.asn;drainCnt[k]=(drainCnt[k]||0)+1;});
  (d.early||[]).forEach(function(e){var k=e.asn;earlyCnt[k]=(earlyCnt[k]||0)+1;});
  var members=(d.assignees||[]).filter(function(a){return a.n!=='Unassigned'&&a.tot>0;});
  if(!members.length){el.innerHTML='<div class="empty">No assignees found.</div>';return;}
  var maxDone=Math.max.apply(null,members.map(function(a){return a.done||0;}))||1;
  var rows=members.map(function(a){
    var tot=a.tot||1,done=a.done||0,est=a.est||0,log=a.log||0;
    var sComp=Math.round(done/tot*100);
    var sEst=est<=0?0:Math.max(0,Math.round((1-Math.abs(est-log)/est)*100));
    var sProd=Math.round((done/maxDone)*100);
    var stars=starCnt[a.n]||0,drains=drainCnt[a.n]||0,earlys=earlyCnt[a.n]||0;
    var score=Math.max(0,Math.min(100,Math.round(
      sComp*.30+sEst*.25+sProd*.15+Math.min(100,stars*50)*.20+Math.min(100,earlys*50)*.10-Math.min(100,drains*40)*.15
    )));
    var grade,gCls;
    if(score>=90){grade='A+';gCls='grade-Aplus';}
    else if(score>=80){grade='A';gCls='grade-A';}
    else if(score>=70){grade='B';gCls='grade-B';}
    else if(score>=60){grade='C';gCls='grade-C';}
    else{grade='D';gCls='grade-D';}
    return{a:a,score:score,grade:grade,gCls:gCls,sComp:sComp,sEst:sEst,stars:stars,drains:drains,earlys:earlys};
  }).sort(function(x,y){return y.score-x.score;});

  var avg=Math.round(rows.reduce(function(s,r){return s+r.score;},0)/rows.length);
  var aPlus=rows.filter(function(r){return r.score>=80;}).length;
  var cMinus=rows.filter(function(r){return r.score<60;}).length;
  var topName=rows[0]?rows[0].a.n:'—';

  function barCol(s){return s>=80?'var(--grn)':s>=70?'var(--acc)':s>=60?'var(--amb)':'var(--red)';}

  var summary='<div class="perf-summary">'
    +'<div class="perf-stat"><div class="perf-stat-v">'+avg+'</div><div class="perf-stat-l">Team avg score</div></div>'
    +'<div class="perf-stat"><div class="perf-stat-v" style="color:var(--grn)">'+aPlus+'</div><div class="perf-stat-l">High performers (A+/A)</div></div>'
    +'<div class="perf-stat"><div class="perf-stat-v" style="color:var(--red)">'+cMinus+'</div><div class="perf-stat-l">Need support (&lt;60)</div></div>'
    +'<div class="perf-stat"><div class="perf-stat-v" style="color:var(--amb);font-size:13px">'+topName+'</div><div class="perf-stat-l">Top performer</div></div>'
    +'</div>';

  var tbl='<table class="perf-tbl"><thead><tr><th>#</th><th>Member</th><th>Score</th>'
    +'<th class="num">Tasks</th><th class="num">Est / Log</th>'
    +'<th class="num">Stars</th><th class="num">Drain</th><th class="num">Early</th>'
    +'<th>Grade</th></tr></thead><tbody>';
  rows.forEach(function(r,i){
    var rk=i+1,rkCls=rk===1?'r1':rk===2?'r2':rk===3?'r3':'',col=barCol(r.score);
    tbl+='<tr><td><span class="perf-rank '+rkCls+'">'+rk+'</span></td>'
      +'<td><span class="perf-name">'+r.a.n+'</span>'
      +'<span class="perf-team" style="background:'+tc(r.a.team)+'">'+r.a.team+'</span>'
      +'<div class="perf-mini">Completion '+r.sComp+'% · Est accuracy '+r.sEst+'%</div></td>'
      +'<td><span class="perf-bar"><span class="perf-bar-fill" style="width:'+r.score+'%;background:'+col+'"></span></span>'
      +'<span class="perf-score-cell" style="color:'+col+'">'+r.score+'</span></td>'
      +'<td class="num">'+r.a.done+'/'+r.a.tot+'</td>'
      +'<td class="num">'+r.a.est+' / '+r.a.log+' h</td>'
      +'<td class="num" style="color:'+(r.stars?'var(--amb)':'var(--mut)')+'">'+(r.stars||'—')+'</td>'
      +'<td class="num" style="color:'+(r.drains?'var(--red)':'var(--mut)')+'">'+(r.drains||'—')+'</td>'
      +'<td class="num" style="color:'+(r.earlys?'var(--grn)':'var(--mut)')+'">'+(r.earlys||'—')+'</td>'
      +'<td><span class="perf-grade '+r.gCls+'">'+r.grade+'</span></td></tr>';
  });
  tbl+='</tbody></table>';
  el.innerHTML=summary+'<div style="overflow-x:auto">'+tbl+'</div>';
}

/* ── EARLY COMPLETIONS ── */
function doEarly(d){
  var el=document.getElementById('eS');
  if(!el) return;
  if(!d.early||!d.early.length){el.innerHTML='<div class="empty">No early completions in this sprint.</div>';return;}

  var totalSaved = d.early.reduce(function(s,e){ return s + (parseFloat(e.saved)||0); }, 0);
  var summary = d.early.length+' task'+(d.early.length===1?'':'s')+' done early · '+rnd(totalSaved)+' hrs saved';

  var grid = '<div class="early-grid">'+d.early.map(function(e){
    var pct=Math.round(e.saved/e.est*100);
    return '<div class="ec"><div class="ec-badge">'+pct+'% faster</div>'
      +'<div class="ec-name">'+e.asn+'</div>'
      +'<div class="ec-task">'+trunc(e.name,65)+'</div>'
      +'<div class="ec-stats">'
      +'<div class="ec-st"><label>Est.</label><span style="color:var(--mut)">'+e.est+' hrs</span></div>'
      +'<div class="ec-st"><label>Logged</label><span style="color:var(--acc)">'+e.log+' hrs</span></div>'
      +'<div class="ec-st"><label>Saved</label><span style="color:var(--grn)">'+e.saved+' hrs</span></div>'
      +'</div></div>';
  }).join('')+'</div>';

  el.innerHTML = '<div class="bugs-dd-header" onclick="toggleEarlyList()" id="earlyDdHeader">'
    + '<div class="bugs-dd-title">'
    + '<span class="bugs-dd-chev">▶</span>'
    + '<span class="cc-t" style="margin:0">Early completions</span>'
    + '<span class="bugs-dd-count">'+d.early.length+'</span>'
    + '</div>'
    + '<div class="cc-s" style="margin:0">'+summary+'</div>'
    + '</div>'
    + '<div class="bugs-dd-body" id="earlyDdBody" style="display:none">'+grid+'</div>';
}

function toggleEarlyList(){
  var header = document.getElementById('earlyDdHeader');
  var body   = document.getElementById('earlyDdBody');
  if(!header || !body) return;
  var isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  header.classList.toggle('open', !isOpen);
}

// ── LEAVE PAGE ──
function leaveAssigneeMatch(d, fullName){
  var wanted=normPersonName(fullName);
  if(!wanted) return null;

  return (d.assignees||[]).filter(function(a){
    return a.n!=='Unassigned' && a.tot>0 && normPersonName(a.n)===wanted;
  })[0] || null;
}

function previewLeaveMatch(){
  var d=window._sprintData;
  var msg=document.getElementById('leaveMatchStatus');
  var nameEl=document.getElementById('leaveName');

  if(!d || !msg || !nameEl) return;

  var match=leaveAssigneeMatch(d,nameEl.value);

  if(match){
    msg.textContent='Matched: '+match.n+' · '+(match.team||'No department')+' · '+match.tot+' associated task(s).';
    msg.style.color='var(--grn)';
  }else if(nameEl.value.trim()){
    msg.textContent='No exact assignee match in this sprint. Choose a name from the list.';
    msg.style.color='var(--red)';
  }else{
    msg.textContent='';
  }
}


function leaveRecordName(r){
  return r && (r.fullName || r.assignee || r.name || r.person || r.member || '');
}

function leaveRowStatus(d, r){
  var date=leaveDateValue(r);
  if(!leaveAssigneeMatch(d,leaveRecordName(r))) return {label:'No Match', cls:'red', reason:'Person is not active in this sprint', applied:false};
  if(!isValidLeaveDate(date,d.spStart,d.spEnd)) return {label:'Invalid', cls:'red', reason:'Not a sprint workday after D0', applied:false};
  return {label:'Credited', cls:'grn', reason:'6h applied', applied:true};
}

function previewLeaveMatch(){
  var d=window._sprintData;
  var out=document.getElementById('leavePreview');
  var msg=document.getElementById('leaveMatchStatus');
  var nameEl=document.getElementById('leaveName');
  var dateEl=document.getElementById('leaveDate');
  if(!d || !out || !nameEl || !dateEl) return;

  var name=nameEl.value.trim();
  var date=dateEl.value;
  var match=leaveAssigneeMatch(d,name);
  var validDate=isValidLeaveDate(date,d.spStart,d.spEnd);
  var duplicate=(d.leaveRecords||[]).some(function(r){
    return normPersonName(leaveRecordName(r))===normPersonName(name) && leaveDateValue(r)===date;
  });
  var statusText=!name ? 'Enter a name and date.'
    : (!match ? 'No exact assignee match in this sprint.'
    : (!validDate ? 'Date must be a sprint weekday after D0.'
    : (duplicate ? 'This leave day is already recorded.' : 'Ready to save.')));
  var ok=!!(match && validDate && !duplicate);

  out.innerHTML=''
    +'<div><b>Person:</b> '+(match?escHtml(match.n):'No sprint match')+'</div>'
    +'<div><b>Department:</b> '+(match&&match.team?escHtml(match.team):'-')+'</div>'
    +'<div><b>Associated tasks:</b> '+(match?(match.tot||0):'-')+'</div>'
    +'<div><b>Date:</b> '+(date?escHtml(date):'-')+'</div>'
    +'<div><b>Status:</b> <span style="color:'+(ok?'var(--grn)':'var(--red)')+'">'+escHtml(statusText)+'</span></div>';

  if(msg){
    msg.textContent=ok ? 'Matched: '+match.n+' - '+(match.team||'No department')+' - '+(match.tot||0)+' associated task(s).' : statusText;
    msg.style.color=ok?'var(--grn)':(name?'var(--red)':'var(--mut)');
  }
}

function doLeavePage(d){
  var el=document.getElementById('leavePage');
  if(!el) return;

  var start=pd(d.startDate);
  var end=pd(d.endDate);
  var minDate=start ? new Date(start.getFullYear(),start.getMonth(),start.getDate()+1) : null;
  var defaultDate=leaveISODate(new Date());
  if(minDate && defaultDate<leaveISODate(minDate)) defaultDate=leaveISODate(minDate);
  if(end && defaultDate>leaveISODate(end)) defaultDate=leaveISODate(end);

  var names=(d.assignees||[])
    .filter(function(a){return a.n!=='Unassigned'&&a.tot>0;})
    .slice()
    .sort(function(a,b){return a.n.localeCompare(b.n);});
  var records=(d.leaveRecords||[])
    .slice()
    .sort(function(a,b){return leaveDateValue(b).localeCompare(leaveDateValue(a));});
  var applied=d.appliedLeaves||[];
  var byTeam={};
  applied.forEach(function(l){ if(l.team) byTeam[l.team]=(byTeam[l.team]||0)+(l.hours||6); });

  var html=''
    +'<div class="leave-stats">'
      +'<div class="leave-stat"><div class="leave-stat-v">'+applied.length+'</div><div class="leave-stat-l">Credited days</div></div>'
      +'<div class="leave-stat"><div class="leave-stat-v">'+rnd(d.leaveCreditHours||0)+'h</div><div class="leave-stat-l">Leave hours</div></div>'
      +'<div class="leave-stat"><div class="leave-stat-v">'+records.length+'</div><div class="leave-stat-l">Sprint records</div></div>'
    +'</div>'
    +'<div class="leave-grid">'
      +'<div class="cc">'
        +'<div class="cc-t">Add leave</div>'
        +'<div class="cc-s">Credits 6 hours only for valid past/current sprint weekdays after D0.</div>'
        +'<div class="user-form" style="margin-top:12px">'
          +'<input class="user-input" id="leaveName" name="leave_member_lookup" list="leaveAssigneeList" placeholder="Full name" autocomplete="new-password" autocapitalize="off" spellcheck="false" oninput="previewLeaveMatch()">'
          +'<datalist id="leaveAssigneeList">'+names.map(function(a){ return '<option value="'+escAttr(a.n)+'">'+escHtml(a.team||'')+'</option>'; }).join('')+'</datalist>'
          +'<input type="date" class="user-input" id="leaveDate" value="'+defaultDate+'" onchange="previewLeaveMatch()" oninput="previewLeaveMatch()"'
            +(minDate?' min="'+leaveISODate(minDate)+'"':'')
            +(end?' max="'+leaveISODate(end)+'"':'')
            +' style="max-width:175px">'
          +'<input class="user-input" id="leaveNote" placeholder="Note (optional)">'
          +'<button class="btn btn-acc" id="saveLeaveBtn" onclick="saveLeaveDay()">Save</button>'
        +'</div>'
        +'<div class="leave-status" id="leaveMatchStatus"></div>'
      +'</div>'
      +'<div class="cc">'
        +'<div class="cc-t">Preview</div>'
        +'<div class="cc-s">Person, department, and sprint-day validation</div>'
        +'<div class="leave-preview" id="leavePreview">Enter a name and date.</div>'
      +'</div>'
    +'</div>';

  html+='<div class="cc">'
    +'<div class="cc-t">Leave history</div>'
    +'<div class="cc-s">Only credited rows are included in dashboard hours. Future rows wait until that date.</div>'
    +'<div style="overflow-x:auto"><table class="user-table">'
    +'<thead><tr><th>Name</th><th>Department</th><th>Date</th><th>Tasks</th><th>Hours</th><th>Status</th><th>Note</th><th></th></tr></thead><tbody>'
    +(records.length ? records.map(function(r){
      var st=leaveRowStatus(d,r);
      var name=leaveRecordName(r);
      var match=leaveAssigneeMatch(d,name);
      var team=r.team||r.teamCategory||(match&&match.team)||'';
      var tasks=(r.taskCount!=null?r.taskCount:(match?match.tot:0));
      var date=leaveDateValue(r);
      var id=r.id||r.leaveId||'';
      return '<tr>'
        +'<td>'+escHtml(name||'-')+'</td>'
        +'<td>'+escHtml(team||'-')+'</td>'
        +'<td>'+escHtml(date||'-')+'</td>'
        +'<td>'+tasks+'</td>'
        +'<td>'+(st.applied?'6 h':'-')+'</td>'
        +'<td><span class="badge '+st.cls+'">'+st.label+'</span></td>'
        +'<td>'+escHtml(r.note||r.reason||st.reason||'')+'</td>'
        +'<td style="text-align:right">'+(id?'<button class="btn" style="color:var(--red);border-color:rgba(240,82,82,.3)" onclick="deleteLeaveDay(\''+escAttr(id)+'\')">Del</button>':'')+'</td>'
      +'</tr>';
    }).join('') : '<tr><td colspan="8" style="padding:24px;text-align:center;color:var(--mut)">No leave recorded for this sprint.</td></tr>')
    +'</tbody></table></div>'
    +(Object.keys(byTeam).length ? '<div class="cc-s" style="margin-top:10px">By department: '+Object.keys(byTeam).sort().map(function(t){ return escHtml(t)+' '+rnd(byTeam[t])+'h'; }).join(' - ')+'</div>' : '')
    +'</div>';

  el.innerHTML=html;
  previewLeaveMatch();
}

async function saveLeaveDay(){
  var d=window._sprintData;
  var nameEl=document.getElementById('leaveName');
  var dateEl=document.getElementById('leaveDate');
  var noteEl=document.getElementById('leaveNote');
  var msg=document.getElementById('leaveMatchStatus');
  var btn=document.getElementById('saveLeaveBtn');

  if(!d || !nameEl || !dateEl || !msg || !btn) return;

  var match=leaveAssigneeMatch(d,nameEl.value);
  var date=dateEl.value;
  var start=pd(d.startDate);
  var end=pd(d.endDate);

  if(!match){
    msg.textContent='Choose an exact full name from the active assignee list.';
    msg.style.color='var(--red)';
    return;
  }

  if(!isValidLeaveDate(date,start,end)){
    msg.textContent='Choose a weekday after D0 and within the selected sprint.';
    msg.style.color='var(--red)';
    return;
  }

  var duplicate=(d.leaveRecords||[]).some(function(r){
    return normPersonName(r.fullName||r.assignee||r.name)===normPersonName(match.n)
      && leaveDateValue(r)===date;
  });

  if(duplicate){
    msg.textContent='This leave day is already recorded.';
    msg.style.color='var(--amb)';
    return;
  }

  var id='leave_'+Date.now()+'_'+Math.random().toString(36).slice(2,8);
  var original=btn.textContent;
  btn.disabled=true;
  btn.textContent='Saving…';

  try{
    var params='?action=saveLeave&email='+encodeURIComponent(window._userEmail||'')
      +'&leaveId='+encodeURIComponent(id)
      +'&sprintId='+encodeURIComponent(cur||'')
      +'&fullName='+encodeURIComponent(match.n)
      +'&leaveDate='+encodeURIComponent(date)
      +'&team='+encodeURIComponent(match.team||'')
      +'&taskCount='+encodeURIComponent(match.tot||0)
      +'&hours=6'
      +'&note='+encodeURIComponent(noteEl ? noteEl.value.trim() : '')
      +tok()
      +'&_cb='+Date.now();

    var res=await fetch(API+params,{method:'GET',redirect:'follow'});
    var json=JSON.parse((await res.text()).trim());

    if(!json.ok){
      throw new Error(json.message||json.error||'Leave could not be saved');
    }

    init(cur);
  }catch(err){
    msg.textContent='Save failed: '+err.message;
    msg.style.color='var(--red)';
  }finally{
    btn.disabled=false;
    btn.textContent=original;
  }
}

async function deleteLeaveDay(id){
  if(!id || !confirm('Delete this leave day?')) return;

  try{
    var params='?action=deleteLeave&email='+encodeURIComponent(window._userEmail||'')
      +'&leaveId='+encodeURIComponent(id)
      +tok()
      +'&_cb='+Date.now();

    var res=await fetch(API+params,{method:'GET',redirect:'follow'});
    var json=JSON.parse((await res.text()).trim());

    if(!json.ok){
      throw new Error(json.message||json.error||'Leave could not be deleted');
    }

    init(cur);
  }catch(err){
    alert('Delete failed: '+err.message);
  }
}

/* ── IDEAS LIST ── */
function doDiscIdeas(d){
  var ideas=d.ideas||[], r=d.roles||{}, q=String(_discQuery||'').toLowerCase().trim();
  var list=ideas.filter(function(i){ return !q || (i.key+' '+i.summary+' '+JSON.stringify(i.fields)+' '+i.creator+' '+i.status).toLowerCase().indexOf(q)!==-1; });
  var rf=dRankField(d);
  var rv=function(i){ var x=dNum(dV(i,rf)); return x==null?-1e9:x; };
  list.sort(function(a,b){ return rf?(rv(b)-rv(a))||keyOrder(a.key,b.key):keyOrder(a.key,b.key); });
  var cols=(d.fieldNames||[]);
  document.getElementById('dListS').textContent=list.length+' of '+ideas.length+' idea(s) · every Jira idea field this space uses · '+(rf?'sorted by '+rf:'sorted by key');
  var num=function(n){ return ideas.some(function(i){return typeof dV(i,n)==='number';}); };
  document.getElementById('dList').innerHTML='<table class="perf-tbl"><thead><tr><th>Key</th><th>Idea</th><th>Jira status</th>'
    +cols.map(function(n){return '<th'+(num(n)?' class="num"':'')+'>'+escHtml(n)+'</th>';}).join('')+'<th>Creator</th><th>Assignee</th><th class="num">Delivery</th></tr></thead><tbody>'
    +list.map(function(i){ var x=i.delivery||{}, t=(x.done||0)+(x.prog||0)+(x.todo||0);
      return '<tr><td style="white-space:nowrap">'+dLink(i.key)+'</td><td style="min-width:220px">'+escHtml(i.summary)+'</td><td><span class="badge '+(i.statusCat==='Done'?'grn':i.statusCat==='In Progress'?'blue':'')+'">'+escHtml(i.status)+'</span></td>'
        +cols.map(function(n){ var v=dV(i,n); return '<td'+(typeof v==='number'?' class="num"':'')+'>'+escHtml(dFmt(v))+'</td>'; }).join('')
        +'<td>'+escHtml(i.creator||'—')+'</td><td>'+escHtml(i.assignee||'Unassigned')+'</td><td class="num">'+(t?(x.done||0)+'/'+t:'—')+'</td></tr>'; }).join('')
    +'</tbody></table>';
}
