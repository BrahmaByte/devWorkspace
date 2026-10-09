export const dashboardInteractionsStyles = String.raw`
.jira-board-toolbar{align-items:center;display:flex;flex-wrap:wrap;gap:.6rem;padding:.8rem 1rem 0;position:relative}
.jira-board-toolbar>input{background:var(--panel2);border:1px solid var(--border);border-radius:.5rem;color:var(--text);min-width:0;padding:.6rem;width:min(18rem,100%)}
.jira-filter-menu>summary{align-items:center;background:var(--panel2);border:1px solid var(--border);border-radius:.5rem;cursor:pointer;display:flex;gap:.4rem;list-style:none;padding:.6rem;color:var(--text)}
.jira-filter-menu>summary::-webkit-details-marker{display:none}.jira-filter-menu[open]>summary{border-color:var(--accent);color:var(--accent)}
.jira-filter-popover{background:var(--panel);border:1px solid var(--border);border-radius:.6rem;box-shadow:var(--shadow);display:grid;grid-template-columns:minmax(6rem,9rem) minmax(0,1fr);left:1rem;max-width:calc(100% - 2rem);position:absolute;top:calc(100% + .4rem);width:32rem;z-index:30}
.jira-filter-fields{border-right:1px solid var(--border);display:flex;flex-direction:column;padding:.5rem}.jira-filter-fields button{background:transparent;border:0;border-radius:.4rem;color:var(--text);padding:.6rem;text-align:left}.jira-filter-fields button[aria-pressed="true"]{background:var(--hover);color:var(--accent)}
.jira-filter-options{max-height:18rem;overflow:auto;padding:1rem;min-width:0}.jira-filter-options h3{margin:0 0 .8rem;font-size:.85rem}.jira-filter-options label{align-items:center;display:flex;gap:.5rem;padding:.4rem 0;overflow-wrap:anywhere}.jira-filter-options input{width:auto;flex:0 0 auto}.jira-filter-note{border-top:1px solid var(--border);color:var(--muted);font-size:.7rem;grid-column:1/-1;margin:0;padding:.65rem}
.jira-filter-popover #jira-filter-clear{background:transparent;border:0;border-radius:.4rem;color:var(--accent);margin:.5rem;padding:.6rem}.jira-filter-popover button:hover{background:var(--hover)}.jira-filter-options input{accent-color:var(--accent)}.jira-filter-menu>summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.jira-filter-count{color:var(--muted);font-size:.75rem}
.url-group-detail-header{justify-content:flex-end}
.jira-issue.jira-highlighted{outline:2px solid var(--accent);outline-offset:2px;background:color-mix(in srgb,var(--accent) 12%,var(--panel2))}
.url-group-summary{grid-template-columns:minmax(0,1fr) auto 2.2rem}
.url-group-summary>.icon-button{align-items:center;display:flex;height:2.2rem;justify-content:center;justify-self:end;padding:0;width:2.2rem;min-width:2.2rem}
.page>.dashboard-grid,.page>.workspace-grid,.page>.settings-grid,.page>.knowledge-app{margin-top:0}
.settings-grid{display:block;margin:0 auto;max-width:72rem}.settings-surface{background:var(--panelGradient);border:1px solid var(--border);border-radius:.85rem;box-shadow:var(--shadow);overflow:hidden}.settings-category{border-bottom:1px solid var(--border);padding:1.25rem 1.5rem}.settings-category:last-child{border-bottom:0}.settings-category-header{margin-bottom:.9rem}.settings-category-header h2{font-size:.82rem;letter-spacing:.06em;margin:0 0 .25rem;text-transform:uppercase}.settings-category-header p{font-size:.78rem;margin:0}.settings-category-body{display:grid}.settings-category-body>.jira-card{background:transparent;border:0;border-radius:0;box-shadow:none;height:auto!important;min-height:0;padding:.85rem 0;resize:none!important;width:100%!important}.settings-category-body>.jira-card+.jira-card{border-top:1px solid var(--border)}.settings-category-body>.jira-card>h2{background:none;border:0;font-size:.9rem;letter-spacing:0;padding:0 1.25rem;text-transform:none}.ide-settings-list{display:grid;gap:.45rem;padding:.25rem 1.25rem 1rem}.ide-settings-actions{display:flex;justify-content:flex-end;padding:0 1.25rem 1rem}
.notes-browser-title{justify-content:flex-end}
@media(max-width:720px){.app{display:grid;grid-template-columns:3.5rem minmax(0,1fr)}.app>aside{height:calc(100vh / var(--dashboard-zoom,1));top:0}.app>aside nav{grid-template-columns:1fr}.nav-label{display:none}aside button{padding:.65rem}.app-header{flex-wrap:wrap;height:auto;gap:.4rem;padding:.6rem}.header-tools{max-width:6rem}main{padding:.6rem}.dashboard-grid,.workspace-grid,.settings-grid{grid-template-columns:minmax(0,1fr)}.jira-board{grid-template-columns:minmax(0,1fr)}.notes-app{grid-template-columns:minmax(7rem,1fr) minmax(0,2fr)}.sidebar-brand img{max-width:2rem}.layout-card{min-width:0}}
`;

