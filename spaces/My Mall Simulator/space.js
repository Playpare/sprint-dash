/* My Mall Simulator (MMS) — sprint space: Overview, Team, Bugs & Polish, Retrospective */
// TV zoom factor for space.css (screen width ÷ 1920 desktop width).
(function(){
  function setTvZoom(){ document.documentElement.style.setProperty('--tvz', String(window.innerWidth/1920)); }
  setTvZoom();
  if(!window._tvZoomBound){ window._tvZoomBound=true; window.addEventListener('resize', setTvZoom); }
})();
function process(json,spId){
  var tasks   = (json.tasks||[]).filter(function(t){return !spId||t.sprintId===spId;});
  var subtasks= (json.subtasks||[]).filter(function(t){return !spId||t.sprintId===spId;});
  var sprints = json.sprints||[];
  var goals   = (json.goals||[]).filter(function(g){return g.sprintId===spId;});
  var carried = [];
  var spInfo  = sprints.find(function(s){return s.id===spId;})||{};
  var leaveRecords = (json.leaves||[]).filter(function(leave){
    return leave.sprintId===spId;
    });

  // Carried-over fallback: if Apps Script didn't populate carriedOver (which
  // is the case more often than not — sheet column is optional), derive it
  // by looking at the previous sprint's tasks that didn't finish. The "prev"
  // sprint is the one whose end date is closest to but before this sprint's
  // start, ignoring BUGS/BACKLOG pseudo-sprints.
  // Jira sprint-report rule: work items of the previous sprint that were NOT
  // completed when that sprint closed — still open, or resolved only after the
  // close date (the snapshot may have been taken later, so status alone is not enough).
  if(spId){
    var thisStart = pd(spInfo.start);
    if(thisStart){
      var validPrev = sprints.filter(function(s){
        if(!s.id||!s.start||!s.end) return false;
        if(s.id===spId) return false;
        if(s.id.match(/^(BUGS|BACKLOG)$/i)) return false;
        var sStart = pd(s.start); var sEnd = pd(s.end);
        return sStart && sEnd && sEnd < thisStart;
      }).sort(function(a,b){ return pd(b.end) - pd(a.end); }); // newest-ending first
      var prevSprint = validPrev[0];
      if(prevSprint){
        var closeDay = pd(prevSprint.completed) || pd(prevSprint.end);
        if(closeDay) closeDay = new Date(closeDay.getFullYear(), closeDay.getMonth(), closeDay.getDate(), 23, 59, 59, 999);
        carried = (json.tasks||[]).filter(function(t){
          if(t.sprintId!==prevSprint.id) return false;
          if((t.status||'').trim()!=='Done') return true;
          var res = pd(t.resolvedOn);
          return !!(closeDay && res && res > closeDay);
        }).sort(function(a,b){ return keyOrder(a.mssTicket,b.mssTicket); }).map(function(t){
          return {
            taskName: t.taskName,
            assignee: t.assignee,
            estTime:  t.estTime,
            timeLog:  t.timeLog,
            status:   t.status,
            statusName: t.statusName,
            teamCategory: t.teamCategory,
            mssTicket: t.mssTicket,
            resolvedOn: t.resolvedOn,
            fromSprint: prevSprint.id
          };
        });
      }
    }
  }

  // Sprint date range for filtering bugs & backlog
  var spStart = pd(spInfo.start);
  var spEnd   = pd(spInfo.end);
  if(spEnd) spEnd = new Date(spEnd.getTime() + 864e5 - 1);

  // Bugs & polish: filter by ticket type + priority only.
  //   • Bugs   = ticketType "Bug",      priority ≠ "Deferred"
  //   • Polish = ticketType "Feedback", priority ≠ "Deferred"
  // We intentionally do NOT filter by dueDate any more — the team treats the
  // Bugs section in Asana as a live queue: whatever sits there is "current".
  // Bugs without a due date were getting silently dropped by the old window
  // filter, which is why the section came up empty.
  // Deferred priority is excluded everywhere — those are parked, not in-sprint.
  function bugTicketType(b){ return ((b.ticketType||b['Ticket Type']||'')+'').trim().toLowerCase(); }
  function bugPriority(b){   return ((b.priority||b.Priority||'')+'').trim().toLowerCase(); }
  // ── Bugs are sprint-scoped ──
  // A FROZEN sprint carries its own snapshotted Bugs & Polish rows (bugs that
  // were Done within its window), tagged with the sprintId. The CURRENT/live
  // sprint has no snapshot → show the ongoing live 'BUGS' queue instead.
  // Jira: bugs / polish belong to the sprint they are in.
  var allBugsRaw = json.bugsTasks||[];
  var allBugs = allBugsRaw.filter(function(b){ return (b.sprintId||'') === spId; });
  var bugs   = allBugs.filter(function(b){ return bugTicketType(b)==='bug'      && bugPriority(b)!=='deferred'; });
  var polish = allBugs.filter(function(b){ return bugTicketType(b)==='polish' && bugPriority(b)!=='deferred'; });
  var allBugsByType     = allBugs.filter(function(b){ return bugTicketType(b)==='bug'; });
  var allPolishByType   = allBugs.filter(function(b){ return bugTicketType(b)==='polish'; });
  var allBacklog = json.backlogTasks||[];
  var backlog = allBacklog.filter(function(b){
    if(!spStart||!spEnd) return true;
    var d = pd(b.dueDate); return d && d >= spStart && d <= spEnd;
  });

  var tmap={},amap={};
  var totEst=0,totLog=0,done=0,prog=0,ns=0,ovd=0;
  var cTimes=[],early=[],unplanned=[],drainers=[],stars=[];

  // Unplanned = added to the sprint after it started (Jira scope change).
  function isUnplanned(t){ return !!t.addedAfterStart; }

  // ── Jira sprint counting ──
  // Work items = the sprint's top-level items (Feature / Story / Task …).
  // A parent's hours are Jira's Σ values (incl. its sub-tasks), so every hour
  // is counted exactly once and counts match the Jira sprint.
  // Per person, hours go to whoever owns them: each sub-task to its own
  // assignee, a parent's own (non-sub-task) portion to the parent's assignee.
  var parentsWithSubtasks = {};
  subtasks.forEach(function(s){
    var p = (s.parentTask || '').trim();
    if(p) parentsWithSubtasks[p] = true;
  });
  var leafTasks = tasks.filter(function(t){
    return !parentsWithSubtasks[(t.taskName || '').trim()];
  });
  var allItems = tasks.slice();
  allItems.forEach(function(t){
    var est=parseFloat(t.estTime)||0;
    var log=parseFloat(t.timeLog)||0;
    totEst+=est; totLog+=log;
    var st=(t.status||'').trim();
    var isDone=st==='Done';
    var isWip=st==='In Progress'||st==='In Review'||st==='Build Awaiting';
    if(isDone){
      done++;
      if(log>0)cTimes.push(log);
      if(est>0&&log>0&&log<est)early.push({name:t.taskName,asn:t.assignee||'',team:t.teamCategory||'',est:est,log:log,saved:rnd(est-log)});
    } else if(isWip) prog++;
    else ns++;
    // Overdue: task's own dueDate passed OR sprint ended and task not done
    if(!isDone){
      var isOverdue=false;
      if(t.dueDate){try{if(pd(t.dueDate)<new Date())isOverdue=true;}catch(e){}}
      if(!isOverdue && spEnd && new Date()>spEnd) isOverdue=true;
      if(isOverdue)ovd++;
    }
    if(isUnplanned(t)){
      unplanned.push({name:t.taskName,team:t.teamCategory||'',asn:t.assignee||'',est:est,log:log,status:st,statusName:t.statusName});
    }
    var variance=log-est;
    if(variance>0)drainers.push({name:t.taskName,key:t.mssTicket||'',asn:t.assignee||'','var':rnd(variance),log:log,est:est});
    if(t.impactScore&&String(t.impactScore).includes('5')){
      stars.push({name:t.taskName,asn:t.assignee||'',team:t.teamCategory||''});
    }
    var team=t.teamCategory||'';
    if(team){
      tc(team);
      if(!tmap[team])tmap[team]={n:team,done:0,prog:0,ns:0,ovd:0,est:0,log:0,tot:0};
    }
    if(team){
      tmap[team].est+=est; tmap[team].log+=log; tmap[team].tot++;
      if(isDone)tmap[team].done++;
      else if(isWip)tmap[team].prog++;
      else tmap[team].ns++;
      if(!isDone){
        var tOvd=false;
        if(t.dueDate){try{if(pd(t.dueDate)<new Date())tOvd=true;}catch(e){}}
        if(!tOvd && spEnd && new Date()>spEnd) tOvd=true;
        if(tOvd)tmap[team].ovd++;
      }
    }
  });

  // Per person: leaf work items + sub-tasks, each on its own assignee.
  leafTasks.concat(subtasks).forEach(function(t){
    var est=parseFloat(t.estTime)||0, log=parseFloat(t.timeLog)||0;
    var isDone=(t.status||'').trim()==='Done';
    var asn=t.assignee||'Unassigned';
    if(!amap[asn])amap[asn]={n:asn,team:t.teamCategory||'',tot:0,done:0,est:0,log:0,times:[]};
    if(!amap[asn].team && t.teamCategory) amap[asn].team=t.teamCategory;
    amap[asn].tot++; amap[asn].est+=est; amap[asn].log+=log;
    if(isDone){amap[asn].done++;if(log>0)amap[asn].times.push(log);}
  });

  // ── Parent owner's "own" portion ──
  //
  // A parent task with subtasks is skipped above (allItems excludes them) to
  // avoid double-counting — because fetchAsanaData() rolls up subtask totals
  // into the parent's est/log. But the parent CAN have its own work too:
  // coordination, review, planning that the parent owner logged ON the parent
  // task itself. That portion was getting lost.
  //
  // Compute it as: parent.est - sum(subtask.est). If positive, attribute it
  // to the parent's owner (totals + amap + tmap). Doesn't touch task counts
  // (done/prog/ns) — those still come from leaves + subtasks.
  var subEstByParent = {}, subLogByParent = {};
  subtasks.forEach(function(s){
    var p = (s.parentTask||'').trim();
    if(!p) return;
    subEstByParent[p] = (subEstByParent[p]||0) + (parseFloat(s.estTime)||0);
    subLogByParent[p] = (subLogByParent[p]||0) + (parseFloat(s.timeLog)||0);
  });
  tasks.forEach(function(t){
    var name = (t.taskName||'').trim();
    if(!parentsWithSubtasks[name]) return; // only parents-with-subs
    var rolledEst = parseFloat(t.estTime)||0;
    var rolledLog = parseFloat(t.timeLog)||0;
    var ownEst = Math.max(0, rolledEst - (subEstByParent[name]||0));
    var ownLog = Math.max(0, rolledLog - (subLogByParent[name]||0));
    if(!ownEst && !ownLog) return;
    // Sprint / team totals already include this via the parent's Σ hours.
    var team = t.teamCategory||'';

    var asn = t.assignee||'Unassigned';
    if(!amap[asn]) amap[asn] = {n:asn,team:team,tot:0,done:0,est:0,log:0,times:[]};
    amap[asn].est += ownEst;
    amap[asn].log += ownLog;
    // intentionally NOT incrementing amap[asn].tot or .done — parent is
    // a container, real "done" credit lives on subtasks
  });

  // ── Merge bugs + polish into sprint totals (counts AND time) ──
  //
  // Bugs (ticketType=Bug) and Polish (ticketType=Feedback) that belong to
  // this sprint are real work the team owns. Count them in:
  //   • totEst / totLog / done / prog / ns / ovd  → sprint KPIs reflect them
  //   • tmap / amap (tot + done + est + log)      → team & user roster show them
  //
  // Still NOT added to:
  //   • unplanned[] / scope creep — scope creep is "Feature Tag = Unplanned",
  //     a separate signal from ticket type
  //   • drainers / stars / early — those are sprint task-level metrics
  var bugsAndPolish = bugs.concat(polish);
  var bugPolishCount = bugsAndPolish.length;
  // Snapshot the task-only figures BEFORE bugs/polish are folded in, so the
  // Overview cards can be shown with or without them (see d.exBP below).
  var _preBP = { totEst:totEst, totLog:totLog, done:done, prog:prog, ns:ns, ovd:ovd };
  // Per-person task-only snapshot, so Expected Hours / Alerts can divide by the
  // right estimate when the Overview is switched to "Tasks only".
  var _preBPAsn = {};
  Object.keys(amap).forEach(function(k){
    _preBPAsn[k] = {est:amap[k].est||0, log:amap[k].log||0, tot:amap[k].tot||0, done:amap[k].done||0};
  });
  bugsAndPolish.forEach(function(b){
    var est = parseFloat(b.estTime) || 0;
    var log = parseFloat(b.timeLog) || 0;
    var st  = (b.status||'').trim();
    var isDone = st==='Done';
    var isWip  = st==='In Progress' || st==='In Review' || st==='Build Awaiting';

    totEst += est;
    totLog += log;
    if(isDone) done++;
    else if(isWip) prog++;
    else ns++;
    if(!isDone){
      var ovrd = false;
      if(b.dueDate){try{if(pd(b.dueDate)<new Date()) ovrd=true;}catch(e){}}
      if(!ovrd && spEnd && new Date()>spEnd) ovrd = true;
      if(ovrd) ovd++;
    }

    var team = (b.teamCategory || '').toString();
    if(team){
      tc(team);
      if(!tmap[team]) tmap[team] = {n:team, done:0, prog:0, ns:0, ovd:0, est:0, log:0, tot:0};
      tmap[team].est += est;
      tmap[team].log += log;
      tmap[team].tot++;
      if(isDone) tmap[team].done++;
      else if(isWip) tmap[team].prog++;
      else tmap[team].ns++;
      if(!isDone){
        var tOvrd = false;
        if(b.dueDate){try{if(pd(b.dueDate)<new Date()) tOvrd=true;}catch(e){}}
        if(!tOvrd && spEnd && new Date()>spEnd) tOvrd = true;
        if(tOvrd) tmap[team].ovd++;
      }
    }

    var asn = b.assignee || 'Unassigned';
    if(!amap[asn]) amap[asn] = {n:asn, team:team, tot:0, done:0, est:0, log:0, times:[]};
    amap[asn].tot++;
    amap[asn].est += est;
    amap[asn].log += log;
    if(isDone){ amap[asn].done++; if(log>0) amap[asn].times.push(log); }
  });

  // ── Leave credit ──
// A leave day is not written into Asana. It is dashboard-only credit.
var leaveCreditHours = 0, appliedLeaves = [], seenLeaveDays = {};
var leaveSprintStart = pd(spInfo.start), leaveSprintEnd = pd(spInfo.end);
// A leave day is credited at the person's own planned daily rate
// (their estimate / sprint working days), matching the expected-hours rule.
var leaveSprintDays = Math.max(1, sprintWorkingDayCount(leaveSprintStart, leaveSprintEnd));

leaveRecords.forEach(function(leave){
  var date = leaveDateValue(leave);
  var wanted = normPersonName(leave.fullName || leave.assignee || leave.name);
  var dedupeKey = wanted + '|' + date;

  if(!wanted || seenLeaveDays[dedupeKey] || !leaveCountsNow(leave, leaveSprintStart, leaveSprintEnd)) return;

  var matchedName = Object.keys(amap).filter(function(name){
    return normPersonName(name) === wanted;
  })[0];

  if(!matchedName) return;

  seenLeaveDays[dedupeKey] = true;

  var person = amap[matchedName];
  var team = person.team || leave.team || '';
  var hours = (person.est || 0) / leaveSprintDays;

  person.log += hours;
  person.leaveHours = (person.leaveHours || 0) + hours;
  // Leave is credit for the person, not for bugs/polish — it applies in both modes.
  if(_preBPAsn[matchedName]) _preBPAsn[matchedName].log += hours;
  totLog += hours;

  if(team){
    if(!tmap[team]){
      tmap[team] = {n:team,done:0,prog:0,ns:0,ovd:0,est:0,log:0,tot:0};
    }
    tmap[team].log += hours;
  }

  leaveCreditHours += hours;

  appliedLeaves.push({
    id:leave.id || leave.leaveId || dedupeKey,
    fullName:person.n,
    team:team,
    date:date,
    hours:hours,
    taskCount:person.tot||0
  });
});

  // Biggest overrun first; equal overruns → lower work-item key first (MMS-248 before MMS-510)
  drainers.sort(function(a,b){return (b['var']-a['var']) || keyOrder(a.key,b.key);});
  drainers=drainers.slice(0,5);

  Object.values(amap).forEach(function(a){
    a.avg=a.times.length?rnd(a.times.reduce(function(s,v){return s+v;},0)/a.times.length):0;
    a.est=rnd(a.est); a.log=rnd(a.log);
  });

  // Task-only mirror per person (bugs + polish excluded, leave credit kept).
  Object.keys(amap).forEach(function(k){
    var s = _preBPAsn[k] || {est:0, log:0, tot:0, done:0};
    amap[k].estEx  = rnd(s.est);
    amap[k].logEx  = rnd(s.log);
    amap[k].totEx  = s.tot;
    amap[k].doneEx = s.done;
  });

  var deptMap = {};
  Object.values(amap).forEach(function(a){
    if((a.n||'') === 'Unassigned' || !a.team) return;
    if(!deptMap[a.team]) deptMap[a.team] = {n:a.team, est:0, log:0, members:0, tasks:0};
    deptMap[a.team].est += a.est;
    deptMap[a.team].log += a.log;
    deptMap[a.team].members++;
    deptMap[a.team].tasks += a.tot || 0;
  });
  var deptTotals = Object.values(deptMap).sort(function(a,b){ return a.n.localeCompare(b.n); });
  var deptEstTotal = rnd(deptTotals.reduce(function(s,t){ return s + (parseFloat(t.est)||0); }, 0));
  var deptLogTotal = rnd(deptTotals.reduce(function(s,t){ return s + (parseFloat(t.log)||0); }, 0));
  var deptUtil = pc(deptLogTotal, deptEstTotal);
  var rawDeptMap = {};
  tasks.concat(bugs, polish).forEach(function(t){   // top-level items, Σ hours
    var team = String(t.teamCategory||t.team||'').trim();
    if(!team) return;
    if(!rawDeptMap[team]) rawDeptMap[team] = {n:team, est:0, log:0, tasks:0};
    rawDeptMap[team].est += parseFloat(t.estTime!=null?t.estTime:t.est)||0;
    rawDeptMap[team].log += parseFloat(t.timeLog!=null?t.timeLog:t.log)||0;
    rawDeptMap[team].tasks++;
  });

  appliedLeaves.forEach(function(leave){
  if(!leave.team) return;

  if(!rawDeptMap[leave.team]){
    rawDeptMap[leave.team] = {n:leave.team,est:0,log:0,tasks:0};
  }

  rawDeptMap[leave.team].log += leave.hours;
  });

  var rawDeptTotals = Object.values(rawDeptMap).map(function(t){
    t.est = rnd(t.est);
    t.log = rnd(t.log);
    return t;
  }).sort(function(a,b){ return a.n.localeCompare(b.n); });
  var rawDeptEstTotal = rnd(rawDeptTotals.reduce(function(s,t){ return s + (parseFloat(t.est)||0); }, 0));
  var rawDeptLogTotal = rnd(rawDeptTotals.reduce(function(s,t){ return s + (parseFloat(t.log)||0); }, 0));

  // Sprint structure (weekends excluded — Mon-Fri only):
  //   Start date  = D0 (planning day)
  //   D1..DN     = working weekdays after D0, up to end date
  //
  // Example: Mon 13 Apr → Fri 24 Apr
  //   D0 = Mon 13 Apr (planning)
  //   D1 = Tue 14 Apr, D2 = Wed 15 Apr, D3 = Thu 16 Apr, D4 = Fri 17 Apr
  //   Sat 18 + Sun 19 SKIPPED
  //   D5 = Mon 20 Apr, D6 = Tue 21, D7 = Wed 22, D8 = Thu 23, D9 = Fri 24
  //   dTot = 9 working days
  //
  // dDone = fully elapsed working days (strictly BEFORE today)
  function isWeekend(d){ var w=d.getDay(); return w===0||w===6; }  // Sun=0, Sat=6
  function countWeekdays(from, to){
    // Count weekdays from 'from' (exclusive) up to 'to' (inclusive)
    if(!from||!to||to<from) return 0;
    var count=0;
    var cur = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    cur.setDate(cur.getDate()+1);
    while(cur <= to){
      if(!isWeekend(cur)) count++;
      cur.setDate(cur.getDate()+1);
    }
    return count;
  }

  var sd=pd(spInfo.start),ed=pd(spInfo.end),now=new Date();
  var dTot=0,dDone=0;
  if(sd&&ed){
    // Working days after D0 (start is D0), up to and including end
    dTot = Math.max(1, countWeekdays(sd, ed));
    var todayStart=new Date(now.getFullYear(),now.getMonth(),now.getDate());
    // Fully elapsed working days — count weekdays from day AFTER start
    // up to but NOT including today (today is in progress)
    if(todayStart <= sd){
      // Sprint not started yet
      dDone = 0;
    } else if(todayStart > ed){
      // Sprint ended — all done
      dDone = dTot;
    } else {
      // Working: count full weekdays strictly before today (after start)
      var prevDay = new Date(todayStart);
      prevDay.setDate(prevDay.getDate()-1);
      dDone = Math.min(dTot, countWeekdays(sd, prevDay));
    }
  }

  // Burndown: D0 (planning, full est) + D1..Dn (working days)
  // burnDays = dTot + 1 → e.g. dTot=10 → 11 points (D0 to D10)
  var burnDays=dTot+1;
  var step=totEst/(dTot||1);
  var logPD=dDone>0?totLog/dDone:0;
  var bI=[],bA=[],bL=[];
  for(var i=0;i<burnDays;i++){
    bL.push('D'+i);
    // Ideal: flat at D0 (no work on planning), decrease from D1 onwards
    if(i===0) bI.push(rnd(totEst));
    else bI.push(rnd(Math.max(0, totEst-step*i)));
    // Actual: up to today, flat at D0
    if(i===0) bA.push(rnd(totEst));
    else if(i<=dDone+1) bA.push(Math.max(0, rnd(totEst-logPD*(i-1))));
    else bA.push(null);
  }

  var scope=Object.values(tmap).map(function(t){
    var un=allItems.filter(function(x){return x.teamCategory===t.n && isUnplanned(x);}).length;
    var pl=allItems.filter(function(x){return x.teamCategory===t.n && !isUnplanned(x);}).length;
    return{n:t.n,pl:pl,un:un,tot:pl+un||1};
  });

  var taskUnplannedEst=unplanned.reduce(function(s,t){
    return s+(parseFloat(t.est)||0);
  },0);

  // Leave is displayed separately and must not count as unplanned work.
  var unplannedEst=rnd(taskUnplannedEst);
  var plannedEst=rnd(totEst-taskUnplannedEst);
  var healthImpact=plannedEst>0?Math.round(unplannedEst/plannedEst*100):0;

  // Subtask grouping by parent
  var subtaskGroups={};
  subtasks.forEach(function(s){
    var p=s.parentTask||'Unknown';
    if(!subtaskGroups[p])subtaskGroups[p]=[];
    subtaskGroups[p].push(s);
  });

  // Bugs & Polish summary — split by ticket type. Status buckets count
  // everything that isn't Done/WIP/Re-opened as "notStarted" so the chips
  // always sum to total even when Asana adds new statuses we don't know.
  function summarizeBugList(list){
    var s = {notStarted:0,inProg:0,done:0,reopened:0,total:list.length};
    list.forEach(function(b){
      var st=(b.status||'').trim(), nm=stName(b);
      if(st==='Done') s.done++;
      else if(/re-?open/i.test(nm)) s.reopened++;
      else if(st==='In Progress') s.inProg++;
      else s.notStarted++;
    });
    return s;
  }
  var bugStats   = summarizeBugList(bugs);   bugStats.totalAll   = allBugsByType.length;
  var polishStats = summarizeBugList(polish); polishStats.totalAll = allPolishByType.length;

  // Total items now includes bugs + polish — they count as real work in the
  // sprint, so completion rate and scope creep should weigh them too.
  var grandTotal = allItems.length + bugPolishCount;
  // Task-only mirror of the Overview metrics (bugs + polish excluded).
  // Unplanned figures are already bug-free, so they're shared, not duplicated.
  // ── Status overview (Jira Summary style) ──
  // Every work item in the sprint, sub-tasks included, grouped by the exact
  // Jira status. exBP mirror drops bugs / polish and their sub-tasks.
  var bugSubs = (json.bugSubtasks||[]).filter(function(t){ return !spId || t.sprintId===spId; });
  function statusOverview(list){
    var by={}, order=[];
    list.forEach(function(t){
      var nm=stName(t)||'To Do';
      if(!by[nm]){ by[nm]={name:nm, cat:(t.status||'To Do'), n:0, items:[]}; order.push(nm); }
      by[nm].n++; by[nm].items.push(t);
    });
    var rank={'Done':0,'In Progress':1,'To Do':2};
    var rows=order.map(function(k){ return by[k]; }).sort(function(a,b){
      var ra=rank[a.cat]!=null?rank[a.cat]:1, rb=rank[b.cat]!=null?rank[b.cat]:1;
      return ra-rb || b.n-a.n || a.name.localeCompare(b.name);
    });
    var done=rows.filter(function(r){return r.cat==='Done';}).reduce(function(s,r){return s+r.n;},0);
    return {rows:rows, total:list.length, done:done, pct:pc(done,list.length), items:list};
  }
  // Epics in the sprint are counted too, like Jira's "Issues by Status" gadget.
  var containers = (json.containers||[]).filter(function(t){ return !spId || t.sprintId===spId; });
  var statusAll = statusOverview(tasks.concat(subtasks, bugs, polish, bugSubs, containers));
  var statusEx  = statusOverview(tasks.concat(subtasks, containers));
  // Sprint completion (Jira "Sprint Completion" gadget): which work items count
  // is set in Jira Config → COMPLETION_COUNT (subtasks | assigned | all).
  var compMode = ((json.settings||{}).completionCount||'subtasks').toLowerCase();
  var compList = compMode==='all' ? tasks.concat(subtasks, bugs, polish, bugSubs)
    : compMode==='assigned' ? tasks.concat(subtasks, bugs, polish, bugSubs).filter(function(t){ return t.assignee && t.assignee!=='Unassigned'; })
    : subtasks.concat(bugSubs);
  var compDone = compList.filter(function(t){ return (t.status||'')==='Done'; });
  var completion = { mode: compMode, total: compList.length, done: compDone.length, remaining: compList.length-compDone.length,
    pct: pc(compDone.length, compList.length), items: compList };

  var exBP = {
    statusOv: statusEx,
    total:   allItems.length,
    done:    _preBP.done, prog: _preBP.prog, ns: _preBP.ns, ovd: _preBP.ovd,
    totEst:  rnd(_preBP.totEst),
    totLog:  rnd(_preBP.totLog),
    compRate: pc(_preBP.done, allItems.length),
    util:     pc(_preBP.totLog, _preBP.totEst)
  };
  return{
    exBP,
    statusOv: statusAll,
    completion: completion,
    burn: (json.burndown||{})[spId] || null,
    bugPolishCount,
    sprints,spInfo,tasks,subtasks,goals,bugs,polish,backlog,carried,
    total:grandTotal,done,prog,ns,ovd,
    totEst:rnd(totEst),totLog:rnd(totLog),
    compRate:pc(done,grandTotal),
    util:pc(totLog,totEst),
    estAcc:totEst>0?Math.min(100,Math.round((1-Math.abs(totEst-totLog)/totEst)*100)):0,
    creep:pc(unplanned.length,grandTotal),
    avgComp:cTimes.length?rnd(cTimes.reduce(function(s,v){return s+v;},0)/cTimes.length):0,
    dTot,dDone,startDate:spInfo.start||'',endDate:spInfo.end||'',
    teams:Object.values(tmap),assignees:Object.values(amap),scope,
    effort:Object.values(tmap).map(function(t){return{n:t.n,v:rnd(t.log)};}).sort(function(a,b){return b.v-a.v;}),
    areaLbls:Object.values(tmap).map(function(t){return t.n;}),
    areaEst:Object.values(tmap).map(function(t){return Math.round(t.est);}),
    areaLog:Object.values(tmap).map(function(t){return Math.round(t.log);}),
    bI,bA,bL,early,unplanned,drainers,stars,
    unplannedCount:unplanned.length,
    unplannedLog: rnd(unplanned.reduce(function(s,t){ return s+(parseFloat(t.log)||0); },0)),
    unplannedEst:rnd(unplannedEst),
    plannedEst,healthImpact,
    leaveRecords:leaveRecords,
    appliedLeaves:appliedLeaves,
    leaveCreditHours:rnd(leaveCreditHours),
    deptTotals,deptEstTotal,deptLogTotal,deptUtil,
    rawDeptTotals,rawDeptEstTotal,rawDeptLogTotal,
    subtaskGroups,
    bugStats,    allBugsTotal:   allBugsByType.length,    bugsRaw:   allBugsByType,
    polishStats, allPolishTotal: allPolishByType.length,  polishRaw: allPolishByType,
    spStart,spEnd,
    sprintGoals: json.sprintGoals||{},
    retrospectives: json.retrospectives||{},
    teamCapacity: json.teamCapacity||{},
  };
}

