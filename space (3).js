/* My discovery project (MDP) — discovery space: Overview, Prioritization, People */
function dV(i,name){ return (name && i && i.fields) ? i.fields[name] : undefined; }
function dList(v){ return v==null||v==='' ? [] : (Array.isArray(v) ? v : [v]); }
function dNum(v){ var n=parseFloat(Array.isArray(v)?v[0]:v); return isNaN(n)?null:n; }
function dFmt(v){ if(v==null||v==='') return '—'; if(Array.isArray(v)) return v.join(', '); if(typeof v==='number') return String(Math.round(v*10)/10); return String(v); }
function dSum(list,fn){ return list.reduce(function(a,x){ var n=fn(x); return a+(n||0); },0); }
function dRound(v){ return Math.round(v*10)/10; }
function dDate(v){ var x=pd(v); return x?x.toLocaleDateString('en-GB',{day:'numeric',month:'short'}):'—'; }
// State = the space's state field (e.g. "Status" / "State" in JPD), else Jira workflow status.
function dStateName(d){ return (d.roles&&d.roles.state) || 'Status'; }
function dStateOf(d,i){ if(d.roles&&d.roles.state){ var v=dList(dV(i,d.roles.state)); return v.length?String(v[0]):'No '+d.roles.state.toLowerCase(); } return i.status||'—'; }
function dEffort(d,i){ var f=(d.roles&&d.roles.effort)||[]; if(!f.length) return null; var s=0,any=false; f.forEach(function(n){ var x=dNum(dV(i,n)); if(x!=null){s+=x;any=true;} }); return any?s:null; }
// Rank value for "Top ideas": score field → votes → impact → insights.
function dRankField(d){ var r=d.roles||{}; return r.score||r.votes||r.impact||r.insights||null; }
function dStateColor(name,i){
  var s=String(name||'').toLowerCase();
  if(/^no |^—$/.test(s)) return '#3a3f55';
  if(/done|shipped|launched|delivered|complete/.test(s)) return '#18c97a';
  if(/risk|block|reject|won.?t/.test(s)) return '#f05252';
  if(/pending|backlog|parking|to do|new|idea/.test(s)) return '#f5a623';
  if(/track|progress|discovery|delivery|review|build|now/.test(s)) return '#4d9fff';
  return ['#9b72f5','#22c4c4','#5b6ef5','#ff8fab','#0aaa62','#ffc56b'][i%6];
}
function dGroup(list,fn){ var m={},order=[]; list.forEach(function(i){ dList(fn(i)).forEach(function(k){ k=String(k); if(!m[k]){m[k]=[];order.push(k);} m[k].push(i); }); }); return {m:m,keys:order}; }
function dLink(key){ var b=(window._discData&&window._discData.space&&window._discData.space.browseUrl)||''; return b?'<a href="'+b+encodeURIComponent(key)+'" target="_blank" rel="noopener" style="color:var(--acc);text-decoration:none">'+escHtml(key)+'</a>':escHtml(key); }
// Pop-up rows (same look as the sprint pop-ups).
function dIdeaRows(d,list){
  if(!list||!list.length) return '<div class="nv-dt-empty">No ideas to show.</div>';
  var r=d.roles||{}, rf=dRankField(d);
  return list.map(function(i){
    var st=dStateOf(d,i), sc=/done|shipped|launched|delivered/i.test(st)?'g':(/track|progress|discovery|delivery|now/i.test(st)?'b':'m');
    var sub=[i.key, dList(dV(i,r.theme)).join(', '), r.roadmap?dFmt(dV(i,r.roadmap)):'', i.creator?('by '+i.creator):''].filter(function(x){return x&&x!=='—';}).join(' · ');
    var dl=i.delivery||{}, dn=(dl.done||0)+(dl.prog||0)+(dl.todo||0);
    var meta=(rf&&dV(i,rf)!=null?rf+' '+dFmt(dV(i,rf)):'')+(dn?(rf?' · ':'')+'delivery '+(dl.done||0)+'/'+dn:'');
    return '<div class="nv-dt-row"><div class="nv-dt-main"><div class="nv-dt-name">'+escHtml(i.summary||i.key)+'</div>'
      +'<div class="nv-dt-sub">'+sub.replace(i.key,dLink(i.key))+'</div></div>'
      +'<div class="nv-dt-meta"><span class="nv-dt-badge '+sc+'">'+escHtml(st)+'</span>'
      +(meta?'<span class="nv-dt-hrs">'+escHtml(meta)+'</span>':'')+'</div></div>';
  }).join('');
}
function dOpen(title,list){ var d=window._discData; nvDetail(title, list.length+' idea(s)', dIdeaRows(d,list)); }
function dOpenSet(k){ var s=window._dSets[k]; if(s) dOpen(s.t,s.l); }
function dSet(k,t,l){ window._dSets[k]={t:t,l:l}; return 'dOpenSet(\''+escAttr(k)+'\')'; }