export const dashboardInteractionsScript = String.raw`
let urlGroupEditingId,highlightedJiraIssue,latestJiraState;
const jiraFilterFields={parentKey:"Parent",assignee:"Assignee",status:"Status",issueType:"Work type",labels:"Labels"};
let jiraBoardSearch="",jiraBoardSelections={},jiraActiveField;
function jiraFieldValues(issue,field){const value=issue[field];return Array.isArray(value)&&value.length?value:typeof value==="string"&&value? [value]:[field==="assignee"?"Unassigned":"Not set"]}
function jiraBoardMatches(issue,local=false){if(jiraBoardSearch&&!((issue.key||"")+" "+issue.summary).toLowerCase().includes(jiraBoardSearch))return false;return Object.entries(jiraBoardSelections).every(([field,values])=>!values.length||(!local||field==="status")&&values.some(value=>jiraFieldValues(issue,field).includes(value)))}
function jiraFilteredIssues(issues){return issues.filter(issue=>jiraBoardMatches(issue))}
function renderJiraFieldOptions(){const options=document.querySelector("#jira-filter-options");options.replaceChildren();if(!jiraActiveField){options.textContent="Select a field to start creating a filter.";return}const heading=document.createElement("h3");heading.textContent=jiraFilterFields[jiraActiveField];options.append(heading);const values=[...new Set([...(latestJiraState?.issues||[]).flatMap(issue=>jiraFieldValues(issue,jiraActiveField)),...(jiraBoardSelections[jiraActiveField]||[])])].sort((a,b)=>a.localeCompare(b));if(!values.length){const empty=document.createElement("p");empty.textContent="No values in the loaded board. Apply JQL or sync Jira first.";options.append(empty)}values.forEach(value=>{const label=document.createElement("label"),checkbox=document.createElement("input"),text=document.createElement("span");checkbox.type="checkbox";checkbox.checked=(jiraBoardSelections[jiraActiveField]||[]).includes(value);text.textContent=value;checkbox.addEventListener("change",()=>{const selected=new Set(jiraBoardSelections[jiraActiveField]||[]);checkbox.checked?selected.add(value):selected.delete(value);jiraBoardSelections[jiraActiveField]=[...selected];refreshJiraBoardFilters()});label.append(checkbox,text);options.append(label)})}
function refreshJiraBoardFilters(){highlightedJiraIssue=undefined;const count=Object.values(jiraBoardSelections).filter(values=>values.length).length;document.querySelector("#jira-filter-count").textContent=count?count+" active":"";if(latestJiraState)renderJira(latestJiraState,true)}
Object.entries(jiraFilterFields).forEach(([field,label])=>{const button=document.createElement("button");button.type="button";button.textContent=label;button.setAttribute("aria-pressed","false");button.addEventListener("click",()=>{jiraActiveField=field;document.querySelectorAll("#jira-filter-fields button").forEach(item=>item.setAttribute("aria-pressed",String(item===button)));renderJiraFieldOptions()});document.querySelector("#jira-filter-fields").append(button)});
document.querySelector("#jira-board-search").addEventListener("input",event=>{jiraBoardSearch=event.target.value.trim().toLowerCase();refreshJiraBoardFilters()});
document.querySelector("#jira-filter-clear").addEventListener("click",()=>{jiraBoardSearch="";jiraBoardSelections={};document.querySelector("#jira-board-search").value="";renderJiraFieldOptions();refreshJiraBoardFilters()});
const jiraFilterMenu=document.querySelector("#jira-filter-menu");jiraFilterMenu.addEventListener("toggle",()=>{document.querySelector("#jira-filter-toggle").setAttribute("aria-expanded",String(jiraFilterMenu.open));if(jiraFilterMenu.open)renderJiraFieldOptions()});
document.addEventListener("click",event=>{if(jiraFilterMenu.open&&!jiraFilterMenu.contains(event.target))jiraFilterMenu.open=false});
document.addEventListener("keydown",event=>{if(event.key==="Escape"&&jiraFilterMenu.open){jiraFilterMenu.open=false;document.querySelector("#jira-filter-toggle").focus()}});
function editUrlGroup(group){const form=document.querySelector("#url-group-form");urlGroupEditingId=group.id;document.querySelector("#url-group-name").value=group.name;document.querySelector("#url-group-urls").value=group.urls.join(String.fromCharCode(10));form.hidden=false;form.scrollIntoView({block:"nearest"});document.querySelector("#url-group-name").focus()}
function highlightJiraRow(){document.querySelectorAll("#jira-issues [data-issue-key]").forEach(row=>{const selected=row.dataset.issueKey===highlightedJiraIssue?.key;row.classList.toggle("jira-highlighted",selected);row.setAttribute("aria-pressed",String(selected))});if(highlightedJiraIssue&&!document.querySelector('[data-view="jira"]').hidden){const row=[...document.querySelectorAll("#jira-issues [data-issue-key]")].find(item=>item.dataset.issueKey===highlightedJiraIssue.key);row?.scrollIntoView({block:"nearest"});row?.focus({preventScroll:true})}}
function renderRecentJira(issues,message){const home=document.querySelector("#home-jira");home.replaceChildren();if(message)homeEmpty(home,message);if(!issues.length){if(!message)homeEmpty(home,"No recent assigned Jira issues. Connect or sync Jira from Settings.");return}issues.slice(0,5).forEach(issue=>home.append(homeRow("task",issue.key,issue.summary+" · "+issue.status+" · Updated "+new Date(issue.updatedAt).toLocaleString(),()=>{highlightedJiraIssue=issue;selectPage("jira");if(latestJiraState)renderJira(latestJiraState);vscode.postMessage({type:"navigation.select",page:"jira"})},"Show and highlight "+issue.key+" on the Jira board")))}
window.addEventListener("message",event=>{const message=event.data;if(message?.type==="urls.saved"){const form=document.querySelector("#url-group-form");form?.reset();if(form)form.hidden=true;urlGroupEditingId=undefined}else if(message?.type==="jira.state"&&!message.state.connection){highlightedJiraIssue=undefined;jiraBoardSearch="";jiraBoardSelections={};document.querySelector("#jira-board-search").value="";document.querySelector("#jira-filter-count").textContent="";latestJiraState=message.state;document.querySelector("#home-jira").replaceChildren();homeEmpty(document.querySelector("#home-jira"),"Connect Jira from Settings to load recent work.")}});
const savedFilters = document.querySelector("#jira-saved-filters"),
  loadFilters = document.querySelector("#jira-load-filters");
let savedFiltersConnection;
loadFilters.addEventListener("click", () => {
  loadFilters.disabled = true;
  document.querySelector("#jira-message").textContent =
    "Loading saved filters…";
  vscode.postMessage({ type: "jira.filters" });
});
savedFilters.addEventListener("change", () => {
  if (/^[1-9][0-9]{0,19}$/.test(savedFilters.value)) {
    const query = "filter = " + savedFilters.value;
    document.querySelector("#jira-search-query").value = query;
    vscode.postMessage({ type: "jira.search", query });
  }
});
window.addEventListener("message", (event) => {
  const message = event.data;
  if (message?.type === "jira.filters") {
    loadFilters.disabled = false;
    savedFilters.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Saved filters";
    savedFilters.append(placeholder);
    for (const filter of message.filters || []) {
      const option = document.createElement("option");
      option.value = filter.id;
      option.textContent = filter.name;
      savedFilters.append(option);
    }
    document.querySelector("#jira-message").textContent =
      message.message ||
      (message.filters?.length
        ? ""
        : "No saved filters available. On Data Center, mark filters as favourites in Jira.");
  } else if (message?.type === "jira.state" && savedFiltersConnection !== JSON.stringify([message.state.connection?.id,message.state.connection?.baseUrl,message.state.currentUser?.accountId])) {
    savedFiltersConnection = JSON.stringify([message.state.connection?.id,message.state.connection?.baseUrl,message.state.currentUser?.accountId]);
    savedFilters.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Saved filters";
    savedFilters.append(placeholder);
  }
});
`;