/* ── SHELL HTML — Multi-page layout ──
   The page markup lives in this folder's space.html, plus reports/reports.html
   and admin/admin.html (loaded by loadSpaceAssets() in core/core.js). */
function shell(){
  return pagesHtml('space',  ['overview','team','bugs'])
    +    pagesHtml('reports',['spillovers'])
    +    pagesHtml('space',  ['retro'])
    +    pagesHtml('reports',['performance'])
    +    pagesHtml('admin',  ['users'])
    +    pagesHtml('reports',['leave'])
    +    pagesHtml('admin',  ['settings'])
    +    pagesHtml('live',   ['live']);
}
// Colours for Jira statuses: Done = green, To Do = amber, each In Progress
// status gets its own colour (Jira shows every status separately).
// Status overview colours + order — same as Live View: Done (green), To Do
// (blue), In Progress (yellow), In Review (red), Paused (purple); any other
// Jira status follows in its own order with the next extra colour.
var NV_STATUS_ORDER=['done','to do','in progress','in review','paused'];
function nvStatusOrder(so){
  var rank=function(r){ var i=NV_STATUS_ORDER.indexOf(String(r.name||'').toLowerCase()); return i<0?99:i; };
  var rows=(so.rows||[]).map(function(r,i){ return {r:r,i:i}; })
    .sort(function(a,b){ return (rank(a.r)-rank(b.r))||(a.i-b.i); }).map(function(x){ return x.r; });
  return Object.assign({}, so, {rows:rows});
}
function nvStatusColors(rows){
  var byName={'done':'#3ecf8e','to do':'#4c8df6','in progress':'#fdd33c','in review':'#e5484d','paused':'#9d6bf7'};
  var extra=['#22c4c4','#5b6ef5','#ff8fab','#0aaa62','#ffc56b','#d98a0b'], ix=0;
  return (rows||[]).map(function(r){
    return byName[String(r.name||'').toLowerCase()] || extra[ix++ % extra.length];
  });
}function completedSprintDaysForAlerts(d){
  // Evaluate only fully completed sprint days. For example, while D2 is in
  // progress the expected-hours alert compares logs against D1 only.
  return d && typeof d.dDone === 'number' ? d.dDone : 0;
}
// ── Expected-hours rule ──
// A person's target is their own estimate spread evenly across the
// sprint's working days — not a flat 6h/day for everyone.
//   dailyRate = est / dTot
//   expected  = dailyRate * dDone   (dDone = fully elapsed working days)
// When the Overview is on "Tasks only" the divisor becomes the person's
// task-only estimate; "Incl. bugs & polish" keeps the merged estimate.
function nvBPWithout(){ return window._bpMode === 'without'; }
function nvAsnEst(a){ return (nvBPWithout() && a && a.estEx != null) ? (a.estEx || 0) : ((a && a.est) || 0); }
function nvAsnLog(a){ return (nvBPWithout() && a && a.logEx != null) ? (a.logEx || 0) : ((a && a.log) || 0); }
function nvAsnTot(a){ return (nvBPWithout() && a && a.totEx != null) ? (a.totEx || 0) : ((a && a.tot) || 0); }
function personDailyRate(a, d){
  if(!a || !d) return 0;
  var sprintDays = d.dTot || 0;
  return sprintDays > 0 ? nvAsnEst(a) / sprintDays : 0;
}
function personExpected(a, d){
  return personDailyRate(a, d) * completedSprintDaysForAlerts(d);
}
// People with tasks but no estimate have no target to measure against —
// leaving them in would show every logged hour as fake "surplus".
function hasExpectedTarget(a){
  return !!a && a.n !== 'Unassigned' && nvAsnTot(a) > 0 && nvAsnEst(a) > 0;
}
function expectedHoursWaitingText(d){
  var start=pd(d&&d.startDate);
  var today=new Date();
  today=new Date(today.getFullYear(),today.getMonth(),today.getDate());
  if(start){
    start=new Date(start.getFullYear(),start.getMonth(),start.getDate());
    if(today<start) return 'Sprint has not started yet';
  }
  return 'No completed sprint days yet';
}
function nvStatusPill(el, rate){
  if(!el) return;
  var s = rate>=85?['good','On Track']:(rate>=60?['warn','At Risk']:['bad','Off Track']);
  el.className='nv-pill '+s[0]; el.textContent=s[1];
}