/* ── shell ── (markup: this folder's space.html + reports/reports.html + admin/admin.html) */
function discShell(){
  return pagesHtml('space',  ['overview','team','retro'])
    +    pagesHtml('reports',['ideas'])
    +    pagesHtml('admin',  ['users','settings']);
}

/* ── OVERVIEW ── */
function doDiscOverview(d){
  var ideas=d.ideas||[], r=d.roles||{}, n=ideas.length;
  var el=function(id){return document.getElementById(id);};

  // 1. State donut (JPD state field, else Jira status) — like Status overview
  var g=dGroup(ideas,function(i){return dStateOf(d,i);});
  var keys=g.keys.slice().sort(function(a,b){ var na=/^no /i.test(a), nb=/^no /i.test(b); if(na!==nb) return na?1:-1; return g.m[b].length-g.m[a].length||a.localeCompare(b); });
  var cols=keys.map(dStateColor);
  el('dStT').textContent='Ideas by '+dStateName(d).toLowerCase();
  nvDonut('dStD', keys.map(function(k){return g.m[k].length;}), cols, function(ix){ var k=keys[ix]; dOpen(dStateName(d)+' · '+k, g.m[k]); });
  el('dStC').innerHTML='<div style="text-align:center;line-height:1.05">'+n+'<div class="nv-donut-sub">Total ideas</div></div>';
  el('dStChips').innerHTML=nvChips(keys.map(function(k,ix){return {c:cols[ix],n:g.m[k].length,l:escHtml(k)};}));
  var doneN=ideas.filter(function(i){return i.statusCat==='Done';}).length, dp=n?Math.round(doneN/n*100):0;
  el('dStPill').className='nv-pill '+(dp>=50?'good':(dp>=20?'warn':'bad')); el('dStPill').textContent=dp+'% done';

  // 2. Ideas grid — only numbers this space really has
  var tiles=[{l:'Ideas',v:n,c:'blue',s:'In this space',k:'all',list:ideas}];
  if(r.roadmap){ var now=ideas.filter(function(i){return /^now$/i.test(dFmt(dV(i,r.roadmap)));}); tiles.push({l:r.roadmap+': Now',v:now.length,c:'green',s:'Planned now',list:now}); }
  var atRisk=r.state?ideas.filter(function(i){return /risk/i.test(dStateOf(d,i));}):[];
  if(r.state && atRisk.length) tiles.push({l:'At risk',v:atRisk.length,c:'coral',s:r.state+' = at risk',list:atRisk});
  if(r.votes) tiles.push({l:r.votes,v:dRound(dSum(ideas,function(i){return dNum(dV(i,r.votes));})),c:'amber',s:'Total votes',list:ideas.filter(function(i){return dNum(dV(i,r.votes));})});
  if(r.insights) tiles.push({l:r.insights,v:dRound(dSum(ideas,function(i){return dNum(dV(i,r.insights));})),c:'blue',s:'Linked insights',list:ideas.filter(function(i){return dNum(dV(i,r.insights));})});
  if(r.confidence){ var cv=ideas.map(function(i){return dNum(dV(i,r.confidence));}).filter(function(x){return x!=null;});
    tiles.push({l:'Avg '+r.confidence.toLowerCase(),v:cv.length?Math.round(dSum(cv,function(x){return x;})/cv.length):'—',c:'green',s:cv.length+' idea(s) rated',list:ideas.filter(function(i){return dNum(dV(i,r.confidence))!=null;})}); }
  var inDel=ideas.filter(function(i){var x=i.delivery||{};return (x.done||0)+(x.prog||0)+(x.todo||0)>0;});
  tiles.push({l:'In delivery',v:inDel.length,c:'green',s:'Linked work items',list:inDel});
  var unas=ideas.filter(function(i){return !i.assignee;});
  tiles.push({l:'Unassigned',v:unas.length,c:'coral',s:'No assignee',list:unas});
  if(r.theme){ tiles.push({l:'Themes',v:dGroup(ideas,function(i){return dV(i,r.theme);}).keys.length,c:'amber',s:r.theme+' values',list:ideas}); }
  tiles=tiles.slice(0,6);
  el('dGrid').innerHTML=tiles.map(function(t,ix){ return '<div class="nv-sg" style="cursor:pointer" onclick="'+dSet('grid'+ix,t.l,t.list)+'"><div class="l">'+escHtml(t.l)+'</div><div class="v '+t.c+'">'+t.v+'</div><div class="s">'+escHtml(t.s)+'</div></div>'; }).join('');
  el('dGridPill').className='nv-pill good'; el('dGridPill').textContent=(d.space&&d.space.key)||'';

  // 3. Delivery donut — all linked delivery work items
  var dd=dSum(ideas,function(i){return (i.delivery||{}).done;}), dpr=dSum(ideas,function(i){return (i.delivery||{}).prog;}), dt=dSum(ideas,function(i){return (i.delivery||{}).todo;});
  var dtot=dd+dpr+dt;
  nvDonut('dDelD', dtot?[dd,dpr,dt]:[1], dtot?['#18c97a','#4d9fff','#f5a623']:['#2a2e40'], function(){ dOpen('Delivery · ideas with linked work', inDel); });
  el('dDelC').textContent=dtot?Math.round(dd/dtot*100)+'%':'0';
  el('dDelChips').innerHTML=nvChips([{c:'#18c97a',n:dd,l:'Done'},{c:'#4d9fff',n:dpr,l:'In progress'},{c:'#f5a623',n:dt,l:'To do'}]);

  // 4. Roadmap (Now / Next / Later), else ideas updated most recently
  var rmEl=el('dRmList'), html='', y=0;
  if(r.roadmap){
    var rg=dGroup(ideas,function(i){return dV(i,r.roadmap);});
    var order=['Now','Next','Later']; var rk=order.filter(function(k){return rg.m[k];}).concat(rg.keys.filter(function(k){return order.indexOf(k)===-1;}));
    var none=ideas.filter(function(i){return !dList(dV(i,r.roadmap)).length;}); if(none.length){ rk.push('Not on roadmap'); rg.m['Not on roadmap']=none; }
    el('dRmT').textContent=r.roadmap;
    html+='<div class="nv-mh-section" style="top:0">Ideas per '+escHtml(r.roadmap.toLowerCase())+' column</div>'; y=18;
    rk.forEach(function(k){ var c=rg.m[k].length, p=n?Math.round(c/n*100):0;
      html+='<div class="nv-mh surplus" style="top:'+y+'px;cursor:pointer" onclick="event.stopPropagation();'+dSet('rm'+k,r.roadmap+' · '+k,rg.m[k])+'"><div class="top"><span class="nm">'+escHtml(k)+'</span><span class="vl">'+c+'</span></div>'
        +'<div class="bar"><i style="width:'+p+'%;background:'+(k==='Now'?'#18c97a':k==='Next'?'#4d9fff':k==='Later'?'#9b72f5':'#3a3f55')+'"></i></div></div>'; y+=42; });
    el('dRmFoot').innerHTML='<span class="nv-chip"><span class="n" style="background:#18c97a">'+(rg.m.Now?rg.m.Now.length:0)+'</span>Planned now</span>';
    el('dRmCard').onclick=function(){ dOpen(r.roadmap,ideas.filter(function(i){return dList(dV(i,r.roadmap)).length;})); };
  } else {
    var rec=ideas.slice().sort(function(a,b){return String(b.updated).localeCompare(String(a.updated));}).slice(0,6);
    el('dRmT').textContent='Recently updated';
    y=0;
    rec.forEach(function(i){ html+='<div class="nv-mh surplus" style="top:'+y+'px"><div class="top"><span class="nm">'+escHtml(trunc(i.summary,18))+'</span><span class="vl" style="color:var(--mut)">'+escHtml(dDate(i.updated))+'</span></div>'
      +'<div class="bar"><i style="width:100%;background:'+dStateColor(dStateOf(d,i),0)+'"></i></div></div>'; y+=42; });
    el('dRmFoot').innerHTML='<span class="nv-chip"><span class="n" style="background:#4d9fff">'+n+'</span>Ideas</span>';
    el('dRmCard').onclick=function(){ dOpen('Recently updated',rec); };
  }
  rmEl.innerHTML=html;

  // 5. Ideas by theme — bar chart like Priority breakdown
  var c=cc();
  var tg=r.theme?dGroup(ideas,function(i){return dV(i,r.theme);}):{m:{},keys:[]};
  var noTheme=r.theme?ideas.filter(function(i){return !dList(dV(i,r.theme)).length;}):[];
  var tl=tg.keys.slice().sort(function(a,b){return tg.m[b].length-tg.m[a].length||a.localeCompare(b);}); if(noTheme.length){ tl.push('No '+r.theme.toLowerCase()); tg.m[tl[tl.length-1]]=noTheme; }
  el('dThT').textContent=r.theme?'Ideas by '+r.theme.toLowerCase():'Ideas by type';
  if(!r.theme){ tg=dGroup(ideas,function(i){return i.type||'Idea';}); tl=tg.keys; }
  if(CH.dThC) CH.dThC.destroy();
  var TPAL=['#5b6ef5','#f5a623','#18c97a','#9b72f5','#22c4c4','#ff8a4c','#4d9fff','#ff8fab'];
  CH.dThC=new Chart(el('dThC'),{type:'bar',
    data:{labels:tl,datasets:[{data:tl.map(function(k){return tg.m[k].length;}),backgroundColor:tl.map(function(k,ix){return /^no /i.test(k)?'#3a3f55':TPAL[ix%TPAL.length];}),borderRadius:4,maxBarThickness:46,categoryPercentage:.82,barPercentage:.82}]},
    options:{responsive:true,maintainAspectRatio:false,
      onClick:function(e,els){ if(!els||!els.length) return; var k=tl[els[0].index]; dOpen((r.theme||'Type')+' · '+k, tg.m[k]); },
      onHover:function(e,els){ if(e.native) e.native.target.style.cursor=els.length?'pointer':'default'; },
      plugins:{legend:{display:false},tooltip:{callbacks:{label:function(x){return '  '+x.parsed.y+' idea(s)';}}}},
      scales:{x:{grid:{display:false},ticks:{color:c.text,autoSkip:false,minRotation:0,maxRotation:0,padding:9,font:{family:"'Segoe UI','Segoe UI Variable',system-ui,sans-serif",size:11,weight:'600'},callback:function(value){
        var label=this.getLabelForValue(value), words=String(label).split(/\s+/), lines=[''];
        words.forEach(function(word){ var last=lines.length-1; if(lines[last] && (lines[last]+' '+word).length>18) lines.push(word); else lines[last]+=(lines[last]?' ':'')+word; });
        return lines;
      }}},y:{beginAtZero:true,grid:{color:c.grid},ticks:{color:c.text,padding:7,font:{family:"'Segoe UI','Segoe UI Variable',system-ui,sans-serif",size:11,weight:'600'},precision:0}}}}});

  // 6. Jira workflow status — rows like Types of work
  var wg=dGroup(ideas,function(i){return i.status||'—';});
  var wk=wg.keys.slice().sort(function(a,b){return wg.m[b].length-wg.m[a].length||a.localeCompare(b);});
  el('dWf').innerHTML=wk.length?wk.map(function(k,ix){ var cnt=wg.m[k].length, p=n?Math.round(cnt/n*100):0, cat=(wg.m[k][0]||{}).statusCat;
    return '<div class="nv-sc-row" style="cursor:pointer" onclick="'+dSet('wf'+k,'Jira status · '+k,wg.m[k])+'"><span class="nv-sc-name">'+escHtml(k)+'</span>'
      +'<span class="nv-sc-track"><i style="width:'+Math.max(p,1)+'%;background:'+(cat==='Done'?'#18c97a':cat==='In Progress'?'#4d9fff':'#5b6ef5')+'"></i></span><span class="nv-sc-pct">'+p+'% · '+cnt+'</span></div>'; }).join('')
    :'<div class="nv-team-sub">No ideas.</div>';

  // 7. Board — Roadmap columns, else state columns
  var bf=r.roadmap||r.state||null, bg=dGroup(ideas,function(i){ return bf?(dList(dV(i,bf)).length?dV(i,bf):'No '+bf.toLowerCase()):i.status; });
  var bk=bg.keys.slice(); var ord=['Now','Next','Later']; bk.sort(function(a,b){ var ia=ord.indexOf(a), ib=ord.indexOf(b); if(ia!==-1||ib!==-1) return (ia===-1?9:ia)-(ib===-1?9:ib); if(/^no /i.test(a)!==/^no /i.test(b)) return /^no /i.test(a)?1:-1; return bg.m[b].length-bg.m[a].length; });
  var rf=dRankField(d);
  el('dBoardT').textContent=bf?bf+' board':'Status board';
  el('dBoard').innerHTML=bk.map(function(k,bi){
    var list=bg.m[k].slice().sort(function(a,b){ return (dNum(dV(b,rf))||0)-(dNum(dV(a,rf))||0) || keyOrder(a.key,b.key); });
    return '<div class="nv-lane"><div class="nv-lane-h"><span>'+escHtml(k)+'</span><b onclick="'+dSet('bd'+k,(bf||'Status')+' · '+k,list)+'">'+list.length+'</b></div>'
      +list.slice(0,4).map(function(i){ return '<div class="nv-lane-i" onclick="'+dSet('bi'+i.key,i.key,[i])+'">'+escHtml(i.summary)+'<small>'+escHtml([dList(dV(i,r.theme)).join(', '), rf&&dV(i,rf)!=null?rf+' '+dFmt(dV(i,rf)):'' ].filter(Boolean).join(' · ')||i.key)+'</small></div>'; }).join('')
      +(list.length>4?'<div class="nv-lane-more" onclick="'+dSet('bd'+k,(bf||'Status')+' · '+k,list)+'">+ '+(list.length-4)+' more</div>':'')+'</div>';
  }).join('') || '<div class="nv-team-sub">No ideas.</div>';

  // 8. Delivery progress per idea (ideas with linked work)
  var dl=inDel.slice().sort(function(a,b){ var x=a.delivery,y2=b.delivery; return (y2.done+y2.prog+y2.todo)-(x.done+x.prog+x.todo)||keyOrder(a.key,b.key); });
  el('dDpBadge').className='nv-pill '+(inDel.length?'good':'warn'); el('dDpBadge').textContent=inDel.length+' of '+n+' ideas linked';
  el('dDpList').innerHTML=dl.length?dl.slice(0,8).map(function(i){ var x=i.delivery, t=x.done+x.prog+x.todo;
    return '<div class="nv-dp-row" onclick="'+dSet('dp'+i.key,i.key+' · delivery',[i])+'"><div class="nv-dp-top"><span>'+escHtml(trunc(i.summary,44))+'</span><b>'+x.done+'/'+t+' done</b></div>'
      +'<div class="nv-pg-track" style="display:flex;margin:6px 0 0"><i style="width:'+(x.done/t*100)+'%;background:#18c97a"></i><i style="width:'+(x.prog/t*100)+'%;background:#4d9fff"></i></div></div>'; }).join('')
    +(dl.length>8?'<div class="nv-lane-more" onclick="'+dSet('dpall','Delivery · ideas with linked work',dl)+'">+ '+(dl.length-8)+' more</div>':'')
    :'<div class="nv-mh-empty" style="position:static;transform:none;padding:30px 0">No idea has linked delivery work in Jira yet.</div>';
}

