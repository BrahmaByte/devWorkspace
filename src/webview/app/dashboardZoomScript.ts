export const dashboardZoomScript = String.raw`
let dashboardZoom=100;
function setDashboardZoom(value){dashboardZoom=Number.isFinite(value)?Math.min(150,Math.max(80,Math.round(value/10)*10)):100;document.documentElement.style.zoom=String(dashboardZoom/100);document.documentElement.style.setProperty("--dashboard-zoom",String(dashboardZoom/100));const reset=document.querySelector("#zoom-reset");reset.textContent=dashboardZoom+"%";document.querySelector("#zoom-out").disabled=dashboardZoom<=80;document.querySelector("#zoom-in").disabled=dashboardZoom>=150;savedState.zoom=dashboardZoom;vscode.setState(savedState)}
document.querySelector("#zoom-out").addEventListener("click",()=>setDashboardZoom(dashboardZoom-10));
document.querySelector("#zoom-in").addEventListener("click",()=>setDashboardZoom(dashboardZoom+10));
document.querySelector("#zoom-reset").addEventListener("click",()=>setDashboardZoom(100));
document.addEventListener("keydown",event=>{if(!(event.ctrlKey||event.metaKey)||event.altKey)return;if(event.key==="+"||event.key==="="||event.key==="-"||event.key==="0"){event.preventDefault();setDashboardZoom(event.key==="0"?100:dashboardZoom+(event.key==="-"?-10:10))}});
document.addEventListener("wheel",event=>{if(!event.ctrlKey&&!event.metaKey)return;event.preventDefault();setDashboardZoom(dashboardZoom+(event.deltaY<0?10:-10))},{passive:false});
setDashboardZoom(typeof savedState.zoom==="number"?savedState.zoom:100);
`;