function doOverview(d){
  var COL={blue:'#4d9fff',green:'#18c97a',amber:'#f5a623',red:'#f05252',bug:'#ff4d6d',polish:'#5b6ef5'};

  // Bugs & polish filter — 'with' uses the merged totals, 'without' uses the
  // task-only mirror (d.exBP). Sprint progress / Burndown read window._bpMode
  // themselves so their drill-downs stay in sync.
  var m = (window._bpMode === 'without' && d.exBP) ? d.exBP : d;

  // Status overview donut — every work item in the sprint (sub-tasks too),
  // by Jira status, like Jira's Summary "Status overview" with a sprint filter.
  var so = nvStatusOrder(m.statusOv || d.statusOv || {rows:[],total:0,done:0,pct:0});
  var soCols = nvStatusColors(so.rows);
  window._statusOv = so;
  nvDonut('crD', so.rows.map(function(r){return r.n;}), soCols,
    function(i){ var r=so.rows[i]; if(r) nvDetail('Status · '+r.name, r.n+' work item(s)'+(nvBPWithout()?' · tasks only':''), nvTaskRows(r.items)); },
    so.rows.map(function(r){return r.name;}));
  var crc=document.getElementById('crDc');
  if(crc) crc.innerHTML='<div style="text-align:center;line-height:1.05">'+so.total
    +'<div class="nv-donut-sub">Total issues</div></div>';
  if(typeof nvFitDonutCenter==='function') nvFitDonutCenter('crD');
  var cChips=document.getElementById('ovCompChips');
  if(cChips) cChips.innerHTML=nvChips(so.rows.map(function(r,i){ return {c:soCols[i], n:r.n, l:escHtml(r.name)}; }));
  var cp=document.getElementById('ovCompPill');
  if(cp){ cp.className='nv-pill '+(so.pct>=90?'good':(so.pct>=65?'warn':'bad')); cp.textContent=so.pct+'% done'; }

  // Status grid
  var rem=Math.max(0,(d.dTot||0)-(d.dDone||0));
  // "Original Est." = the workload actually PLANNED at sprint start. Unplanned
  // work is reported separately in "Extra Hours", so it's subtracted here
  // instead of being buried inside the estimate. Total Logged and Efficiency
  // drop unplanned hours too, so all three describe the same body of work.
  var uEst    = d.unplannedEst || 0;
  var uLog    = d.unplannedLog || 0;
  var plEstV  = Math.max(0, rnd(m.totEst - uEst));
  var plLogV  = Math.max(0, rnd(m.totLog - uLog));
  var plUtil  = plEstV > 0 ? Math.round(plLogV / plEstV * 100) : 0;
  var sg=[
    {l:'Original Est.',v:fmtHours(plEstV),c:'blue', s:'Planned workload'},
    {l:'Total Logged', v:fmtHours(plLogV),c:'green',s:'Actual work done'},
    {l:'Efficiency',   v:plUtil+'%',          c:'amber',s:'Log vs estimate'},
    {l:'Extra Hours',  v:fmtHours(uEst),c:'amber',s:'Added later'},
    {l:'Days Left',    v:rem+'D',             c:'coral',s:'To sprint end'},
    {l:'Unplanned',    v:d.unplannedCount+'', c:'coral',s:'Tasks added'}
  ];
  // Third row = Jira "Sprint Completion" gadget
  var cmp=d.completion||{total:0,done:0,remaining:0,pct:0,mode:'subtasks'};
  var cWhat={subtasks:'Sub-tasks',assigned:'Assigned items',all:'Work items'}[cmp.mode]||'Work items';
  sg.push({l:'Sprint Completion',v:cmp.pct+'%',c:'green',s:cmp.done+' done',k:'done'},
          {l:'Tasks Assigned',   v:cmp.total+'',c:'blue', s:cWhat+' in sprint',k:'all'},
          {l:'Remaining Tasks',  v:cmp.remaining+'',c:'amber',s:'Not done yet',k:'rem'});
  var sgEl=document.getElementById('ovStatus');
  if(sgEl) sgEl.innerHTML=sg.map(function(x){
    return '<div class="nv-sg"'+(x.k?' style="cursor:pointer" onclick="nvCompletionDetail(\''+x.k+'\')"':'')+'><div class="v '+x.c+'">'+x.v+'</div><div class="l">'+x.l+'</div><div class="s">'+x.s+'</div></div>';
  }).join('');
  nvStatusPill(document.getElementById('ovStatusPill'), m.compRate);

  // Sprint completion + countdown (like the Jira dashboard gadgets)
  doCompletionCountdown(d);

  // Three slices: task-only unplanned (amber), leave (green), and planned (blue).
  // Leave remains visible but is excluded from unplanned hours and scope-creep percentage.
  var plEst     = rnd(d.plannedEst);
  var leaveHrs  = rnd(d.leaveCreditHours || 0);
  var unTaskHrs = rnd(d.unplannedEst || 0);
  nvDonut('scD',[unTaskHrs, leaveHrs, plEst],[COL.amber, COL.green, COL.blue], function(i){
    nvScopeDetail(i===0 ? 'unplanned' : (i===1 ? 'leave' : 'planned'));
  });
  var scopeCreepPct=plEst>0?Math.round(unTaskHrs/plEst*100):0;
  var sdc=document.getElementById('scDc'); if(sdc) sdc.textContent=scopeCreepPct+'%'; if(typeof nvFitDonutCenter==='function') nvFitDonutCenter('scD');
  var sChips=document.getElementById('ovScopeChips');
  if(sChips) sChips.innerHTML=nvChips([
    {c:COL.amber,n:unTaskHrs,l:'Unplanned hrs'},
    {c:COL.green,n:leaveHrs, l:'Leave hrs'},
    {c:COL.blue, n:plEst,    l:'Planned hrs'}
  ]);

  // Missing hours
  doOverviewAlerts(d);

  // Sprint progress (demo design, clickable dept tiles) + burndown + goal
  doSprintProgress(d);
  doBurn(d);
  doSprintGoal(d);
}

// Alerts card — people behind their estimate-weighted pace for this sprint.
function doOverviewAlerts(d){
  var listEl=document.getElementById('ovAlertList'), footEl=document.getElementById('ovAlertFoot'), pill=document.getElementById('ovAlertPill');
  if(!listEl) return;
  var daysDone=completedSprintDaysForAlerts(d), rows=buildSidebarAlertRows(d);
  if(pill){ pill.className='nv-pill '+(rows.length?'bad':'good'); pill.textContent=rows.length+' behind'; }
  if(footEl){ footEl.innerHTML=''; footEl.style.display='none'; }
  if(daysDone<=0){ listEl.innerHTML='<div class="nv-mh-empty">'+expectedHoursWaitingText(d)+'. The active day will be evaluated on the next working day.</div>'; return; }
  if(!rows.length){ listEl.innerHTML='<div class="nv-mh-empty">All caught up — no one is below their expected sprint pace.</div>'; return; }
  var y=0;
  listEl.innerHTML='<div class="nv-mh-section" style="top:0">Behind expected hours</div>'+rows.map(function(r){
    y+= (y===0?18:42);
    var p=r.expected>0?Math.round(r.logged/r.expected*100):0;
    return '<div class="nv-mh" style="top:'+y+'px"><div class="top"><span class="nm">'+escHtml(r.n)+'</span><span class="vl">-'+rnd(Math.abs(r.miss))+' hrs</span></div>'
      +'<div class="bar"><i style="width:'+p+'%;background:#5b6ef5"></i><i style="width:'+(100-p)+'%;background:#f05252"></i></div></div>';
  }).join('')+'<div aria-hidden="true" style="height:'+(y+40)+'px;pointer-events:none"></div>';
}

function buildSidebarAlertRows(d){
  var expectedDays = completedSprintDaysForAlerts(d);
  var active = (d && d.assignees ? d.assignees : []).filter(hasExpectedTarget);
  return active.map(function(a){
    var expected = personExpected(a, d);
    var logged = Math.min(nvAsnLog(a), expected);
    var miss = logged - expected;
    return { n:a.n, team:a.team || '', rate:personDailyRate(a, d), expected:expected, logged:logged, miss:miss };
  }).filter(function(r){ return r.miss < 0; }).sort(function(x,y){ return x.miss - y.miss; });
}

function doSidebarAlerts(d){
  var panel = document.getElementById('sbAlerts');
  var countEl = document.getElementById('sbAlertsCount');
  var subEl = document.getElementById('sbAlertsSub');
  var listEl = document.getElementById('sbAlertsList');
  if(!panel || !countEl || !subEl || !listEl) return;

  var rows = buildSidebarAlertRows(d);
  var daysDone = completedSprintDaysForAlerts(d);
  countEl.textContent = rows.length;
  subEl.textContent = daysDone > 0
    ? 'Expected pace after ' + daysDone + ' of ' + (d.dTot||0) + ' sprint working days'
    : expectedHoursWaitingText(d);

  panel.onclick = rows.length ? function(){ nvSidebarAlertsDetail(); } : null;
  panel.setAttribute('aria-disabled', rows.length ? 'false' : 'true');
  panel.style.cursor = rows.length ? 'pointer' : 'default';

  if(!rows.length){
    if(daysDone<=0){
      listEl.innerHTML = '<div class="sb-alert-item"><div class="sb-alert-main"><div class="sb-alert-name">Waiting for D1 to finish</div><div class="sb-alert-meta">The active day will be evaluated on the next working day.</div></div></div>';
      return;
    }
    listEl.innerHTML = '<div class="sb-alert-item"><div class="sb-alert-main"><div class="sb-alert-name">All caught up</div><div class="sb-alert-meta">No one is below their expected sprint pace right now.</div></div></div>';
    return;
  }

  listEl.innerHTML = rows.map(function(r){
    var shortfall = Math.abs(r.miss);
    return '<div class="sb-alert-item">'
      + '<span class="sb-alert-dot"></span>'
      + '<div class="sb-alert-main">'
        + '<div class="sb-alert-name">' + escHtml(r.n) + '</div>'
        + '<div class="sb-alert-meta">Expected ' + rnd(r.rate) + ' hrs/day · Logged ' + rnd(r.logged) + ' hrs</div>'
      + '</div>'
      + '<div class="sb-alert-miss">-' + rnd(shortfall) + ' hrs</div>'
    + '</div>';
  }).join('');
}

