/* Admin — Users and Settings */
// ── USERS PAGE ──
async function doUsersPage(d){
  var el = document.getElementById('usersPage'); if(!el) return;
  if((window._userRole||'').toLowerCase() !== 'admin'){
    el.innerHTML = '<div class="empty">Admin access required to manage users.</div>';
    return;
  }
  el.innerHTML = '<div class="loading"><div class="spin"></div><p>Loading users...</p></div>';
  try {
    var url = API + '?action=listUsers&email=' + encodeURIComponent(window._userEmail) + tok() + '&_cb=' + Date.now();
    var res = await fetch(url, {method:'GET', redirect:'follow'});
    var txt = await res.text();
    var json = JSON.parse(txt.trim());
    if(json.error){ el.innerHTML = '<div class="err">'+(json.message||json.error)+'</div>'; return; }
    renderUsersList(json.users || []);
  } catch(e){
    el.innerHTML = '<div class="err">Failed to load users: '+e.message+'</div>';
  }
}

function renderUsersList(users){
  var el = document.getElementById('usersPage'); if(!el) return;
  var teams = ['QA', 'Design', 'Dev', 'Art', 'UA', 'Marketing', 'Other'];
  var roles = ['Admin', 'Viewer'];
  var html = '<div class="cc">'
    + '<div class="cc-t">Add new user</div>'
    + '<div class="cc-s">Grants dashboard access and sets capacity</div>'
    + '<div class="user-form">'
    + '  <input type="text" id="nuName" class="user-input" placeholder="Full name">'
    + '  <input type="email" id="nuEmail" class="user-input" placeholder="email@playspare.com">'
    + '  <select id="nuRole" class="user-input">' + roles.map(function(r){return '<option>'+r+'</option>';}).join('') + '</select>'
    + '  <select id="nuTeam" class="user-input"><option value="">Team...</option>' + teams.map(function(t){return '<option>'+t+'</option>';}).join('') + '</select>'
    + '  <input type="number" id="nuHours" class="user-input" placeholder="Hrs" value="6" step="0.5" min="0" max="12" style="width:80px">'
    + '  <button class="btn btn-acc" onclick="addUser()">Add</button>'
    + '</div>'
    + '<div id="nuStatus" style="font-size:11px;color:var(--mut);margin-top:8px"></div>'
    + '</div>';
  html += '<div class="cc" style="margin-top:12px">'
    + '<div class="cc-t">Team members (' + users.length + ')</div>'
    + '<div class="cc-s">Edit inline then click Save · Changes persist to Google Sheet</div>'
    + '<div style="overflow-x:auto"><table class="user-table">'
    + '<thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Team</th><th>Hrs/day</th><th></th></tr></thead>'
    + '<tbody>'
    + users.map(function(u){
      return '<tr data-email="'+u.email+'">'
        + '<td><input class="user-cell" data-field="name" value="'+(u.name||'').replace(/"/g,'&quot;')+'"></td>'
        + '<td style="color:var(--mut);font-size:11px">'+u.email+'</td>'
        + '<td><select class="user-cell" data-field="role">' + roles.map(function(r){return '<option '+(r===u.role?'selected':'')+'>'+r+'</option>';}).join('') + '</select></td>'
        + '<td><select class="user-cell" data-field="team"><option value="">—</option>' + teams.map(function(t){return '<option '+(t===u.team?'selected':'')+'>'+t+'</option>';}).join('') + '</select></td>'
        + '<td><input type="number" class="user-cell" data-field="hours" value="'+u.hours+'" step="0.5" min="0" max="12" style="width:70px"></td>'
        + '<td style="text-align:right;white-space:nowrap"><button class="btn" onclick="saveUserRow(this)">Save</button> <button class="btn" style="color:var(--red);border-color:rgba(240,82,82,.3)" onclick="deleteUserRow(\''+u.email+'\')">Del</button></td>'
        + '</tr>';
    }).join('')
    + '</tbody></table></div>'
    + (users.length === 0 ? '<div class="empty" style="margin-top:14px">No users yet. Add the first user above.</div>' : '')
    + '</div>';
  el.innerHTML = html;
}

async function addUser(){
  var name  = document.getElementById('nuName').value.trim();
  var email = document.getElementById('nuEmail').value.trim().toLowerCase();
  var role  = document.getElementById('nuRole').value;
  var team  = document.getElementById('nuTeam').value;
  var hours = document.getElementById('nuHours').value || 6;
  var statusEl = document.getElementById('nuStatus');
  if(!name || !email){ statusEl.textContent = 'Name and email required.'; statusEl.style.color = 'var(--red)'; return; }
  statusEl.textContent = 'Saving...'; statusEl.style.color = 'var(--mut)';
  try {
    var params = '?action=saveUser&email=' + encodeURIComponent(window._userEmail)
      + '&targetName=' + encodeURIComponent(name) + '&targetEmail=' + encodeURIComponent(email)
      + '&targetRole=' + encodeURIComponent(role) + '&targetTeam=' + encodeURIComponent(team)
      + '&targetHours=' + encodeURIComponent(hours) + tok() + '&_cb=' + Date.now();
    var res = await fetch(API + params, {method:'GET', redirect:'follow'});
    var json = JSON.parse((await res.text()).trim());
    if(json.ok){
      statusEl.textContent = 'User added.'; statusEl.style.color = 'var(--grn)';
      setTimeout(function(){ doUsersPage(window._sprintData); }, 500);
    } else {
      statusEl.textContent = 'Error: ' + (json.message || json.error); statusEl.style.color = 'var(--red)';
    }
  } catch(e){ statusEl.textContent = 'Error: ' + e.message; statusEl.style.color = 'var(--red)'; }
}

async function saveUserRow(btn){
  var row = btn.closest('tr');
  var email = row.dataset.email;
  var name = row.querySelector('[data-field="name"]').value.trim();
  var role = row.querySelector('[data-field="role"]').value;
  var team = row.querySelector('[data-field="team"]').value;
  var hours = row.querySelector('[data-field="hours"]').value || 6;
  var orig = btn.textContent;
  btn.textContent = 'Saving...'; btn.disabled = true;
  try {
    var params = '?action=saveUser&email=' + encodeURIComponent(window._userEmail)
      + '&targetName=' + encodeURIComponent(name) + '&targetEmail=' + encodeURIComponent(email)
      + '&targetRole=' + encodeURIComponent(role) + '&targetTeam=' + encodeURIComponent(team)
      + '&targetHours=' + encodeURIComponent(hours) + tok() + '&_cb=' + Date.now();
    var res = await fetch(API + params, {method:'GET', redirect:'follow'});
    var json = JSON.parse((await res.text()).trim());
    btn.textContent = json.ok ? 'Saved ✓' : 'Failed';
    btn.disabled = false;
    setTimeout(function(){ btn.textContent = orig; }, 1500);
  } catch(e){ btn.textContent = 'Failed'; btn.disabled = false; }
}

async function deleteUserRow(email){
  if(!confirm('Remove user ' + email + '?')) return;
  try {
    var params = '?action=deleteUser&email=' + encodeURIComponent(window._userEmail)
      + '&targetEmail=' + encodeURIComponent(email) + tok() + '&_cb=' + Date.now();
    var res = await fetch(API + params, {method:'GET', redirect:'follow'});
    var json = JSON.parse((await res.text()).trim());
    if(json.ok) doUsersPage(window._sprintData);
    else alert('Failed: ' + (json.message || json.error));
  } catch(e){ alert('Error: ' + e.message); }
}

// ── SETTINGS PAGE ──
function doSettingsPage(){
  var el = document.getElementById('settingsPage'); if(!el) return;
  var themePref = localStorage.getItem('themePref') || 'dark';
  var opts = [
    {k:'dark',  l:'Dark',        d:'Easy on the eyes'},
    {k:'light', l:'Light',       d:'High contrast'},
    {k:'auto',  l:'Auto (system)', d:'Follows your OS setting'},
  ];
  el.innerHTML = '<div class="cc">'
    + '<div class="cc-t">Theme</div>'
    + '<div class="cc-s">Choose how the dashboard looks</div>'
    + '<div class="theme-opts">'
    + opts.map(function(o){
        return '<label class="theme-opt'+(themePref===o.k?' on':'')+'">'
          + '<input type="radio" name="themePref" value="'+o.k+'" '+(themePref===o.k?'checked':'')+' onchange="setTheme(\''+o.k+'\')">'
          + '<div><div class="theme-opt-title">'+o.l+'</div><div class="theme-opt-desc">'+o.d+'</div></div>'
          + '</label>';
      }).join('')
    + '</div></div>'
    + '<div class="cc" style="margin-top:12px">'
    + '<div class="cc-t">Session</div>'
    + '<div class="cc-s">Current sign-in details</div>'
    + '<table class="sett-tbl">'
    + '<tr><td>Email</td><td>'+window._userEmail+'</td></tr>'
    + '<tr><td>Name</td><td>'+(window._userName||'—')+'</td></tr>'
    + '<tr><td>Role</td><td><span class="badge acc">'+(window._userRole||'Viewer')+'</span></td></tr>'
    + '</table></div>';
}

function setTheme(mode){
  localStorage.setItem('themePref', mode);
  applyTheme(mode);
  if(raw && window._sprintData) renderPage(currentPage, window._sprintData);
  if(currentPage === 'settings') doSettingsPage();
}