/* ── PRIORITIZATION ── */
function doDiscPrio(d){
  var ideas=d.ideas||[], r=d.roles||{}, c=cc(), el=function(id){return document.getElementById(id);};
  var rf=dRankField(d);
  var themes=r.theme?dGroup(ideas,function(i){return dV(i,r.theme);}).keys.sort():[];
  if(themes.indexOf(_discPrioTheme)===-1) _discPrioTheme='All';
  el('dTopFilter').innerHTML=r.theme?['All'].concat(themes).map(function(t){ return '<button type="button" class="nv-fpill'+(t===_discPrioTheme?' on':'')+'" onclick="_discPrioTheme=\''+escAttr(t)+'\';doDiscPrio(window._discData)">'+escHtml(t)+'</button>'; }).join(''):'';
  var pool=ideas.filter(function(i){ return _discPrioTheme==='All'||dList(dV(i,r.theme)).map(String).indexOf(_discPrioTheme)!==-1; });
  el('dTopT').textContent='Top ideas'+(rf?' by '+rf.toLowerCase():'');
  var ranked=pool.filter(function(i){return !rf||dNum(dV(i,rf))!=null;}).sort(function(a,b){ return rf?((dNum(dV(b,rf))||0)-(dNum(dV(a,rf))||0))||keyOrder(a.key,b.key):keyOrder(a.key,b.key); }).slice(0,15);
  el('dTopPill').className='nv-pill good'; el('dTopPill').textContent=ranked.length+' of '+pool.length+' idea(s)';
  var TCOL={}; var TPAL=['#6573d8','#d89a35','#2eaf7a','#9272d5','#35a8ad','#d97850','#568ecf'];
  themes.forEach(function(t,ix){TCOL[t]=TPAL[ix%TPAL.length];});
  el('dTopLeg').innerHTML=themes.map(function(t){return '<span class="i"><span class="sq" style="background:'+TCOL[t]+'"></span>'+escHtml(t)+'</span>';}).join('');
  var wrap=el('dTopWrap');
  if(!ranked.length){ if(CH.dTopC){CH.dTopC.destroy();CH.dTopC=null;} wrap.style.height='60px'; wrap.innerHTML='<div style="padding:20px;text-align:center;color:var(--mut);font-size:12px">No ideas'+(rf?' with a '+escHtml(rf)+' value':'')+'.</div>'; }
  else {
    wrap.style.height=Math.max(ranked.length*40+58,180)+'px'; if(!wrap.querySelector('canvas')) wrap.innerHTML='<canvas id="dTopC"></canvas>';
    if(CH.dTopC) CH.dTopC.destroy();
    CH.dTopC=new Chart(el('dTopC'),{type:'bar',
      data:{labels:ranked.map(function(i){return trunc(i.summary,42);}),datasets:[{data:ranked.map(function(i){return rf?dNum(dV(i,rf)):1;}),
        backgroundColor:ranked.map(function(i){ var t=dList(dV(i,r.theme))[0]; return (t&&TCOL[t])||'rgba(135,106,196,.78)'; }),borderRadius:4,barPercentage:.66,categoryPercentage:.82}]},
      options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,
        onClick:function(e,els){ if(els&&els.length) dOpen(ranked[els[0].index].key,[ranked[els[0].index]]); },
        onHover:function(e,els){ if(e.native) e.native.target.style.cursor=els.length?'pointer':'default'; },
        plugins:{legend:{display:false},tooltip:{callbacks:{title:function(x){return ranked[x[0].dataIndex].key+' · '+ranked[x[0].dataIndex].summary;},label:function(x){ var i=ranked[x.dataIndex];
          return [rf?'  '+rf+': '+dFmt(dV(i,rf)):'', r.impact?'  '+r.impact+': '+dFmt(dV(i,r.impact)):'', (r.effort||[]).length?'  Effort: '+dFmt(dEffort(d,i)):'', r.confidence?'  '+r.confidence+': '+dFmt(dV(i,r.confidence)):''].filter(Boolean); }}}},
        scales:{x:{beginAtZero:true,grid:{color:c.grid},ticks:{color:c.text,font:{family:"'Segoe UI','Segoe UI Variable',system-ui,sans-serif",size:12,weight:'600'},precision:ranked.every(function(i){var x=dNum(dV(i,rf));return x==null||x%1===0;})?0:undefined},title:{display:!!rf,text:rf||'',color:c.text,font:{family:"'Segoe UI','Segoe UI Variable',system-ui,sans-serif",size:12,weight:'600'}}},
                y:{grid:{display:false},ticks:{color:c.text,padding:10,font:{family:"'Segoe UI','Segoe UI Variable',system-ui,sans-serif",size:12,weight:'600'},autoSkip:false}}}}});
  }

  // Impact vs effort — only when the space has both
  var mx=el('dMxCard'), eff=r.effort||[];
  if(r.impact && eff.length){
    mx.style.display='';
    var pts=pool.filter(function(i){return dNum(dV(i,r.impact))!=null&&dEffort(d,i)!=null;});
    var maxE=Math.max.apply(null,pts.map(function(i){return dEffort(d,i);}).concat([1])), maxI=Math.max.apply(null,pts.map(function(i){return dNum(dV(i,r.impact));}).concat([1]));
    el('dMxS').textContent=r.impact+' vs effort ('+eff.join(' + ')+') · top-left = quick wins · '+pts.length+' idea(s) plotted';
    if(CH.dMxC) CH.dMxC.destroy();
    CH.dMxC=new Chart(el('dMxC'),{type:'scatter',
      data:{datasets:[{data:pts.map(function(i){return {x:dEffort(d,i),y:dNum(dV(i,r.impact))};}),
        backgroundColor:pts.map(function(i){ var t=dList(dV(i,r.theme))[0]; return (t&&TCOL[t])||'#876ac4'; }),pointRadius:7,pointHoverRadius:9}]},
      options:{responsive:true,maintainAspectRatio:false,
        onClick:function(e,els){ if(els&&els.length) dOpen(pts[els[0].index].key,[pts[els[0].index]]); },
        onHover:function(e,els){ if(e.native) e.native.target.style.cursor=els.length?'pointer':'default'; },
        plugins:{legend:{display:false},tooltip:{callbacks:{label:function(x){ var i=pts[x.dataIndex]; return i.key+' · '+trunc(i.summary,40)+' ('+r.impact+' '+x.parsed.y+', effort '+x.parsed.x+')'; }}}},
        scales:{x:{min:0,suggestedMax:Math.ceil(maxE)+1,grid:{color:c.grid},ticks:{color:c.text,padding:7,font:{family:"'Segoe UI','Segoe UI Variable',system-ui,sans-serif",size:12,weight:'600'}},title:{display:true,text:'Effort ('+eff.join(' + ')+')',color:c.text,font:{family:"'Segoe UI','Segoe UI Variable',system-ui,sans-serif",size:12,weight:'600'}}},
                y:{min:0,suggestedMax:Math.ceil(maxI)+1,grid:{color:c.grid},ticks:{color:c.text,padding:7,font:{family:"'Segoe UI','Segoe UI Variable',system-ui,sans-serif",size:12,weight:'600'}},title:{display:true,text:r.impact,color:c.text,font:{family:"'Segoe UI','Segoe UI Variable',system-ui,sans-serif",size:12,weight:'600'}}}}},
      plugins:[{id:'qw',beforeDatasetsDraw:function(ch){ var a=ch.chartArea,x=ch.scales.x,y=ch.scales.y,ctx=ch.ctx;
        var qRight=x.getPixelForValue(x.max/2),qBottom=y.getPixelForValue(y.max/2); ctx.save();
        ctx.fillStyle='rgba(46,175,122,.14)'; ctx.fillRect(a.left,a.top,qRight-a.left,qBottom-a.top);
        ctx.strokeStyle='rgba(46,175,122,.48)'; ctx.lineWidth=1; ctx.setLineDash([5,4]);
        ctx.beginPath(); ctx.moveTo(qRight,a.top); ctx.lineTo(qRight,qBottom); ctx.lineTo(a.left,qBottom); ctx.stroke();
        ctx.setLineDash([]); ctx.fillStyle='#47c991'; ctx.font='600 11px Segoe UI, system-ui, sans-serif'; ctx.fillText('Quick wins',a.left+7,a.top+15); ctx.restore(); }}]});
  } else { mx.style.display='none'; if(CH.dMxC){CH.dMxC.destroy();CH.dMxC=null;} }
  var hasMx=!!(r.impact&&eff.length);
  el('dNoScore').parentNode.querySelector('.nv-team-bottom').style.gridTemplateColumns=hasMx?'':'1fr';
  el('dPrTiles').style.cssText=hasMx?'':'display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px';

  // Tiles
  var scored=pool.filter(function(i){return rf&&dNum(dV(i,rf))!=null;});
  var vals=scored.map(function(i){return dNum(dV(i,rf));});
  var t=[{v:scored.length,c:'var(--acc)',l:rf?'Ideas with '+rf+' set':'Ideas'},
         {v:vals.length?dRound(dSum(vals,function(x){return x;})/vals.length):'—',c:'var(--pur)',l:rf?'Average '+rf.toLowerCase():'—'},
         {v:vals.length?dRound(Math.max.apply(null,vals)):'—',c:'var(--grn)',l:rf?'Highest '+rf.toLowerCase():'—'}];
  if(r.confidence){ var cv=pool.map(function(i){return dNum(dV(i,r.confidence));}).filter(function(x){return x!=null;}); t.push({v:cv.length?Math.round(dSum(cv,function(x){return x;})/cv.length):'—',c:'var(--amb)',l:'Average '+r.confidence.toLowerCase()}); }
  else t.push({v:pool.filter(function(i){return !i.assignee;}).length,c:'var(--red)',l:'Unassigned ideas'});
  el('dPrTiles').innerHTML=t.map(function(x){return '<div class="nv-stat-tile"><span class="num" style="color:'+x.c+'">'+x.v+'</span><span class="lab">'+escHtml(x.l)+'</span></div>';}).join('');
  // Not scored yet
  var ns=rf?pool.filter(function(i){return dNum(dV(i,rf))==null;}):[];
  el('dNoScore').innerHTML='<div class="nv-ub-left"><span class="nv-ub-title">'+(rf?'Not scored yet':'Ideas')+'</span><span class="nv-ub-badge">'+(rf?ns.length:pool.length)+'</span></div>'
    +'<span class="nv-ub-meta" style="cursor:pointer" onclick="'+dSet('ns','Not scored yet',rf?ns:pool)+'">'+(rf?'No '+escHtml(rf)+' value in Jira · click for the list':'Click for the list')+'</span>';
}