function nvSidebarAlertsDetail(){
  var d = window._sprintData; if(!d) return;
  var rows = buildSidebarAlertRows(d);
  var daysDone = completedSprintDaysForAlerts(d);
  var html = rows.length ? rows.map(function(r){
    var shortfall = Math.abs(r.miss);
    var progress = r.expected > 0 ? Math.max(0, Math.min(100, Math.round(r.logged / r.expected * 100))) : 0;
    return '<div class="nv-dt-row">'
      + '<div class="nv-dt-main">'
        + '<div class="nv-dt-name">' + escHtml(r.n) + '</div>'
        + (r.team ? '<div class="nv-dt-sub">' + escHtml(r.team) + '</div>' : '')
      + '</div>'
      + '<div class="nv-dt-meta" style="flex-direction:column;align-items:flex-end;gap:6px">'
        + '<span class="nv-dt-hrs">Expected ' + rnd(r.rate) + ' hrs/day × ' + daysDone + ' of ' + (d.dTot||0) + ' sprint days = ' + rnd(r.expected) + ' hrs · Logged ' + rnd(r.logged) + ' hrs</span>'
        + '<span class="badge red">Missing ' + rnd(shortfall) + ' h</span>'
        + '<div style="width:160px;height:5px;background:var(--sur2);border-radius:3px;overflow:hidden;display:flex">'
          + '<i style="width:' + progress + '%;background:#5b6ef5"></i>'
          + '<i style="width:' + (100 - progress) + '%;background:#f05252"></i>'
        + '</div>'
      + '</div>'
    + '</div>';
  }).join('') : '<div class="nv-dt-empty">No one is below their expected sprint pace right now.</div>';

  nvDetail('Alerts', rows.length + ' person(s) behind · ' + daysDone + ' of ' + (d.dTot||0) + ' sprint working days completed', html, 'alert');
}

// Combined work-item list (leaf tasks + subtasks + bugs + polish), mirrors process()
// Jira sprint counting: top-level work items (sub-task hours are in the parent's Σ).
function nvAllItems(d){
  return (d.tasks||[]).concat(d.bugs||[]).concat(d.polish||[]);
}
function nvRawTaskItems(d){
  return ((d&&d.tasks)||[]).concat((d&&d.bugs)||[], (d&&d.polish)||[]);
}
/* Overview-only item builders. They mirror nvRawTaskItems but drop
   bugs + polish while the toggle is on "Tasks only", so every list opened from
   an Overview card matches the numbers printed on that card. Other pages keep
   using the unfiltered builders above. */
function nvOvRawTaskItems(d){
  var list = ((d&&d.tasks)||[]).slice();
  if(!nvBPWithout()) list = list.concat((d&&d.bugs)||[], (d&&d.polish)||[]);
  return list;
}
function nvItemKey(t){
  return [t&&(t.taskName||t.name)||'', t&&t.assignee||'', t&&t.status||'', t&&t.parentTask||''].join('|');
}
/* Team hours roll-up for the Sprint progress tiles. 'with' reuses the server
   totals untouched; 'without' rebuilds them from tasks + subtasks only, then
   re-adds credited leave (leave is personal credit, not bug/polish work). */
function nvOvDeptLookup(d){
  var lookup = {};
  if(!nvBPWithout()){
    ((d.rawDeptTotals&&d.rawDeptTotals.length?d.rawDeptTotals:d.deptTotals)||[]).forEach(function(x){ lookup[x.n] = x; });
    return lookup;
  }
  ((d&&d.tasks)||[]).concat((d&&d.subtasks)||[]).forEach(function(t){
    var team = String(t.teamCategory||t.team||'').trim();
    if(!team) return;
    if(!lookup[team]) lookup[team] = {n:team, est:0, log:0};
    lookup[team].est += parseFloat(t.estTime!=null?t.estTime:t.est)||0;
    lookup[team].log += parseFloat(t.timeLog!=null?t.timeLog:t.log)||0;
  });
  ((d&&d.appliedLeaves)||[]).forEach(function(l){
    if(!l.team) return;
    if(!lookup[l.team]) lookup[l.team] = {n:l.team, est:0, log:0};
    lookup[l.team].log += l.hours||0;
  });
  return lookup;
}
function nvTeamTaskCounts(d){
  var counts = {};
  nvOvRawTaskItems(d).forEach(function(t){
    var team = (t.teamCategory||t.team||'').trim();
    if(!team) return;
    if(!counts[team]) counts[team] = {done:0,total:0};
    counts[team].total++;
    if(nvIsDone(t)) counts[team].done++;
  });
  return counts;
}
function nvIsDone(t){ return (t.status||'').trim()==='Done'; }
function nvItemUnplanned(t){ return !!(t && t.addedAfterStart); }
// Jira status as shown in Jira (logic uses the status category in t.status).
function stName(t){ return (t && (t.statusName || t.status)) || ''; }
function nvTaskRows(items){
  if(!items || !items.length) return '<div class="nv-dt-empty">No items to show.</div>';
  return items.map(function(t){
    var name=t.taskName||t.name||'—';
    var who =t.assignee||t.asn||'';
    var team=t.teamCategory||t.team||'';
    var st  =(t.status||'').trim();
    var est =parseFloat(t.estTime!=null?t.estTime:t.est)||0;
    var log =parseFloat(t.timeLog!=null?t.timeLog:t.log)||0;
    var sc  =st==='Done'?'g':((st==='In Progress'||st==='In Review'||st==='Build Awaiting')?'b':'m');
    var loadPct=est>0?Math.max(0,Math.min(100,Math.round(log/est*100))):0;
    var loadCol=log>est?'var(--red)':(st==='Done'?'var(--grn)':(log>0?'var(--acc)':'var(--mut)'));
    var sub =[who,team].filter(Boolean).join(' · ');
    // Status dot — same colours as the individual progress pop-up (renderMmSub).
    var dotCol=st==='Done'?'var(--grn)':(st==='In Progress'?'var(--acc)':(/re-?open/i.test(stName(t))?'var(--red)':'var(--mut)'));
    return '<div class="nv-dt-row"><span class="mm-sub-dot nv-dt-dot" style="background:'+dotCol+'"></span><div class="nv-dt-main"><div class="nv-dt-name">'+escHtml(name)+'</div>'
      +(sub?'<div class="nv-dt-sub">'+escHtml(sub)+'</div>':'')+'</div>'
      +'<div class="nv-dt-meta"><span class="nv-dt-badge '+sc+'">'+escHtml(stName(t)||'—')+'</span>'
      +'<span class="nv-dt-load"><i style="width:'+loadPct+'%;background:'+loadCol+'"></i></span>'
      +'<span class="nv-dt-hrs">'+rnd(log)+' / '+rnd(est)+' h</span></div></div>';
  }).join('');
}
function nvScopeDetail(kind){
  var d=window._sprintData; if(!d) return;
  if(kind==='unplanned'){
    // Task-only unplanned hours (leave now has its own 'leave' view).
    var taskUnHrs = rnd((d.unplannedEst||0) - (d.leaveCreditHours||0));
    if(taskUnHrs < 0) taskUnHrs = 0;
    nvDetail('Scope creep · Unplanned', (d.unplanned||[]).length+' task(s) · '+taskUnHrs+' hrs', nvTaskRows(d.unplanned||[]));
  } else if(kind==='leave'){
    // Aggregate every credited leave day by person → "hours to cover".
    // Two leave days for one person = 12h, three = 18h, and so on.
    var byPerson={};
    (d.appliedLeaves||[]).forEach(function(l){
      var name=l.fullName||'Unknown';
      if(!byPerson[name]) byPerson[name]={name:name, team:l.team||'', hours:0, days:0};
      byPerson[name].hours += (l.hours||6);
      byPerson[name].days  += 1;
    });
    var rows=Object.keys(byPerson).map(function(k){return byPerson[k];})
      .sort(function(a,b){ return b.hours - a.hours; });
    var totalHrs=rnd(rows.reduce(function(s,r){ return s + r.hours; }, 0));
    var html = rows.length ? rows.map(function(r){
      var meta = (r.team ? escHtml(r.team)+' · ' : '') + r.days + ' leave day'+(r.days===1?'':'s');
      return '<div class="nv-dt-row">'
        + '<div class="nv-dt-main"><div class="nv-dt-name">'+escHtml(r.name)+'</div>'
        + '<div class="nv-dt-sub">'+meta+'</div></div>'
        + '<div class="nv-dt-meta"><span class="nv-dt-badge g">'+rnd(r.hours)+' hrs to cover</span></div>'
        + '</div>';
    }).join('') : '<div class="nv-dt-empty">No leave credited this sprint.</div>';
    nvDetail('Scope creep · Leave', rows.length+' person(s) · '+totalHrs+' hrs to cover', html);
  } else {
    var list=nvAllItems(d).filter(function(t){ return !nvItemUnplanned(t); });
    nvDetail('Scope · Planned work', list.length+' item(s) · '+rnd(d.plannedEst)+' hrs', nvTaskRows(list));
  }
}

function nvPersonDetail(name){
  var d=window._sprintData; if(!d || !name) return;
  if(typeof openMemberDetail === 'function'){
    openMemberDetail(name);
    return;
  }
  var key = mmNormName(name);
  var list=nvRawTaskItems(d).filter(function(t){ return mmNormName(t.assignee||t.asn||'')===key; });
  var done=list.filter(nvIsDone).length;
  nvDetail(name, done+'/'+list.length+' done', nvTaskRows(list));
}
/* Sprint-progress tile click — same view as nvTeamDetail but honours the
   Overview toggle. The Team page keeps calling nvTeamDetail() unfiltered. */
function nvOvTeamDetail(name){
  var d=window._sprintData; if(!d || !name) return;
  var list = nvOvRawTaskItems(d).filter(function(t){ return (t.teamCategory||t.team||'') === name; });
  var seen = {};
  list = list.filter(function(t){
    var key = nvItemKey(t);
    if(seen[key]) return false;
    seen[key] = true;
    return true;
  });
  var done=list.filter(nvIsDone).length;
  nvDetail(name+' — team progress', done+'/'+list.length+' done'+(nvBPWithout()?' · tasks only':''), nvTaskRows(list));
}
function nvTeamDetail(name){
  var d=window._sprintData; if(!d || !name) return;
  var list = nvRawTaskItems(d).filter(function(t){ return (t.teamCategory||t.team||'') === name; });
  var seen = {};
  list = list.filter(function(t){
    var key = [t.taskName||t.name||'', t.assignee||t.asn||'', t.status||'', t.parentTask||''].join('|');
    if(seen[key]) return false;
    seen[key] = true;
    return true;
  });
  var done=list.filter(nvIsDone).length;
  var totalItems = list.length;
  nvDetail(name+' — team progress', done+'/'+totalItems+' done', nvTaskRows(list));
}

/* ── SPRINT PROGRESS (demo design): day badges + clickable dept tiles ── */
function doSprintProgress(d){
  // Mode-aware completion figure — drives the On/Off Track badge.
  var m = (nvBPWithout() && d.exBP) ? d.exBP : d;
  var pct=d.dTot>0?Math.min(100,Math.round(d.dDone/d.dTot*100)):0;
  var rem=Math.max(0,d.dTot-d.dDone);
  var timePct=d.dTot>0?(d.dDone/d.dTot*100):0;
  // Badge 1: days remaining
  var b1=document.getElementById('spBadge');
  if(b1){
    var s1=rem===0?['good','Sprint complete']:(rem===1?['bad','Last day']:[(rem<=3?'warn':'good'),rem+' days remaining']);
    b1.className='nv-pill '+s1[0]; b1.textContent=s1[1];
  }
  // Badge 2: on/off track (work done vs time elapsed)
  var b2=document.getElementById('spBadge2');
  if(b2){
    if(rem===0){ b2.style.display='none'; }
    else { b2.style.display='';
      var onTrack = m.compRate >= (timePct-12);
      b2.className='nv-pill '+(onTrack?'good':'bad'); b2.textContent=onTrack?'On Track':'Off Track';
    }
  }
  var dt=document.getElementById('spDates'); if(dt) dt.textContent=(d.startDate||'')+' — '+(d.endDate||'');
  var pe=document.getElementById('spPct'); if(pe) pe.textContent=pct+'% complete';
  var fl=document.getElementById('spFill'); if(fl) fl.style.width=pct+'%';
  // day badges
  var days=document.getElementById('spDays');
  if(days){
    var cells='<span class="nv-day past" title="Planning day (excluded)">D0</span>';
    for(var i=1;i<=Math.min(d.dTot,30);i++){
      var cls=i<=d.dDone?'past':((i===d.dDone+1 && rem>0)?'now':'future');
      cells+='<span class="nv-day '+cls+'">D'+i+'</span>';
    }
    days.innerHTML=cells;
  }
  // clickable dept tiles
  var depts=document.getElementById('spDepts');
  if(depts){
    var deptLookup = nvOvDeptLookup(d);
    var teamCountLookup = nvTeamTaskCounts(d);
    // In "Tasks only" mode a team whose sprint work was purely bugs/polish has
    // nothing left to show, so it drops out of the tile row entirely.
    var teamList = (d.teams||[]);
    if(nvBPWithout()) teamList = teamList.filter(function(t){ return !!teamCountLookup[t.n]; });
    depts.innerHTML=teamList.map(function(t){
      var roll = deptLookup[t.n] || {est:0,log:0};
      var counts = teamCountLookup[t.n] || {done:0,total:0};
      var tp=pc(counts.done,counts.total);
      var col=tp>=80?'var(--grn)':(tp>=50?'var(--amb)':'var(--red)');
      return '<div class="nv-dept'+(window._space==='MSSD'?' mssd-dept':'')+'" onclick="nvOvTeamDetail(\''+escAttr(t.n)+'\')" title="Click to see '+escAttr(t.n)+' tasks">'
        +'<div class="top"><span class="nm">'+escHtml(t.n)+'</span><span class="pc" style="color:'+col+'">'+tp+'%</span></div>'
        +'<div class="tr"><i style="width:'+tp+'%;background:'+col+'"></i></div>'
        +'<div class="mt">'+counts.done+'/'+counts.total+' done · '+rnd(roll.log||0)+'/'+rnd(roll.est||0)+' hrs</div></div>';
    }).join('') || '<div class="nv-dt-empty">No team data.</div>';
  }
}

