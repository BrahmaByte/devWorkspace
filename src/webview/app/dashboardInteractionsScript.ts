import { jiraQuickFilters } from "../../domain/jira/models";

export const dashboardInteractionsStyles = String.raw`
.jira-quick-filters{display:flex;align-items:center;gap:.7rem;margin:.8rem 0;color:var(--muted)}
.jira-quick-filters select{background:var(--panel2);color:var(--text);border:1px solid var(--border);border-radius:.5rem;padding:.5rem;max-width:100%}
.jira-issue.jira-highlighted{outline:2px solid var(--accent);outline-offset:2px;background:color-mix(in srgb,var(--accent) 12%,var(--panel2))}
.url-group-summary{grid-template-columns:minmax(0,1fr) auto 2.2rem}
.url-group-summary>.icon-button{align-items:center;display:flex;height:2.2rem;justify-content:center;justify-self:end;padding:0;width:2.2rem;min-width:2.2rem}
.page>.dashboard-grid,.page>.workspace-grid,.page>.settings-grid,.page>.knowledge-app{margin-top:0}
.notes-browser-title{justify-content:flex-end}
@media(max-width:720px){.app{display:grid;grid-template-columns:3.5rem minmax(0,1fr)}.app>aside{height:calc(100vh / var(--dashboard-zoom,1));top:0}.app>aside nav{grid-template-columns:1fr}.nav-label{display:none}aside button{padding:.65rem}.app-header{flex-wrap:wrap;height:auto;gap:.4rem;padding:.6rem}.header-tools{max-width:6rem}main{padding:.6rem}.dashboard-grid,.workspace-grid,.settings-grid{grid-template-columns:minmax(0,1fr)}.jira-board{grid-template-columns:minmax(0,1fr)}.jira-quick-filters{flex-wrap:wrap}.notes-app{grid-template-columns:minmax(7rem,1fr) minmax(0,2fr)}.sidebar-brand img{max-width:2rem}.layout-card{min-width:0}}
`;

export const dashboardInteractionsScript = String.raw`
let urlGroupEditingId,highlightedJiraIssue,latestJiraState;
const jiraPresets=${JSON.stringify(jiraQuickFilters)};
function editUrlGroup(group){const form=document.querySelector("#url-group-form");urlGroupEditingId=group.id;document.querySelector("#url-group-name").value=group.name;document.querySelector("#url-group-urls").value=group.urls.join(String.fromCharCode(10));form.hidden=false;form.scrollIntoView({block:"nearest"});document.querySelector("#url-group-name").focus()}
function highlightJiraRow(){document.querySelectorAll("#jira-issues [data-issue-key]").forEach(row=>{const selected=row.dataset.issueKey===highlightedJiraIssue?.key;row.classList.toggle("jira-highlighted",selected);row.setAttribute("aria-pressed",String(selected))});if(highlightedJiraIssue&&!document.querySelector('[data-view="jira"]').hidden){const row=[...document.querySelectorAll("#jira-issues [data-issue-key]")].find(item=>item.dataset.issueKey===highlightedJiraIssue.key);row?.scrollIntoView({block:"nearest"});row?.focus({preventScroll:true})}}
function renderRecentJira(issues,message){const home=document.querySelector("#home-jira");home.replaceChildren();if(message)homeEmpty(home,message);if(!issues.length){if(!message)homeEmpty(home,"No recent assigned Jira issues. Connect or sync Jira from Settings.");return}issues.slice(0,5).forEach(issue=>home.append(homeRow("task",issue.key,issue.summary+" · "+issue.status+" · Updated "+new Date(issue.updatedAt).toLocaleString(),()=>{highlightedJiraIssue=issue;selectPage("jira");if(latestJiraState)renderJira(latestJiraState);vscode.postMessage({type:"navigation.select",page:"jira"})},"Show and highlight "+issue.key+" on the Jira board")))}
document.querySelector("#jira-preset").addEventListener("change",event=>{const preset=event.target.value;if(Object.hasOwn(jiraPresets,preset)){highlightedJiraIssue=undefined;vscode.postMessage({type:"jira.preset",preset})}});
window.addEventListener("message",event=>{const message=event.data;if(message?.type==="urls.saved"){const form=document.querySelector("#url-group-form");form?.reset();if(form)form.hidden=true;urlGroupEditingId=undefined}else if(message?.type==="jira.state"){document.querySelector("#jira-preset").value=Object.keys(jiraPresets).find(key=>jiraPresets[key]===message.state.filter)||"";if(!message.state.connection){highlightedJiraIssue=undefined;latestJiraState=message.state;document.querySelector("#home-jira").replaceChildren();homeEmpty(document.querySelector("#home-jira"),"Connect Jira from Settings to load recent work.")}}});
`;