/* ── PEOPLE ── */
function doDiscPeople(d){
  var ideas=d.ideas||[], r=d.roles||{}, c=cc(), el=function(id){return document.getElementById(id);};
  var by=_discPeopleBy, label={creator:'Creator',assignee:'Assignee',reporter:'Reporter'};
  el('dPpFilter').innerHTML=['creator','assignee','reporter'].map(function(k){ return '<button type="button" class="nv-fpill'+(k===by?' on':'')+'" onclick="_discPeopleBy=\''+k+'\';doDiscPeople(window._discData)">'+label[k]+'</button>'; }).join('');
  var g=dGroup(ideas,function(i){return i[by]||'Unassigned';});
  var names=g.keys.slice().sort(function(a,b){ if((a==='Unassigned')!==(b==='Unassigned')) return a==='Unassigned'?1:-1; return g.m[b].length-g.m[a].length||a.localeCompare(b); });
  el('dPpPill').className='nv-pill good'; el('dPpPill').textContent=names.filter(function(x){return x!=='Unassigned';}).length+' '+label[by].toLowerCase()+'(s)';
  var cnt=function(n,cat){return g.m[n].filter(function(i){return i.statusCat===cat;}).length;};
  var wrap=el('dPpWrap'); wrap.style.height=Math.max(names.length*44+60,160)+'px'; if(!wrap.querySelector('canvas')) wrap.innerHTML='<canvas id="dPpC"></canvas>';
  if(CH.dPpC) CH.dPpC.destroy();
  CH.dPpC=new Chart(el('dPpC'),{type:'bar',
    data:{labels:names,datasets:[
      {label:'To Do',data:names.map(function(n){return cnt(n,'To Do');}),backgroundColor:'rgba(245,166,35,.8)',borderRadius:4,barPercentage:.55,categoryPercentage:.7},
      {label:'In Progress',data:names.map(function(n){return cnt(n,'In Progress');}),backgroundColor:'rgba(77,159,255,.8)',borderRadius:4,barPercentage:.55,categoryPercentage:.7},
      {label:'Done',data:names.map(function(n){return cnt(n,'Done');}),backgroundColor:'rgba(24,201,122,.8)',borderRadius:4,barPercentage:.55,categoryPercentage:.7}]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,
      onClick:function(e,els){ if(els&&els.length){ var n=names[els[0].index]; dOpen(label[by]+' · '+n, g.m[n]); } },
      onHover:function(e,els){ if(e.native) e.native.target.style.cursor=els.length?'pointer':'default'; },
      plugins:{legend:{display:false},tooltip:{callbacks:{footer:function(x){ return 'Total: '+g.m[names[x[0].dataIndex]].length+' idea(s)'; }}}},
      scales:{x:{stacked:true,beginAtZero:true,grid:{color:c.grid},ticks:{color:c.text,font:{size:10},precision:0},title:{display:true,text:'Ideas',color:c.text,font:{size:10}}},
              y:{stacked:true,grid:{display:false},ticks:{color:c.text,font:{size:11},autoSkip:false}}}}});
  // Themes (or Jira status) per person
  var sf=r.theme||null;
  el('dPsT').textContent=(sf?sf:'Jira status')+' per '+label[by].toLowerCase();
  el('dPsS').textContent='Share of each person\'s ideas by '+(sf?sf.toLowerCase():'Jira status category')+' · click a row for the list';
  var PAL=['#5b6ef5','#f5a623','#18c97a','#9b72f5','#22c4c4','#ff8a4c','#4d9fff'], tk=sf?dGroup(ideas,function(i){return dV(i,sf);}).keys.sort():['To Do','In Progress','Done'];
  var colOf=function(k,ix){ return sf?PAL[ix%PAL.length]:({'To Do':'#f5a623','In Progress':'#4d9fff','Done':'#18c97a'})[k]; };
  el('dPsRows').innerHTML=names.map(function(n){ var list=g.m[n], tot=list.length||1;
    return '<div class="nv-sc-row" style="cursor:pointer" onclick="'+dSet('ps'+n,label[by]+' · '+n,list)+'"><span class="nv-sc-name" style="width:120px">'+escHtml(n)+'</span><span class="nv-sc-track">'
      +tk.map(function(k,ix){ var cN=list.filter(function(i){ return sf?dList(dV(i,sf)).map(String).indexOf(k)!==-1:i.statusCat===k; }).length; return cN?'<i data-tip-k="'+escAttr(k)+'" data-tip-v="'+cN+'" data-tip-c="'+colOf(k,ix)+'" style="width:'+(cN/tot*100)+'%;background:'+colOf(k,ix)+'"></i>':''; }).join('')
      +'</span><span class="nv-sc-pct">'+list.length+' idea(s)</span></div>'; }).join('')
    +'<div class="nv-team-leg" style="margin:6px 0 0">'+tk.map(function(k,ix){return '<span class="i"><span class="sq" style="background:'+colOf(k,ix)+'"></span>'+escHtml(k)+'</span>';}).join('')+'</div>';
  // Tiles
  var d14=Date.now()-14*864e5, pdt=function(v){ var x=pd(v); return x?x.getTime():0; };
  var t=[{v:names.filter(function(x){return x!=='Unassigned';}).length,c:'var(--acc)',l:label[by]+'s with ideas'},
         {v:ideas.filter(function(i){return !i.assignee;}).length,c:'var(--red)',l:'Unassigned ideas'},
         {v:ideas.filter(function(i){return pdt(i.created)>=d14;}).length,c:'var(--grn)',l:'Ideas created in the last 14 days'},
         {v:ideas.filter(function(i){return pdt(i.updated)>=d14;}).length,c:'var(--pur)',l:'Ideas updated in the last 14 days'}];
  el('dPpTiles').innerHTML=t.map(function(x){return '<div class="nv-stat-tile"><span class="num" style="color:'+x.c+'">'+x.v+'</span><span class="lab">'+escHtml(x.l)+'</span></div>';}).join('');
}