/* ── SPRINT GOAL ── */
function doSprintGoal(d){
  var el=document.getElementById('sprintGoalBox');
  if(!el) return;
  var sid=(d.spInfo&&d.spInfo.id)||'default';

  // Load from API (Sheet) if available — takes priority over localStorage
  var sheetGoal = d.sprintGoals && d.sprintGoals[sid];
  if(sheetGoal && sheetGoal.text){
    localStorage.setItem('sg_'+sid, JSON.stringify({
      text: sheetGoal.text,
      updatedAt: sheetGoal.updatedAt||'',
      synced: true
    }));
  }
  renderSprintGoal(sid, el);
}

// Markdown-lite parser
function sgParse(text){
  var lines=text.split('\n'), html='', inList=false, inSub=false;
  function closeList(){if(inSub){html+='</ul>';inSub=false;}if(inList){html+='</ul>';inList=false;}}
  function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  lines.forEach(function(raw){
    var line=raw.replace(/\s+$/,'');
    if(!line.trim()){closeList();return;}
    if(/^##\s+/.test(line)){closeList();html+='<h4>'+esc(line.replace(/^##\s+/,''))+'</h4>';return;}
    if(/^#\s+/.test(line)){closeList();html+='<h3>'+esc(line.replace(/^#\s+/,''))+'</h3>';return;}
    if(/^\s*(--|\*\*)\s+/.test(line)){
      if(!inList){html+='<ul>';inList=true;}
      if(!inSub){html+='<ul>';inSub=true;}
      html+='<li>'+esc(line.replace(/^\s*(--|\*\*)\s+/,''))+'</li>';return;
    }
    if(/^\s*[-*•]\s+/.test(line)){
      if(inSub){html+='</ul>';inSub=false;}
      if(!inList){html+='<ul>';inList=true;}
      html+='<li>'+esc(line.replace(/^\s*[-*•]\s+/,''))+'</li>';return;
    }
    closeList();
    html+='<p>'+esc(line)+'</p>';
  });
  closeList();
  return html;
}

function sgInsert(sid, prefix){
  var ta=document.getElementById('sgInputCur')||document.getElementById('sgInput_'+sid); if(!ta) return;
  var s=ta.selectionStart, e=ta.selectionEnd;
  var before=ta.value.substring(0,s), sel=ta.value.substring(s,e), after=ta.value.substring(e);
  var nl=before.length>0&&before[before.length-1]!=='\n'?'\n':'';
  var ins=nl+prefix+(sel||'');
  ta.value=before+ins+after;
  ta.focus(); ta.setSelectionRange(s+ins.length, s+ins.length);
  sgLivePreview(sid);
}

function sgLivePreview(sid){
  var ta=document.getElementById('sgInputCur')||document.getElementById('sgInput_'+sid);
  var pv=document.getElementById('sgPreviewCur')||document.getElementById('sgPreview_'+sid);
  if(!ta||!pv) return;
  var txt=ta.value.trim();
  pv.innerHTML=txt
    ? '<div class="sg-display">'+sgParse(txt)+'</div>'
    : '<div style="color:var(--mut);font-size:12px;padding:8px">Preview will appear here…</div>';
}

function renderSprintGoal(sid, el, editing){
  var key='sg_'+sid;
  var stored=localStorage.getItem(key);
  var data=stored?JSON.parse(stored):{text:'',updatedAt:'',synced:false};
  var isEmpty=!data.text||!data.text.trim();
  var sprintLabel=cur||sid;
  window._sgSid=sid;

  if(editing){
    el.innerHTML=
      '<div class="sg-card">'
      +'<div class="sg-header">'
      +'<div><div class="sg-header-title">Editing goal &#8212; '+sprintLabel+'</div>'
      +'<div class="sg-header-sub">Changes will be saved to Google Sheets</div></div>'
      +'<div class="sg-actions">'
      +'<button class="sg-btn" onclick="renderSprintGoal(window._sgSid,document.getElementById(\'sprintGoalBox\'))">Cancel</button>'
      +'<button class="sg-btn primary" id="sgSaveBtnCur" onclick="saveSprintGoal(window._sgSid)">Save to Sheet</button>'
      +'</div></div>'
      +'<div class="sg-body">'
      +'<div class="sg-toolbar" style="margin-bottom:10px">'
      +'<span style="font-size:10px;color:var(--mut);margin-right:4px">Insert:</span>'
      +'<button class="sg-tb-btn" onclick="sgInsert(window._sgSid,\'# \')">Heading</button>'
      +'<button class="sg-tb-btn" onclick="sgInsert(window._sgSid,\'## \')">Subheading</button>'
      +'<button class="sg-tb-btn" onclick="sgInsert(window._sgSid,\'- \')">Bullet</button>'
      +'<button class="sg-tb-btn" onclick="sgInsert(window._sgSid,\'-- \')">Sub-bullet</button>'
      +'</div>'
      +'<div class="sg-editor-wrap">'
      +'<div class="sg-editor-side">'
      +'<div class="sg-editor-label">Write</div>'
      +'<textarea class="sg-input" id="sgInputCur" placeholder="# Development&#10;- Android Build 1.31.0&#10;&#10;# Design&#10;- Situational Deals and Offers&#10;&#10;# Art&#10;- Summer Season Pass" oninput="sgLivePreview(window._sgSid)">'+(data.text||'').replace(/</g,'&lt;')+'</textarea>'
      +'<div class="sg-hint">Syntax: <code># Section</code> &middot; <code>- Bullet</code> &middot; <code>-- Sub-bullet</code></div>'
      +'</div>'
      +'<div class="sg-editor-side">'
      +'<div class="sg-editor-label">Preview</div>'
      +'<div class="sg-preview-pane" id="sgPreviewCur">'
      +(data.text?'<div class="sg-display">'+sgParse(data.text)+'</div>':'<div style="color:var(--mut);font-size:12px;padding:8px">Preview will appear here&#8230;</div>')
      +'</div></div></div></div></div>';
    setTimeout(function(){
      var ta=document.getElementById('sgInputCur');
      if(ta){ta.focus();ta.setSelectionRange(ta.value.length,ta.value.length);}
    },50);
  } else {
    var syncBadge=data.synced
      ?'<span class="sg-status cloud">Synced to Sheet</span>'
      :(data.text?'<span class="sg-status local">Local only</span>':'');
    var updatedTxt=data.updatedAt
      ?'Last updated: '+(typeof data.updatedAt==='number'?new Date(data.updatedAt).toLocaleString():data.updatedAt)
      :'';
    el.innerHTML=
      '<div class="sg-card">'
      +'<div class="sg-header">'
      +'<div><div class="sg-header-title">Sprint goal &#8212; '+sprintLabel+'</div>'
      +(isEmpty?'<div class="sg-header-sub">Define what this sprint should deliver</div>':'<div class="sg-header-sub">'+updatedTxt+'</div>')
      +'</div>'
      +'<div class="sg-actions">'
      +(isEmpty?'':'<button class="sg-btn danger" onclick="if(confirm(\'Delete sprint goal?\'))deleteSprintGoal(window._sgSid)">Delete</button>')
      +'<button class="sg-btn edit" onclick="renderSprintGoal(window._sgSid,document.getElementById(\'sprintGoalBox\'),true)">'+(isEmpty?'+ Set sprint goal':'Edit goal')+'</button>'
      +'</div></div>'
      +'<div class="sg-body">'
      +(isEmpty
        ?'<div class="sg-empty"><div class="sg-empty-icon">&#127919;</div><div class="sg-empty-txt">No sprint goal set yet.</div></div>'
        :'<div class="sg-display">'+sgParse(data.text)+'</div>'+(syncBadge?'<div class="sg-meta">'+syncBadge+'</div>':''))
      +'</div></div>';
  }
}

async function saveSprintGoal(sid){
  var ta=document.getElementById('sgInputCur')||document.getElementById('sgInput_'+sid); if(!ta) return;
  var text=ta.value.trim();
  var key='sg_'+sid;
  var btn=document.getElementById('sgSaveBtn_'+sid);
  if(btn){btn.disabled=true;btn.textContent='Saving…';}

  // Save locally first
  if(!text){localStorage.removeItem(key);}
  else{localStorage.setItem(key,JSON.stringify({text:text,updatedAt:Date.now(),synced:false}));}

  // Save to Google Sheet
  try{
    var params='?action=saveSprintGoal&sprintId='+encodeURIComponent(sid)+'&text='+encodeURIComponent(text)+'&email='+encodeURIComponent(window._userEmail||'')+tok()+'&_cb='+Date.now();
    var res=await fetch(API+params,{method:'GET',redirect:'follow'});
    var json=await res.json();
    if(json&&!json.error){
      if(text) localStorage.setItem(key,JSON.stringify({text:text,updatedAt:Date.now(),synced:true}));
    }
  }catch(e){console.warn('Sheet save failed:',e.message);}

  renderSprintGoal(sid,document.getElementById('sprintGoalBox'));
}

async function deleteSprintGoal(sid){
  localStorage.removeItem('sg_'+sid);
  try{
    await fetch(API+'?action=saveSprintGoal&sprintId='+encodeURIComponent(sid)+'&text=&email='+encodeURIComponent(window._userEmail||'')+tok()+'&_cb='+Date.now(),{redirect:'follow'});
  }catch(e){}
  renderSprintGoal(sid,document.getElementById('sprintGoalBox'));
}
function doCompletionCountdown(d){
  // Countdown to the Jira sprint end (exact date + time from Jira)
  if(_cdTimer){ clearInterval(_cdTimer); _cdTimer=null; }
  var sp=d.spInfo||{}, end=sp.endIso?new Date(sp.endIso):null;
  if(!end||isNaN(end)){ var e2=pd(sp.end); if(e2){ end=new Date(e2.getFullYear(),e2.getMonth(),e2.getDate(),23,59,59); } }
  var cd=document.getElementById('ovCd'), cs=document.getElementById('ovCdSub');
  if(!cd) return;
  function tick(){
    if(!document.body.contains(cd)){ clearInterval(_cdTimer); _cdTimer=null; return; }
    var ms=end?Math.max(0,end.getTime()-nowMs()):0;
    var dd=Math.floor(ms/864e5), hh=Math.floor(ms%864e5/36e5), mm=Math.floor(ms%36e5/6e4), ss=Math.floor(ms%6e4/1e3);
    cd.className='nv-cd'+(ms<=0?' ended':'');
    cd.innerHTML=[[dd,'Days'],[hh,'Hrs'],[mm,'Min'],[ss,'Sec']].map(function(x){ return '<div class="nv-cd-b"><div class="v">'+String(x[0]).padStart(2,'0')+'</div><div class="l">'+x[1]+'</div></div>'; }).join('');
    if(cs){
      cs.innerHTML=(sp.state==='closed'||sp.completed)?'Sprint completed'+(sp.completed?'<br>'+escHtml(sp.completed):'')
        :'Countdown';
    }
    if(ms<=0 && _cdTimer){ clearInterval(_cdTimer); _cdTimer=null; }
  }
  tick(); if(end && end.getTime()>nowMs()) _cdTimer=setInterval(tick,1000);
}
function nvCompletionDetail(k){
  var d=window._sprintData; if(!d||!d.completion) return;
  var all=d.completion.items||[], list=k==='done'?all.filter(function(t){return t.status==='Done';}):(k==='rem'?all.filter(function(t){return t.status!=='Done';}):all);
  nvDetail('Sprint completion · '+(k==='done'?'Done':k==='rem'?'Remaining':'All'), list.length+' item(s)', nvTaskRows(list));
}

/* ── BURNDOWN — Jira's Sprint Burndown gadget data (remaining time estimate),
   drawn in the dashboard's style. Falls back to the capacity burndown when
   Jira's burndown data isn't available for the sprint. ── */
// Draws a Jira-style burndown (Guideline · Remaining Values · Time Spent · non-working days).
function drawJiraBurn(canvasId, chartKey, B, pts){
  if(CH[chartKey]) CH[chartKey].destroy();
  var c=cc(), unit=B.unit==='h'?'h':' pts';
  var nw=(B.nw||[]).slice().sort(function(a,b){return a[0]-b[0];});
  var startVal=pts[0][1], total=B.end-B.start, off=nw.reduce(function(a,r){return a+(r[1]-r[0]);},0), work=Math.max(1,total-off);
  function workedTo(t){ var w=t-B.start; nw.forEach(function(r){ if(r[0]<t) w-=Math.min(t,r[1])-r[0]; }); return Math.max(0,w); }
  function idealAt(t){ return startVal*(1-workedTo(t)/work); }
  var gT=[B.start]; nw.forEach(function(r){gT.push(r[0],r[1]);}); gT.push(B.end);
  var guide=gT.map(function(t){ return {x:t,y:Math.round(idealAt(t)*100)/100}; });
  var rem=pts.map(function(x){return {x:x[0],y:x[1]};}), spent=pts.map(function(x){return {x:x[0],y:x[2]};});
  var shade={id:'nwShade',beforeDatasetsDraw:function(ch){ var a=ch.chartArea,x=ch.scales.x,ctx=ch.ctx; ctx.save(); ctx.fillStyle=isDark?'rgba(150,160,220,.07)':'rgba(0,0,0,.05)';
    nw.forEach(function(r){ var x0=Math.max(a.left,x.getPixelForValue(r[0])), x1=Math.min(a.right,x.getPixelForValue(r[1])); if(x1>x0) ctx.fillRect(x0,a.top,x1-x0,a.bottom-a.top); }); ctx.restore(); }};
  var fmtD=function(t){ return new Date(t).toLocaleDateString('en-GB',{day:'numeric',month:'short'}); };
  CH[chartKey]=new Chart(document.getElementById(canvasId),{type:'line',plugins:[shade,sprintBurnHoverPlugin()],data:{datasets:[
    {label:'Guideline',data:guide,borderColor:'#5b6ef5',borderDash:[6,4],borderWidth:2,pointRadius:0,fill:false,tension:0},
    {label:'Remaining Values',data:rem,borderColor:'#f05252',backgroundColor:'rgba(240,82,82,.12)',fill:true,borderWidth:2.5,pointRadius:0,pointHoverRadius:4,stepped:'after'},
    {label:'Time Spent',data:spent,borderColor:'#18c97a',borderWidth:2.5,pointRadius:0,pointHoverRadius:4,stepped:'after',fill:false}
  ]},options:{responsive:true,maintainAspectRatio:false,parsing:false,animation:false,events:[],
    plugins:{legend:{display:false},tooltip:{enabled:false}},
    scales:{x:{type:'linear',min:B.start,max:B.end,grid:{color:c.grid},ticks:{color:c.text,autoSkip:false,font:{family:"'Segoe UI','Segoe UI Variable',system-ui,sans-serif",size:13,weight:'800'},stepSize:864e5,callback:function(v){var day=Math.round((v-B.start)/864e5);return day>=0&&day%2===0?fmtD(v):'';}}},
            y:{beginAtZero:true,grid:{color:c.grid},ticks:{color:c.text,font:{family:"'Segoe UI','Segoe UI Variable',system-ui,sans-serif",size:13,weight:'800'}},title:{display:true,text:'Remaining time estimate'+(B.unit==='h'?' (hrs)':''),color:c.text,font:{family:"'Segoe UI','Segoe UI Variable',system-ui,sans-serif",size:13,weight:'600'}}}}}});
  CH[chartKey]._sprintBurnData={pts:pts,idealAt:idealAt,unit:unit,start:B.start,end:B.end};
  bindSprintBurnHover(document.getElementById(canvasId),chartKey);
  return {start:startVal, last:pts[pts.length-1], unit:unit};
}
function doBurn(d){
  var B=d.burn;
  var wrap=document.getElementById('burnWrap');
  if(!B||!B.p||!B.p.length){
    if(CH.b){ CH.b.destroy(); CH.b=null; }
    if(wrap) wrap.innerHTML='<div class="nv-dt-empty" style="height:100%;display:flex;align-items:center;justify-content:center;border:1px dashed var(--bor);border-radius:9px">Jira burndown data is not available for this sprint.</div>';
    return;
  }
  if(wrap && !wrap.querySelector('canvas')) wrap.innerHTML='<canvas id="bC"></canvas>';
  drawJiraBurn('bC','b',B,B.p);
}
// Team page — burndown of one person (dropdown of names)
function togglePersonBurnMenu(e){
  if(e) e.stopPropagation();
  var dd=document.getElementById('pbDD'); if(dd) dd.classList.toggle('open');
}
function selectPersonBurn(name){
  window._pbPerson=name||'';
  var dd=document.getElementById('pbDD'); if(dd) dd.classList.remove('open');
  doPersonBurn(window._sprintData);
}

function doPersonBurn(d){
  var sel=document.getElementById('pbSel'), wrap=document.getElementById('pbWrap'), info=document.getElementById('pbInfo');
  var menu=document.getElementById('pbDDMenu'), labelEl=document.getElementById('pbDDLabel');
  if(!sel||!wrap) return;
  var B=d&&d.burn, people=B&&B.people?Object.keys(B.people).sort():[];
  if(!people.length){
    sel.innerHTML='<option>—</option>'; sel.disabled=true;
    if(CH.pb){ CH.pb.destroy(); CH.pb=null; }
    wrap.style.height='70px'; wrap.innerHTML='<div style="padding:24px;text-align:center;color:var(--mut);font-size:12px">No individual burndown for this sprint yet — it appears after the next Sync Now.</div>';
    if(info) info.textContent=''; return;
  }
  sel.disabled=false;
  if(people.indexOf(window._pbPerson)===-1) window._pbPerson='';
  sel.innerHTML='<option value=""'+(!window._pbPerson?' selected':'')+'>&mdash; Select an individual &mdash;</option>'
    +people.map(function(n){ return '<option value="'+escAttr(n)+'"'+(n===window._pbPerson?' selected':'')+'>'+escHtml(n)+'</option>'; }).join('');
  if(labelEl) labelEl.textContent=window._pbPerson||'— Select an individual —';
  if(menu) menu.innerHTML='<button type="button" class="nv-burn-dd-option'+(!window._pbPerson?' on':'')+'" onclick="selectPersonBurn(\'\')">— Select an individual —</button>'
    +people.map(function(n){ return '<button type="button" class="nv-burn-dd-option'+(n===window._pbPerson?' on':'')+'" onclick="selectPersonBurn(\''+escAttr(n)+'\')">'+escHtml(n)+'</button>'; }).join('');
  if(!window._pbPerson){
    if(CH.pb){ CH.pb.destroy(); CH.pb=null; }
    wrap.style.height='220px';
    wrap.innerHTML='<div class="nv-dt-empty" style="height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:7px;border:1px dashed var(--bor);border-radius:9px"><strong style="font-size:15px;color:var(--text)">Select an individual</strong><span>Choose a team member above to view their burndown chart.</span></div>';
    if(info) info.textContent='';
    return;
  }
  wrap.style.height='300px'; if(!wrap.querySelector('canvas')) wrap.innerHTML='<canvas id="pbC"></canvas>';
  var r=drawJiraBurn('pbC','pb',B,B.people[window._pbPerson]);
  if(info && B.notStarted){ info.innerHTML='<b>'+escHtml(window._pbPerson)+':</b> '+rnd(r.start)+r.unit+' remaining estimate planned · sprint not started yet'; return; }
  if(info) info.innerHTML='<b>'+escHtml(window._pbPerson)+':</b> '+rnd(r.start)+r.unit+' remaining at sprint start → '+rnd(r.last[1])+r.unit+' now · <b>Time spent in sprint:</b> '+rnd(r.last[2])+'h';
}

/* ── TEAM PAGE (demo design): individual est-vs-logged bars + filter pills,
   scope creep by team, 4 stat tiles, unplanned bar ── */
function doTeamDemo(d){
  var COL={purple:'#9b72f5',green:'#18c97a',red:'#f05252',blue:'#5b6ef5'};
  nvStatusPill(document.getElementById('tmPill'), d.compRate);
  doPersonBurn(d);

  // Filter pills (All + each team)
  var teams=(d.teams||[]).map(function(t){return t.n;});
  var filters=['All'].concat(teams);
  if(!window._tmFilter || filters.indexOf(window._tmFilter)<0) window._tmFilter='All';
  var fr=document.getElementById('tmFilter');
  if(fr){
    fr.innerHTML=filters.map(function(f){
      return '<button class="nv-fpill'+(f===window._tmFilter?' on':'')+'" data-f="'+f.replace(/"/g,'&quot;')+'">'+f+'</button>';
    }).join('');
    fr.querySelectorAll('.nv-fpill').forEach(function(b){
      b.addEventListener('click',function(){ window._tmFilter=this.dataset.f; doTeamDemo(d); });
    });
  }

  // Chart data:
  // - All = raw department totals from every task row in Sheets
  // - specific team = assignee totals inside that team
  var rows;
  if(window._tmFilter==='All'){
    rows=((d.rawDeptTotals&&d.rawDeptTotals.length?d.rawDeptTotals:d.deptTotals)||[]).filter(function(t){ return t.n && (t.est>0 || t.log>0); }).slice();
  } else {
    rows=(d.assignees||[]).filter(function(a){ return a.n!=='Unassigned' && a.team===window._tmFilter && (a.est>0||a.log>0); }).slice();
  }
  rows.sort(function(a,b){ return (b.est||0)-(a.est||0); });
  var labels=rows.map(function(r){ return r.n; });
  var est=rows.map(function(r){ return rnd(r.est); });
  var log=rows.map(function(r){ return rnd(r.log); });
  var logCol=rows.map(function(r){ return (r.log>r.est)?COL.red:COL.green; });
  if(CH.indv) CH.indv.destroy();
  var ce=document.getElementById('indvC');
  if(ce){
    /* More vertical room keeps each estimated/logged pair visually distinct. */
    ce.parentElement.style.height=Math.max(220, labels.length*64+44)+'px';
    var c=cc();
    if(labels.length){
      CH.indv=new Chart(ce,{type:'bar',
        data:{labels:labels,datasets:[
          {label:'Est. time',data:est,backgroundColor:COL.purple,borderRadius:4,maxBarThickness:16,categoryPercentage:.76,barPercentage:.62},
          {label:'Logged',  data:log,backgroundColor:logCol,borderRadius:4,maxBarThickness:16,categoryPercentage:.76,barPercentage:.62} 
        ]},
        plugins:[{
          id:'teamBarEndLabels',
          afterDatasetsDraw:function(chart){
            var ctx=chart.ctx;

            ctx.save();
            ctx.font="800 13px 'Segoe UI', 'Segoe UI Variable', system-ui, sans-serif";
            ctx.textAlign='left';
            ctx.textBaseline='middle';

            chart.data.datasets.forEach(function(dataset,datasetIndex){
              var meta=chart.getDatasetMeta(datasetIndex);

            meta.data.forEach(function(bar,index){
              var value=dataset.data[index];
              if(value==null || !isFinite(value)) return;

              var color=Array.isArray(dataset.backgroundColor)
                ? dataset.backgroundColor[index]
                : dataset.backgroundColor;

              ctx.fillStyle=color || '#dde1f5';
              ctx.fillText(rnd(value)+'h',bar.x+7,bar.y);
            });
          });

          ctx.restore();
        }
      }],
      options:{
      indexAxis:'y',
      responsive:true,
      maintainAspectRatio:false,
      layout:{padding:{top:8,bottom:8,right:64}},

          onClick:function(evt,els,chart){
            chart = chart || CH.indv;
            if(!chart) return;
            var canvas = chart.canvas || ce;
            var yScale = chart.scales ? (chart.scales.y || chart.scales['y-axis-0']) : null;
            if(!canvas || !yScale) return;
            var rect = canvas.getBoundingClientRect();
            var nativeEvt = evt.native || evt;
            var mouseY = (typeof nativeEvt.offsetY === 'number') ? nativeEvt.offsetY : ((nativeEvt.clientY || 0) - rect.top);
            var idx = -1;
            if(typeof yScale.getValueForPixel === 'function'){
              idx = Math.round(yScale.getValueForPixel(mouseY));
            }
            if(idx == null || idx < 0 || idx >= labels.length){
              var minDist = Infinity;
              for(var i=0;i<labels.length;i++){
                var py = yScale.getPixelForValue(i);
                var dist = Math.abs(mouseY - py);
                if(dist < minDist){ minDist = dist; idx = i; }
              }
            }
            if(idx == null || idx < 0) return;
            var clickedName = labels[idx] || (chart.data && chart.data.labels ? chart.data.labels[idx] : '');
            if(!clickedName) return;
            if(window._tmFilter !== 'All'){
              nvPersonDetail(clickedName);
              return;
            }
            var r = rows.filter(function(row){ return row.n === clickedName; })[0] || rows[idx];
            if(!r) return;
            var isTeamLabel = (d.teams||[]).some(function(t){ return t.n === r.n; });
            if(isTeamLabel) nvTeamDetail(r.n); else nvPersonDetail(r.n);
          },
          onHover:function(evt,els){ if(evt.native) evt.native.target.style.cursor=els.length?'pointer':'default'; },
          plugins:{legend:{display:false},tooltip:{callbacks:{label:function(ctx){return '  '+ctx.dataset.label+': '+ctx.parsed.x+' hrs';},afterBody:function(){return window._tmFilter==='All'?'\nClick for team breakdown':'\nClick for task breakdown';}}}},
          scales:{x:{beginAtZero:true,grid:{color:c.grid},ticks:{color:c.text,font:{family:"'Segoe UI','Segoe UI Variable',system-ui,sans-serif",size:13,weight:'800'},padding:8}},
            y:{grid:{display:false},ticks:{color:c.text,padding:13,font:{family:"'Segoe UI','Segoe UI Variable',system-ui,sans-serif",weight:'700',size:14}}}}}});
    } else {
      ce.parentElement.innerHTML='<div class="empty" style="padding:30px;text-align:center;color:var(--mut)">No data for this team.</div>';
    }
  }

  // Scope creep by team
  var scEl=document.getElementById('tmScRows');
  if(scEl){
    var rows=(d.scope||[]).filter(function(s){return (s.tot||0)>0;});
    scEl.innerHTML=rows.length ? rows.map(function(s){
      var tot=s.tot||1, unp=Math.round(s.un/tot*100), pl=100-unp;
      return '<div class="nv-sc-row"><span class="nv-sc-name">'+s.n+'</span>'
        +'<span class="nv-sc-track"><i style="width:'+pl+'%;background:#5b6ef5"></i>'
        +(unp>0?'<i style="width:'+unp+'%;background:#f05252"></i>':'')+'</span>'
        +'<span class="nv-sc-pct">'+unp+'% unplanned</span></div>';
    }).join('') : '<div class="nv-team-sub">No team data.</div>';
  }

  // Stat tiles
  var hi=d.healthImpact||0;
  var teamPlanNote = 'Sprint estimate: ' + fmtHours(d.totEst) + ' · Department rollup used by the All teams: ' + fmtHours(d.rawDeptEstTotal != null ? d.rawDeptEstTotal : (d.deptEstTotal != null ? d.deptEstTotal : d.totEst));
  var stats=[
    {v:d.unplannedCount+'',        l:'Unplanned tasks added',    c:'#f05252'},
    {v:fmtHours(d.unplannedEst),    l:'Extra hours (unplanned)',  c:'#f5a623'},
    {v:fmtHours(d.plannedEst != null ? d.plannedEst : d.totEst),    l:'Originally planned hours',  c:'#9b72f5', sub:teamPlanNote},
    {v:hi+'%',                      l:'Sprint health impact',     c:(hi<=10?'#18c97a':(hi<=20?'#f5a623':'#f05252'))}
  ];
  var stEl=document.getElementById('tmStats');
  if(stEl) stEl.innerHTML=stats.map(function(s){
    return '<div class="nv-stat-tile"><span class="num" style="color:'+s.c+'">'+s.v+'</span><div><div class="lab">'+s.l+'</div>'+(s.sub?'<div style="font-size:9px;color:var(--mut);margin-top:4px;line-height:1.4">'+s.sub+'</div>':'')+'</div></div>';
  }).join('');

  // Unplanned bar
  var ub=document.getElementById('tmUnplanned');
  if(ub) ub.innerHTML='<div class="nv-ub-left"><span class="nv-ub-title">Unplanned tasks</span>'
    +'<span class="nv-ub-badge">'+d.unplannedCount+'</span></div>'
    +'<span class="nv-ub-meta">'+d.unplannedCount+' task(s) added after sprint start · '+rnd(d.unplannedEst)+' hrs</span>';
}
function doSubtasks(d){
  var el=document.getElementById('subS');
  if(!el) return;
  var groups=d.subtaskGroups||{};
  var keys=Object.keys(groups);
  if(!keys.length){
    el.innerHTML='<div class="empty">No subtasks found in this sprint.</div>';
    return;
  }

  // Sort by completion % ascending (least done first)
  keys.sort(function(a,b){
    var da=groups[a].filter(function(s){return(s.status||'').trim()==='Done';}).length/groups[a].length;
    var db=groups[b].filter(function(s){return(s.status||'').trim()==='Done';}).length/groups[b].length;
    return da-db;
  });

  // Summary stats
  var totalParents=keys.length;
  var totalSubs=0, totalDone=0, totalEst=0, totalLog=0;
  keys.forEach(function(k){ groups[k].forEach(function(s){
    totalSubs++; if((s.status||'').trim()==='Done')totalDone++;
    totalEst+=parseFloat(s.estTime)||0; totalLog+=parseFloat(s.timeLog)||0;
  });});
  var overallPct=pc(totalDone,totalSubs);

  // Filter buttons
  var filters='<div class="sub-filter-row">'
    +'<button class="sub-filter-btn'+(subFilter==='all'?' on':'')+'" onclick="subFilter=\'all\';doSubtasks(window._sprintData)">All ('+totalParents+')</button>'
    +'<button class="sub-filter-btn'+(subFilter==='progress'?' on':'')+'" onclick="subFilter=\'progress\';doSubtasks(window._sprintData)">In Progress</button>'
    +'<button class="sub-filter-btn'+(subFilter==='done'?' on':'')+'" onclick="subFilter=\'done\';doSubtasks(window._sprintData)">Completed</button>'
    +'<button class="sub-filter-btn'+(subFilter==='blocked'?' on':'')+'" onclick="subFilter=\'blocked\';doSubtasks(window._sprintData)">Not Started</button>'
    +'<span style="margin-left:auto;font-size:11px;color:var(--mut)">'+totalDone+'/'+totalSubs+' subtasks done ('+overallPct+'%) · '+rnd(totalLog)+'/'+rnd(totalEst)+' hrs</span>'
    +'</div>';

  // Filter keys
  var filteredKeys=keys.filter(function(k){
    if(subFilter==='all') return true;
    var subs=groups[k];
    var done=subs.filter(function(s){return(s.status||'').trim()==='Done';}).length;
    if(subFilter==='done') return done===subs.length;
    if(subFilter==='progress') return done>0 && done<subs.length;
    if(subFilter==='blocked') return done===0;
    return true;
  });

  // Wrap entire subtask section in a collapsible dropdown (like Bugs list)
  var summaryTxt = totalParents+' parent task'+(totalParents===1?'':'s')+' · '+totalDone+'/'+totalSubs+' subtasks done ('+overallPct+'%)';
  var html = '<div class="bugs-dd-header" onclick="toggleSubtaskList()" id="subDdHeader">'
    + '<div class="bugs-dd-title">'
    + '<span class="bugs-dd-chev">▶</span>'
    + '<span class="cc-t" style="margin:0">Subtask breakdown</span>'
    + '<span class="bugs-dd-count">'+totalSubs+'</span>'
    + '</div>'
    + '<div class="cc-s" style="margin:0">'+summaryTxt+'</div>'
    + '</div>'
    + '<div class="bugs-dd-body" id="subDdBody" style="display:none">';

  // Inner content: filter buttons + scrollable table
  html += filters+'<div style="max-height:600px;overflow-y:auto;border:1px solid var(--bor);border-radius:10px">'
    +'<table class="sub-table"><thead><tr><th>Task</th><th>Status</th><th>Progress</th><th>Est.</th><th>Logged</th></tr></thead><tbody>';

  filteredKeys.forEach(function(parent,pi){
    var subs=groups[parent];
    var doneCount=subs.filter(function(s){return(s.status||'').trim()==='Done';}).length;
    var pctVal=Math.round(doneCount/subs.length*100);
    var col=pctVal>=100?'var(--grn)':(pctVal>=50?'var(--amb)':'var(--red)');
    var pEst=0,pLog=0; subs.forEach(function(s){pEst+=parseFloat(s.estTime)||0;pLog+=parseFloat(s.timeLog)||0;});
    var pid='sp_'+pi;

    html+='<tr class="sub-parent-row" onclick="toggleSubRows(\''+pid+'\')" id="'+pid+'_h">'
      +'<td><span class="sub-arrow">▶</span>'+trunc(parent,55)+' <span style="font-size:10px;color:var(--mut);font-weight:400">('+subs.length+')</span></td>'
      +'<td><span style="color:'+col+';font-size:11px;font-weight:700">'+doneCount+'/'+subs.length+'</span></td>'
      +'<td style="text-align:right"><span style="color:'+col+';font-size:11px;font-weight:600">'+pctVal+'%</span>'
      +'<div class="sub-pbar"><div class="sub-pbar-fill" style="width:'+pctVal+'%;background:'+col+'"></div></div></td>'
      +'<td style="text-align:right;font-size:11px">'+rnd(pEst)+'h</td>'
      +'<td style="text-align:right;font-size:11px">'+rnd(pLog)+'h</td>'
      +'</tr>';

    subs.forEach(function(s){
      var est=parseFloat(s.estTime)||0,log=parseFloat(s.timeLog)||0;
      var isDone=(s.status||'').trim()==='Done';
      var st=stName(s)||'To Do';
      var stCls=isDone?'grn':(s.status==='In Progress'?'amb':'');
      html+='<tr class="sub-child-row'+(isDone?' done':'')+'" data-parent="'+pid+'" style="display:none">'
        +'<td>'+trunc(s.taskName,50)+'</td>'
        +'<td><span class="badge '+stCls+'">'+st+'</span></td>'
        +'<td></td>'
        +'<td style="text-align:right;font-size:10px">'+rnd(est)+'h</td>'
        +'<td style="text-align:right;font-size:10px">'+rnd(log)+'h</td>'
        +'</tr>';
    });
  });

  html+='</tbody></table></div></div>'; // close table-wrap + bugs-dd-body
  el.innerHTML=html;
}

function toggleSubtaskList(){
  var header = document.getElementById('subDdHeader');
  var body   = document.getElementById('subDdBody');
  if(!header || !body) return;
  var isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  header.classList.toggle('open', !isOpen);
}

function toggleSubRows(pid){
  var header=document.getElementById(pid+'_h');
  var rows=document.querySelectorAll('[data-parent="'+pid+'"]');
  var isOpen=header.classList.contains('open');
  header.classList.toggle('open');
  rows.forEach(function(r){r.style.display=isOpen?'none':'table-row';});
}

function doBugsBacklog(d){
  var el=document.getElementById('bugsS');
  window._bugsData = d; // store for tab callbacks
  var dateHint = d.startDate && d.endDate ? d.startDate+' \u2013 '+d.endDate : '';

  // d.bugs    = active Bug-type tickets (Priority ≠ Deferred)
  // d.bugsRaw = every Bug-type ticket (audit view, includes Deferred)
  var allBugs = d.bugsRaw || d.bugs || [];
  var currentBugs = d.bugs || [];
  if(!d.bugsRaw && d.allBugsTotal > currentBugs.length){
    allBugs = currentBugs;
  }

  if(!currentBugs.length && !allBugs.length){
    el.innerHTML='<div class="empty">No bugs found. Total in Bugs section: '+(d.allBugsTotal||0)+'</div>';
    return;
  }

  // Assignee filter pills — built from whichever list the active tab uses
  function uniqueAssignees(list){
    var seen = {}; var out = [];
    list.forEach(function(b){
      var a = (b.assignee||'Unassigned').trim() || 'Unassigned';
      if(!seen[a]){ seen[a] = true; out.push(a); }
    });
    return out.sort();
  }

  // Compute stats for each view
  function computeStats(list){
    var s = {notStarted:0, inProg:0, done:0, reopened:0, pause:0, total:list.length};
    list.forEach(function(b){
      var st=(b.status||'').trim(), nm=stName(b);
      if(st==='Done') s.done++;
      else if(/re-?open/i.test(nm)) s.reopened++;
      else if(/pause|on hold/i.test(nm)) s.pause++;
      else if(st==='In Progress') s.inProg++;
      else s.notStarted++;
    });
    return s;
  }

  var curStats = computeStats(currentBugs);
  var allStats = computeStats(allBugs);

  // Tab bar
  var tabs = '<div class="tabs" style="margin-bottom:14px">'
    +'<div class="tab'+(bugsActiveTab==='current'?' on':'')+'" onclick="bugsActiveTab=\'current\';doBugsBacklog(window._bugsData)">Current Sprint ('+curStats.total+')</div>'
    +'<div class="tab'+(bugsActiveTab==='all'?' on':'')+'" onclick="bugsActiveTab=\'all\';doBugsBacklog(window._bugsData)">All Time ('+d.allBugsTotal+')</div>'
    +'<div class="tab'+(bugsActiveTab==='byStatus'?' on':'')+'" onclick="bugsActiveTab=\'byStatus\';doBugsBacklog(window._bugsData)">By Status</div>'
    +'</div>';

  // Pick list based on tab
  var listToShow, stats, subText;
  if(bugsActiveTab==='current'){
    listToShow = currentBugs;
    stats = curStats;
    subText = 'Ticket Type \u00b7 Bug \u00b7 Priority \u2260 Deferred';
  } else if(bugsActiveTab==='all'){
    listToShow = allBugs;
    stats = allStats;
    subText = 'All Bug-type tickets (includes Deferred)';
  } else {
    listToShow = currentBugs; // grouped view uses active queue
    stats = curStats;
    subText = 'Active bugs grouped by status';
  }

  // Apply assignee filter and recompute stats from the visible subset
  var asnList = ['All'].concat(uniqueAssignees(listToShow));
  if(asnList.indexOf(bugsActiveAsn)===-1) bugsActiveAsn = 'All'; // reset stale pick
  if(bugsActiveAsn !== 'All'){
    listToShow = listToShow.filter(function(b){
      return ((b.assignee||'Unassigned').trim()||'Unassigned') === bugsActiveAsn;
    });
    stats = computeStats(listToShow);
  }
  var asnFilter = '<div class="tabs" style="margin-bottom:14px;flex-wrap:wrap">'
    + asnList.map(function(a){
        return '<div class="tab'+(bugsActiveAsn===a?' on':'')+'" onclick="bugsActiveAsn='
          + JSON.stringify(a) + ';doBugsBacklog(window._bugsData)" title="Filter by assignee">'+a+'</div>';
      }).join('')
    + '</div>';

  // KPI cards
  var doneRate = pc(stats.done, stats.total);
  var kpis = '<div class="bug-status-grid">'
    +'<div class="bug-stat"><div class="bug-val" style="color:var(--text)">'+stats.total+'</div><div class="bug-lbl">Total</div></div>'
    +'<div class="bug-stat"><div class="bug-val" style="color:var(--grn)">'+stats.done+'</div><div class="bug-lbl">Fixed ('+doneRate+'%)</div></div>'
    +'<div class="bug-stat"><div class="bug-val" style="color:var(--amb)">'+stats.inProg+'</div><div class="bug-lbl">In progress</div></div>'
    +'<div class="bug-stat"><div class="bug-val" style="color:var(--red)">'+stats.reopened+'</div><div class="bug-lbl">Re-opened</div></div>'
    +'</div>';

  function bugRow(b){
    var st=(b.status||'').trim();
    var badgeCls=st==='Done'?'grn':/re-?open/i.test(stName(b))?'red':st==='In Progress'?'acc':'';
    st=stName(b);
    return '<div class="ul-row"><div class="ul-name">'+trunc(b.taskName,65)
      +'<br><span style="font-size:10px;color:var(--mut)">'+(b.assignee||'Unassigned')+' \u00b7 '+(b.mssTicket||'\u2014')+(b.createdOn?' \u00b7 '+b.createdOn:'')+'</span></div>'
      +'<div class="ul-meta"><span class="badge '+badgeCls+'">'+st+'</span>'
      +(b.estTime?'<span class="ul-hrs">'+(b.estTime||0)+' hrs</span>':'')
      +'</div></div>';
  }

  var listHtml = '';

  if(bugsActiveTab==='byStatus'){
    // Group by status
    var groups = {};
    listToShow.forEach(function(b){
      var st=stName(b)||'To Do';
      if(!groups[st]) groups[st]=[];
      groups[st].push(b);
    });
    var catRank={'In Progress':0,'To Do':1,'Done':2};
    var statusOrder = Object.keys(groups).sort(function(a,z){
      var ra=catRank[groups[a][0].status]!=null?catRank[groups[a][0].status]:1, rz=catRank[groups[z][0].status]!=null?catRank[groups[z][0].status]:1;
      return ra-rz || a.localeCompare(z);
    });
    statusOrder.forEach(function(st){
      if(!groups[st]||!groups[st].length) return;
      var cat=groups[st][0].status;
      var col = cat==='Done'?'var(--grn)':/re-?open/i.test(st)?'var(--red)':cat==='In Progress'?'var(--acc)':'var(--mut)';
      listHtml += '<div style="margin-top:14px;font-size:11px;font-weight:600;color:'+col+';text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--bor);padding-bottom:6px;margin-bottom:6px">'
        + st + ' <span style="color:var(--mut);font-weight:400">('+groups[st].length+')</span></div>';
      listHtml += groups[st].map(bugRow).join('');
    });
  } else {
    // Flat list with load-more
    var visible = listToShow.slice(0, 20);
    listHtml = visible.map(bugRow).join('');
    if(listToShow.length > 20){
      listHtml += '<div style="text-align:center;font-size:11px;color:var(--mut);padding:10px">Showing 20 of '+listToShow.length+' bugs</div>';
    }
  }

  if(!listToShow.length){
    listHtml = '<div class="empty">No bugs in this view.</div>';
  }

  var bugCount = listToShow.length;
  var html = tabs
    + asnFilter
    + kpis
    + '<div class="cc">'
    + '<div class="bugs-dd-header" onclick="toggleBugsList()" id="bugsDdHeader">'
    + '<div class="bugs-dd-title">'
    + '<span class="bugs-dd-chev">▶</span>'
    + '<span class="cc-t" style="margin:0">Bugs list</span>'
    + '<span class="bugs-dd-count">'+bugCount+'</span>'
    + '</div>'
    + '<div class="cc-s" style="margin:0">'+subText+(bugsActiveAsn==='All'?'':' · '+bugsActiveAsn)+'</div>'
    + '</div>'
    + '<div class="bugs-dd-body" id="bugsDdBody" style="display:none">'
    + '<div class="unplanned-list">'+listHtml+'</div>'
    + '</div></div>';

  el.innerHTML = html;
}

function toggleBugsList(){
  var header = document.getElementById('bugsDdHeader');
  var body = document.getElementById('bugsDdBody');
  if(!header || !body) return;
  var isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  header.classList.toggle('open', !isOpen);
}

function doPolish(d){
  var el=document.getElementById('polishS');
  if(!el) return;
  window._polishData = d;
  var dateHint = d.startDate && d.endDate ? d.startDate+' – '+d.endDate : '';

  var allPolish = d.polishRaw || d.polish || [];
  var currentPolish = d.polish || [];
  if(!d.polishRaw && d.allPolishTotal > currentPolish.length){
    allPolish = currentPolish;
  }

  if(!currentPolish.length && !allPolish.length){
    el.innerHTML = '<div class="sec" style="margin:6px 0 10px">Polish (Feedback)</div>'
      + '<div class="empty">No Feedback tickets found. Total in section: '+(d.allPolishTotal||0)+'</div>';
    return;
  }

  function computeStats(list){
    var s = {notStarted:0, inProg:0, done:0, reopened:0, pause:0, total:list.length};
    list.forEach(function(b){
      var st=(b.status||'').trim(), nm=stName(b);
      if(st==='Done') s.done++;
      else if(/re-?open/i.test(nm)) s.reopened++;
      else if(/pause|on hold/i.test(nm)) s.pause++;
      else if(st==='In Progress') s.inProg++;
      else s.notStarted++;
    });
    return s;
  }
  var curStats = computeStats(currentPolish);
  var allStats = computeStats(allPolish);

  var tabs = '<div class="tabs" style="margin-bottom:14px">'
    +'<div class="tab'+(polishActiveTab==='current'?' on':'')+'" onclick="polishActiveTab=\'current\';doPolish(window._polishData)">Current Sprint ('+curStats.total+')</div>'
    +'<div class="tab'+(polishActiveTab==='all'?' on':'')+'" onclick="polishActiveTab=\'all\';doPolish(window._polishData)">All Time ('+d.allPolishTotal+')</div>'
    +'<div class="tab'+(polishActiveTab==='byStatus'?' on':'')+'" onclick="polishActiveTab=\'byStatus\';doPolish(window._polishData)">By Status</div>'
    +'</div>';

  var listToShow, stats, subText;
  if(polishActiveTab==='current'){
    listToShow = currentPolish; stats = curStats;
    subText = 'Ticket Type · Feedback · Priority ≠ Deferred';
  } else if(polishActiveTab==='all'){
    listToShow = allPolish; stats = allStats;
    subText = 'All Feedback-type tickets (includes Deferred)';
  } else {
    listToShow = currentPolish; stats = curStats;
    subText = 'Active polish grouped by status';
  }

  // Assignee filter — pills built from current visible list
  function uniqueAssigneesP(list){
    var seen = {}; var out = [];
    list.forEach(function(b){
      var a = (b.assignee||'Unassigned').trim() || 'Unassigned';
      if(!seen[a]){ seen[a] = true; out.push(a); }
    });
    return out.sort();
  }
  var asnListP = ['All'].concat(uniqueAssigneesP(listToShow));
  if(asnListP.indexOf(polishActiveAsn)===-1) polishActiveAsn = 'All';
  if(polishActiveAsn !== 'All'){
    listToShow = listToShow.filter(function(b){
      return ((b.assignee||'Unassigned').trim()||'Unassigned') === polishActiveAsn;
    });
    stats = computeStats(listToShow);
  }
  var asnFilterP = '<div class="tabs" style="margin-bottom:14px;flex-wrap:wrap">'
    + asnListP.map(function(a){
        return '<div class="tab'+(polishActiveAsn===a?' on':'')+'" onclick="polishActiveAsn='
          + JSON.stringify(a) + ';doPolish(window._polishData)" title="Filter by assignee">'+a+'</div>';
      }).join('')
    + '</div>';

  var doneRate = pc(stats.done, stats.total);
  var kpis = '<div class="bug-status-grid">'
    +'<div class="bug-stat"><div class="bug-val" style="color:var(--text)">'+stats.total+'</div><div class="bug-lbl">Total</div></div>'
    +'<div class="bug-stat"><div class="bug-val" style="color:var(--grn)">'+stats.done+'</div><div class="bug-lbl">Done ('+doneRate+'%)</div></div>'
    +'<div class="bug-stat"><div class="bug-val" style="color:var(--amb)">'+stats.inProg+'</div><div class="bug-lbl">In progress</div></div>'
    +'<div class="bug-stat"><div class="bug-val" style="color:var(--red)">'+stats.reopened+'</div><div class="bug-lbl">Re-opened</div></div>'
    +'</div>';

  function row(b){
    var st=(b.status||'').trim();
    var badgeCls=st==='Done'?'grn':/re-?open/i.test(stName(b))?'red':st==='In Progress'?'acc':'';
    st=stName(b);
    return '<div class="ul-row"><div class="ul-name">'+trunc(b.taskName,65)
      +'<br><span style="font-size:10px;color:var(--mut)">'+(b.assignee||'Unassigned')+' · '+(b.mssTicket||'—')+(b.createdOn?' · '+b.createdOn:'')+'</span></div>'
      +'<div class="ul-meta"><span class="badge '+badgeCls+'">'+st+'</span>'
      +(b.estTime?'<span class="ul-hrs">'+(b.estTime||0)+' hrs</span>':'')
      +'</div></div>';
  }

  var listHtml = '';
  if(polishActiveTab==='byStatus'){
    var groups = {};
    listToShow.forEach(function(b){
      var st=stName(b)||'To Do';
      if(!groups[st]) groups[st]=[];
      groups[st].push(b);
    });
    var catRank={'In Progress':0,'To Do':1,'Done':2};
    var statusOrder = Object.keys(groups).sort(function(a,z){
      var ra=catRank[groups[a][0].status]!=null?catRank[groups[a][0].status]:1, rz=catRank[groups[z][0].status]!=null?catRank[groups[z][0].status]:1;
      return ra-rz || a.localeCompare(z);
    });
    statusOrder.forEach(function(st){
      if(!groups[st]||!groups[st].length) return;
      var cat=groups[st][0].status;
      var col = cat==='Done'?'var(--grn)':/re-?open/i.test(st)?'var(--red)':cat==='In Progress'?'var(--acc)':'var(--mut)';
      listHtml += '<div style="margin-top:14px;font-size:11px;font-weight:600;color:'+col+';text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--bor);padding-bottom:6px;margin-bottom:6px">'
        + st + ' <span style="color:var(--mut);font-weight:400">('+groups[st].length+')</span></div>';
      listHtml += groups[st].map(row).join('');
    });
  } else {
    var visible = listToShow.slice(0, 20);
    listHtml = visible.map(row).join('');
    if(listToShow.length > 20){
      listHtml += '<div style="text-align:center;font-size:11px;color:var(--mut);padding:10px">Showing 20 of '+listToShow.length+' items</div>';
    }
  }
  if(!listToShow.length) listHtml = '<div class="empty">No polish items in this view.</div>';

  var html = '<div class="sec" style="margin:6px 0 10px">Polish (Feedback)</div>'
    + tabs
    + asnFilterP
    + kpis
    + '<div class="cc">'
    + '<div class="bugs-dd-header" onclick="togglePolishList()" id="polishDdHeader">'
    + '<div class="bugs-dd-title">'
    + '<span class="bugs-dd-chev">▶</span>'
    + '<span class="cc-t" style="margin:0">Polish list</span>'
    + '<span class="bugs-dd-count">'+listToShow.length+'</span>'
    + '</div>'
    + '<div class="cc-s" style="margin:0">'+subText+(polishActiveAsn==='All'?'':' · '+polishActiveAsn)+'</div>'
    + '</div>'
    + '<div class="bugs-dd-body" id="polishDdBody" style="display:none">'
    + '<div class="unplanned-list">'+listHtml+'</div>'
    + '</div></div>';
  el.innerHTML = html;
}

function togglePolishList(){
  var header = document.getElementById('polishDdHeader');
  var body = document.getElementById('polishDdBody');
  if(!header || !body) return;
  var isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  header.classList.toggle('open', !isOpen);
}

/* ── SPRINT RETROSPECTIVE ── */
// Demo design: two retro cards — Action Items + Challenges.
// (Went Well / Key learnings ki saved sheet-data preserve rehti hai, bas yahan
//  display nahi hoti — wapas chahiye to inhe dobara add kar dena.)
var RETRO_SECTIONS = [
  { kind:'actions',    icon:'<svg class="icn icn-lg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>', title:'Action Items', placeholder:'Specific improvement to try next sprint…' },
  { kind:'challenges', icon:'<svg class="icn icn-lg" viewBox="0 0 24 24"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>', title:'Challenges', placeholder:'An issue, blocker, or friction point…' },
];

function doRetrospective(d){
  var el = document.getElementById('retroS'); if(!el) return;
  window._retroSid = d.spInfo?.id || 'default';

  // Load from API (Sheet) — takes priority over localStorage
  var sheetRetro = (d.retrospectives||{})[window._retroSid];
  if(sheetRetro && sheetRetro.data){
    try {
      localStorage.setItem('retro_'+window._retroSid, JSON.stringify({
        data: sheetRetro.data,
        updatedAt: sheetRetro.updatedAt||'',
        synced: true
      }));
    } catch(e){}
  }
  renderRetro();
}

function getRetroData(){
  var key = 'retro_' + window._retroSid;
  try {
    var stored = JSON.parse(localStorage.getItem(key) || '{}') || {};
    // Handle both old format (direct object) and new (wrapped)
    return stored.data || stored;
  } catch(e) { return {}; }
}

function saveRetroData(data){
  var key = 'retro_' + window._retroSid;
  // Save locally first (immediate response)
  localStorage.setItem(key, JSON.stringify({data:data, updatedAt:Date.now(), synced:false}));
  // Sync to Google Sheet
  syncRetroToSheet(window._retroSid, data);
}

async function syncRetroToSheet(sid, data){
  try {
    var payload = encodeURIComponent(JSON.stringify(data));
    var url = API + '?action=saveRetro&sprintId=' + encodeURIComponent(sid) + '&data=' + payload + '&email=' + encodeURIComponent(window._userEmail||'') + tok() + '&_cb=' + Date.now();
    var res = await fetch(url, {method:'GET', redirect:'follow'});
    var json = await res.json();
    if(json && !json.error){
      var key = 'retro_' + sid;
      localStorage.setItem(key, JSON.stringify({data:data, updatedAt:Date.now(), synced:true}));
      // Update status indicator if rendered
      var status = document.getElementById('retroSyncStatus');
      if(status){
        status.textContent = 'Synced to Sheet \u00b7 ' + new Date().toLocaleTimeString();
        status.style.color = 'var(--grn)';
      }
    }
  } catch(e) {
    console.warn('Retro sync failed:', e.message);
    var status = document.getElementById('retroSyncStatus');
    if(status){
      status.textContent = 'Local only \u2014 sync failed';
      status.style.color = 'var(--amb)';
    }
  }
}

function renderRetro(){
  var el = document.getElementById('retroS'); if(!el) return;
  var data = getRetroData();
  var html = '<div class="retro-grid">';
  RETRO_SECTIONS.forEach(function(sec){
    var items = data[sec.kind] || [];
    var listHtml = items.length
      ? items.map(function(it, idx){
          return '<div class="retro-item"><span class="r-text">'+escHtml(it)+'</span>'
            +'<span class="r-del" onclick="deleteRetroItem(\''+sec.kind+'\','+idx+')" title="Remove">×</span></div>';
        }).join('')
      : '<div class="retro-empty">Nothing added yet.</div>';
    html += '<div class="retro-card" data-kind="'+sec.kind+'">'
      +'<div class="retro-head">'
      +'<div class="retro-title"><span class="retro-icon">'+sec.icon+'</span>'+sec.title+'</div>'
      +'<span class="retro-count">'+items.length+' item'+(items.length===1?'':'s')+'</span>'
      +'</div>'
      +'<div class="retro-list" id="retroList_'+sec.kind+'">'+listHtml+'</div>'
      +'<div class="retro-add">'
      +'<input id="retroInput_'+sec.kind+'" placeholder="'+sec.placeholder+'" onkeydown="if(event.key===\'Enter\')addRetroItem(\''+sec.kind+'\')"/>'
      +'<button class="retro-add-btn" onclick="addRetroItem(\''+sec.kind+'\')">+ Add</button>'
      +'</div>'
      +'</div>';
  });
  html += '</div>';
  // Check sync status
  var stored = {};
  try { stored = JSON.parse(localStorage.getItem('retro_'+window._retroSid) || '{}'); } catch(e){}
  var syncTxt = stored.synced
    ? '\u2601 Synced to Sheet'
    : (stored.data ? '\u26a0 Local only' : 'Press Enter to add quickly');
  var syncCol = stored.synced ? 'var(--grn)' : (stored.data ? 'var(--amb)' : 'var(--mut)');
  html += '<div class="retro-footer"><span>Sprint: <b style="color:var(--text)">'+window._retroSid+'</b> \u00b7 </span><span id="retroSyncStatus" style="color:'+syncCol+'">'+syncTxt+'</span></div>';
  el.innerHTML = html;
}

function addRetroItem(kind){
  var input = document.getElementById('retroInput_'+kind);
  if(!input) return;
  var text = input.value.trim();
  if(!text) return;
  var data = getRetroData();
  if(!data[kind]) data[kind] = [];
  data[kind].push(text);
  saveRetroData(data);
  input.value = '';
  renderRetro();
  // Keep focus on the same input for rapid entry
  setTimeout(function(){ var i=document.getElementById('retroInput_'+kind); if(i) i.focus(); }, 50);
}

function deleteRetroItem(kind, idx){
  var data = getRetroData();
  if(!data[kind]) return;
  data[kind].splice(idx, 1);
  saveRetroData(data);
  renderRetro();
}
