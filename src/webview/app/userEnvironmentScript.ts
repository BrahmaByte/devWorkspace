/** Only variable names cross the Webview boundary; values use native prompts. */
export const userEnvironmentScript = String.raw`
const environmentQuery=document.querySelector("#environment-query"),environmentResults=document.querySelector("#user-environment-results");
let environmentSearchTimer;
const searchUserEnvironment=()=>{const query=environmentQuery.value.trim();environmentResults.replaceChildren();if(!query){environmentResults.textContent="Search to find user variable names.";return}vscode.postMessage({type:"environment.search",query})};
document.querySelector("#environment-search").addEventListener("submit",event=>{event.preventDefault();clearTimeout(environmentSearchTimer);searchUserEnvironment()});
environmentQuery.addEventListener("input",()=>{clearTimeout(environmentSearchTimer);environmentSearchTimer=setTimeout(searchUserEnvironment,300)});
document.querySelector("#environment-add").addEventListener("click",()=>vscode.postMessage({type:"environment.configure"}));
window.addEventListener("message",event=>{const message=event.data;if(message?.type!=="environment.results"||message.query!==environmentQuery.value.trim()||!Array.isArray(message.names))return;environmentResults.replaceChildren();if(message.message){environmentResults.textContent=message.message;return}if(!message.names.length){environmentResults.textContent="No matching variable names.";return}message.names.forEach(name=>{if(typeof name!=="string"||!/^[A-Za-z_][A-Za-z0-9_]{0,99}$/u.test(name))return;environmentResults.append(workspaceItem(name,"Value hidden",[iconButton("edit","Overwrite or append "+name,()=>vscode.postMessage({type:"environment.configure",name}))]))})});
`;
