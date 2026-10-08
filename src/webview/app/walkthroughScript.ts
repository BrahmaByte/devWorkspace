export const walkthroughStyles = String.raw`
.walkthrough{position:fixed;right:1.5rem;top:6rem;z-index:50;width:min(24rem,calc(100vw - 2rem));max-height:calc(100vh - 8rem);overflow:auto;padding:1.4rem;border:1px solid var(--border);border-top:4px solid var(--accent);border-radius:16px;background:var(--panelGradient);box-shadow:var(--shadow)}
.walkthrough[hidden]{display:none}.walkthrough h2{margin:.7rem 0;font-size:1.2rem}.walkthrough p{line-height:1.6;color:var(--muted)}.walkthrough-progress{font-size:.8rem;color:var(--accent);font-weight:700}.walkthrough-actions{display:flex;justify-content:flex-end;gap:.5rem;margin-top:1.2rem}.walkthrough-actions button{border:1px solid var(--border);border-radius:8px;padding:.55rem .8rem;background:var(--panel2);color:var(--text)}.walkthrough-actions .walkthrough-next{background:var(--accent);color:var(--accentText);border-color:var(--accent)}.walkthrough-target{outline:2px dashed var(--accent);outline-offset:4px}
`;

export const walkthroughScript = String.raw`
const tourSteps=[
 {page:"home",title:"Keep frequently used tools here",text:"Add a sticky note with plus. Open a recent Jira issue, edit a URL group with the pencil, or launch an app from its tile."},
 {page:"settings",title:"Connect Jira and Confluence",text:"Enter your site URL, then your credentials in the VS Code prompts. If your network needs a proxy, configure it in Network proxy."},
 {page:"jira",title:"Filter your board",text:"Use board search and Filter to narrow loaded issues without changing JQL. Sync refreshes Jira; select an issue for details and comments."},
 {page:"calendar",title:"Plan your time",text:"Switch the Planner between Day, Week and Month; use the day planner and yearly calendar below. Set a leave type's Days/Hours unit, annual count and color with the color picker; use 0.5 days for half-day leave, or Holiday for independently colored holidays."},
 {page:"workspace",title:"Open a project or run a command",text:"Choose a project folder to open it or its terminal. Save a command shortcut, then use Run and approve the confirmation."},
 {page:"notes",title:"Write a note",text:"Use the new-note icon and start typing. Notes save automatically. Select an existing note to edit it."},
 {page:"knowledge",title:"Read a Confluence page",text:"Search for a page and select a result. Use Focus Reader for a full-screen view, or Bookmark to save a reference in Notes."},
 {page:"search",title:"Find saved work",text:"Search notes, projects, commands and cached Jira or Confluence entries. Use the theme button and bottom-right zoom controls to adjust the view."}
];
// Update these highlights alongside release notes when shipping new features.
const updateSteps=[
 {page:"calendar",title:"Plan your day, week or month",text:"Switch the Planner between Day, Week and Month and add an agenda with Quick plan. Select a date in the yearly calendar to update the day planner."},
 {page:"calendar",title:"Track holidays and leave",text:"Open Manage leave types to set Days or Hours, an Annual type count and a color. Record 0.5 days for half-day leave, or choose Holiday for separately colored holidays; quantities are recorded as entered."}
];
const walkthroughPanel=document.createElement("section"),walkthroughProgress=document.createElement("div"),walkthroughTitle=document.createElement("h2"),walkthroughText=document.createElement("p"),walkthroughActions=document.createElement("div");
walkthroughPanel.className="walkthrough";walkthroughPanel.hidden=true;walkthroughPanel.tabIndex=-1;walkthroughPanel.setAttribute("role","region");walkthroughPanel.setAttribute("aria-labelledby","walkthrough-title");walkthroughTitle.id="walkthrough-title";walkthroughProgress.className="walkthrough-progress";walkthroughProgress.setAttribute("aria-live","polite");walkthroughActions.className="walkthrough-actions";
const guideControl=(label,action)=>{const control=document.createElement("button");control.type="button";control.textContent=label;control.title=label;control.setAttribute("aria-label",label);control.addEventListener("click",action);return control};
let walkthroughSteps=tourSteps,walkthroughIndex=0,walkthroughVersion="",walkthroughOriginalPage="home",walkthroughKind="tour";
const guideNavigate=page=>{flushAutosave();selectPage(page);vscode.postMessage({type:"navigation.select",page})};
const clearGuideTarget=()=>document.querySelectorAll(".walkthrough-target").forEach(element=>element.classList.remove("walkthrough-target"));
const closeWalkthrough=()=>{walkthroughPanel.hidden=true;clearGuideTarget();guideNavigate(walkthroughOriginalPage);guideReplay.focus()};
const showGuideStep=()=>{const step=walkthroughSteps[walkthroughIndex];clearGuideTarget();guideNavigate(step.page);const target=document.querySelector('[data-page="'+step.page+'"]');target?.classList.add("walkthrough-target");walkthroughProgress.textContent=(walkthroughKind==="update"?"What's new · ":"Starter guide · ")+walkthroughVersion+" · "+(walkthroughIndex+1)+" of "+walkthroughSteps.length;walkthroughTitle.textContent=step.title;walkthroughText.textContent=step.text;guideBack.disabled=walkthroughIndex===0;guideNext.textContent=walkthroughIndex===walkthroughSteps.length-1?"Finish":"Next";guideNext.title=guideNext.textContent;guideNext.setAttribute("aria-label",guideNext.textContent);walkthroughPanel.hidden=false;walkthroughPanel.focus()};
const guideSkip=guideControl("Skip",closeWalkthrough),guideBack=guideControl("Back",()=>{if(walkthroughIndex>0){walkthroughIndex--;showGuideStep()}}),guideNext=guideControl("Next",()=>{if(walkthroughIndex===walkthroughSteps.length-1)closeWalkthrough();else{walkthroughIndex++;showGuideStep()}});guideNext.className="walkthrough-next";walkthroughActions.append(guideSkip,guideBack,guideNext);walkthroughPanel.append(walkthroughProgress,walkthroughTitle,walkthroughText,walkthroughActions);document.body.append(walkthroughPanel);
const guideReplay=iconButton("help","Show starter guide",()=>vscode.postMessage({type:"walkthrough.open"}));guideReplay.id="walkthrough-replay";document.querySelector(".header-tools").append(guideReplay);
document.addEventListener("keydown",event=>{if(event.key==="Escape"&&!walkthroughPanel.hidden&&!document.querySelector("dialog[open]")){event.preventDefault();closeWalkthrough()}});
window.addEventListener("message",event=>{const message=event.data;if(message?.type!=="walkthrough.state"||!["tour","update"].includes(message.mode)||typeof message.version!=="string"||message.version.length>50)return;if(walkthroughPanel.hidden)walkthroughOriginalPage=document.querySelector("[data-view]:not([hidden])")?.dataset.view||"home";walkthroughSteps=message.mode==="update"?updateSteps:tourSteps;walkthroughKind=message.mode;walkthroughVersion=message.version;walkthroughIndex=0;showGuideStep()});
`;