function renderDiscPage(page,d){
  if(page==='overview') doDiscOverview(d);
  else if(page==='team') doDiscPrio(d);
  else if(page==='retro') doDiscPeople(d);
  else if(page==='ideas') doDiscIdeas(d);
  else if(page==='users') doUsersPage(d);
  else if(page==='settings') doSettingsPage(d);
}
function renderDisc(d){
  window._discData=d; window._sprintData=null;
  setDiscMode(true);
  if(!DISC_PAGES[currentPage]) currentPage='overview';
  document.getElementById('mc').innerHTML=discShell();
  var usersNav=document.getElementById('nav-users');
  if(usersNav){ if((window._userRole||'').toLowerCase()==='admin') usersNav.removeAttribute('data-hidden'); else usersNav.setAttribute('data-hidden','1'); }
  // Sidebar box: ideas at risk (state field), like the sprint alerts box
  var r=d.roles||{}, risk=r.state?(d.ideas||[]).filter(function(i){return /risk/i.test(dStateOf(d,i));}):[];
  var ac=document.getElementById('sbAlertsCount'); if(ac) ac.textContent=risk.length;
  var as=document.getElementById('sbAlertsSub'); if(as) as.textContent=r.state?'Ideas with '+r.state+' = at risk':'Discovery space · no sprints';
  var al=document.getElementById('sbAlertsList');
  if(al) al.innerHTML=risk.length?risk.map(function(i){ return '<div class="sb-alert-item"><span class="sb-alert-dot"></span><div class="sb-alert-main"><div class="sb-alert-name">'+escHtml(i.summary)+'</div><div class="sb-alert-meta">'+escHtml(i.key)+(r.roadmap&&dV(i,r.roadmap)?' · '+escHtml(dFmt(dV(i,r.roadmap))):'')+'</div></div></div>'; }).join('')
    :'<div class="sb-alert-item"><div class="sb-alert-main"><div class="sb-alert-name">'+(d.ideas||[]).length+' ideas</div><div class="sb-alert-meta">'+(r.state?'No idea is at risk right now.':'Ideas, themes and delivery — no hours to track here.')+'</div></div></div>';
  var panel=document.getElementById('sbAlerts'); if(panel){ panel.onclick=risk.length?function(){ dOpen('At risk',risk); }:null; panel.style.cursor=risk.length?'pointer':'default'; }
  switchPage(currentPage);
  requestAnimationFrame(positionSidebarIndicator);
}
