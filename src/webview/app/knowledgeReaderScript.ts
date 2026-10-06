/** Trusted UI code; untrusted documents are cloned through an element allowlist. */
export const knowledgeReaderScript = String.raw`
function wikiMetadata(documentData) {
  const dl=document.createElement("dl"),meta=documentData.metadata||{},page=documentData.page;
  const add=(label,value)=>{if(value===undefined||value==="")return;const group=document.createElement("div"),dt=document.createElement("dt"),dd=document.createElement("dd");dt.textContent=label;dd.textContent=String(value);group.append(dt,dd);dl.append(group)};
  dl.className="wiki-metadata";
  add("Page ID",page.id);add("Space",meta.spaceKey?((page.spaceName||"")+" ("+meta.spaceKey+")"):(page.spaceName||""));add("Version",meta.version);add("Status",meta.status);add("Created by",meta.createdBy);add("Updated by",meta.updatedBy);add("Created",meta.createdAt?new Date(meta.createdAt).toLocaleString():undefined);add("Updated",page.updatedAt?new Date(page.updatedAt).toLocaleString():undefined);add("Labels",meta.labels?.join(", "));
  return dl;
}
const safeReaderTags=new Set(["A","B","BLOCKQUOTE","BR","CODE","DEL","EM","H1","H2","H3","H4","H5","H6","HR","I","IMG","LI","OL","P","PRE","S","STRONG","TABLE","TBODY","TD","TH","THEAD","TR","U","UL"]);
function cloneReaderNode(node,media,prefix) {
  if(node.nodeType===Node.TEXT_NODE)return document.createTextNode(node.textContent||"");
  if(node.nodeType!==Node.ELEMENT_NODE||!safeReaderTags.has(node.tagName))return document.createDocumentFragment();
  if(node.tagName==="IMG"){
    const image=media.get(node.getAttribute("data-reader-media"));
    if(!image||!/^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/u.test(image.dataUrl||"")){const missing=document.createElement("p");missing.className="media-warning";missing.textContent="Image unavailable. Open the original page to view it.";return missing}
    const img=document.createElement("img");img.src=image.dataUrl;img.alt=image.alt||"Embedded image or diagram";img.loading="lazy";img.decoding="async";return img;
  }
  const clone=document.createElement(node.tagName.toLowerCase());
  if(/^H[1-6]$/u.test(node.tagName)){const id=node.getAttribute("data-reader-id");if(/^reader-section-[0-9]+$/u.test(id||""))clone.id=prefix+id}
  if(node.tagName==="TD"||node.tagName==="TH")["colspan","rowspan"].forEach(name=>{const value=node.getAttribute(name);if(/^[1-9][0-9]?$/u.test(value||""))clone.setAttribute(name,value)});
  node.childNodes.forEach(child=>clone.append(cloneReaderNode(child,media,prefix)));return clone;
}
function renderRichContent(article,documentData,prefix="") {
  const parsed=new DOMParser().parseFromString(documentData.html||"","text/html"),media=new Map((documentData.media||[]).map(item=>[item.id,item]));
  article.replaceChildren();parsed.body.childNodes.forEach(node=>article.append(cloneReaderNode(node,media,prefix)));
  (documentData.mediaWarnings||[]).forEach(message=>{const warning=document.createElement("p");warning.className="media-warning";warning.textContent=message;article.append(warning)});
}
function renderWikiPreview(documentData) {
  if(selectedConfluencePage?.id!==documentData.page.id)return;
  selectedConfluenceDocument=documentData;
  const detail=document.querySelector("#confluence-detail");
  detail.dataset.loadingPage="";detail.querySelector(".wiki-metadata")?.remove();detail.querySelector(".knowledge-detail-header").after(wikiMetadata(documentData));
  const article=detail.querySelector(".knowledge-article");article.removeAttribute("aria-busy");article.removeAttribute("role");renderRichContent(article,documentData,"preview-");
}
function renderConfluenceDetail(page) {
  const changed=selectedConfluencePage?.id!==page?.id;
  selectedConfluencePage=page;
  const detail=document.querySelector("#confluence-detail");
  if(!page){selectedConfluenceDocument=undefined;detail.dataset.loadingPage="";detail.replaceChildren();homeEmpty(detail,"Select a Confluence page to read it or save it to Notes.");return}
  if(changed)selectedConfluenceDocument=undefined;
  const header=document.createElement("div"),copy=document.createElement("div"),heading=document.createElement("h2"),meta=document.createElement("p"),actions=document.createElement("div");
  const reader=iconButton("focus","Open "+page.title+" in focus reader",()=>requestFocusReader(page.id,page.title)),bookmark=iconButton("bookmark","Bookmark "+page.title+" in Notes",()=>vscode.postMessage({type:"confluence.bookmark",id:page.id})),open=iconButton("external","Open "+page.title+" in default browser",()=>vscode.postMessage({type:"confluence.open",id:page.id})),article=document.createElement("article");
  header.className="knowledge-detail-header";actions.className="knowledge-detail-actions";heading.textContent=page.title;meta.className="knowledge-detail-meta";meta.textContent=(page.spaceName||"Confluence")+" · Updated "+new Date(page.updatedAt).toLocaleString();copy.append(heading,meta);actions.append(reader,bookmark,open);header.append(copy,actions);article.className="reader-article knowledge-article";article.setAttribute("aria-busy","true");article.textContent="Loading page content…";detail.replaceChildren(header,article);
  if(selectedConfluenceDocument?.page.id===page.id)renderWikiPreview(selectedConfluenceDocument);
  else if(changed||!detail.dataset.loadingPage){detail.dataset.loadingPage=page.id;vscode.postMessage({type:"confluence.preview",id:page.id})}
}
function renderConfluence(state) {
  const summary=document.querySelector("#confluence-summary"),pages=document.querySelector("#confluence-pages"),message=document.querySelector("#confluence-message"),name=document.querySelector("#confluence-name"),url=document.querySelector("#confluence-url");
  summary.replaceChildren();pages.replaceChildren();message.textContent=state.message||(!state.connection?"Configure Confluence from Settings to search pages.":"");
  if(state.connection){name.value=state.connection.displayName;url.value=state.connection.baseUrl;const heading=document.createElement("strong"),connectionState=document.createElement("span");heading.textContent=state.connection.displayName;connectionState.textContent=state.status==="connected"?"Connected":state.status==="expired"?"Credentials required":"Connection unavailable";summary.append(heading,connectionState)}
  else {const empty=document.createElement("p");empty.textContent="No Confluence connection. Credentials are handled by VS Code and never exposed to this page.";summary.append(empty)}
  (state.pages||[]).forEach(page=>{const row=document.createElement("button"),title=document.createElement("strong"),meta=document.createElement("small");row.type="button";row.className="knowledge-page-row";row.setAttribute("aria-label","View "+page.title);row.title="View "+page.title;row.classList.toggle("active",selectedConfluencePage?.id===page.id);title.textContent=page.title;meta.textContent=page.spaceName||new Date(page.updatedAt).toLocaleDateString();row.append(title,meta);row.addEventListener("click",()=>{document.querySelectorAll(".knowledge-page-row").forEach(item=>item.classList.toggle("active",item===row));renderConfluenceDetail(page)});pages.append(row)});
  if(selectedConfluencePage)renderConfluenceDetail((state.pages||[]).find(page=>page.id===selectedConfluencePage.id));
  if(!state.pages?.length){renderConfluenceDetail();homeEmpty(pages,state.connection?"Search for a page to populate this view.":"No Confluence connection.")}
}
function requestFocusReader(id,title) {
  readerPageId=id;document.querySelector("#reader-title").textContent=title||"Confluence reader";document.querySelector("#reader-meta").textContent="Loading page content…";document.querySelector("#reader-metadata")?.remove();document.querySelector("#reader-article").replaceChildren();document.querySelector("#reader-toc").replaceChildren();
  if(!readerDialog.open)readerDialog.showModal();
  if(selectedConfluenceDocument?.page.id===id)renderReader(selectedConfluenceDocument);else vscode.postMessage({type:"confluence.reader",id});
}
function renderReader(documentData) {
  if(readerPageId!==documentData.page.id||!readerDialog.open)return;
  document.querySelector("#reader-title").textContent=documentData.page.title;document.querySelector("#reader-meta").textContent=(documentData.page.spaceName||"Confluence")+" · Updated "+new Date(documentData.page.updatedAt).toLocaleString();document.querySelector("#reader-metadata")?.remove();const metadata=wikiMetadata(documentData);metadata.id="reader-metadata";document.querySelector(".reader-header-copy").append(metadata);
  const article=document.querySelector("#reader-article"),toc=document.querySelector("#reader-toc"),tocHeading=document.createElement("h3");renderRichContent(article,documentData,"focus-");toc.replaceChildren();tocHeading.textContent="Contents";toc.append(tocHeading);
  documentData.headings.forEach(item=>{const link=button(item.text,()=>article.querySelector("#focus-"+item.id)?.scrollIntoView({behavior:"smooth",block:"start"}));link.style.paddingLeft=.35+(item.level-1)*.65+"rem";toc.append(link)});if(!documentData.headings.length)homeEmpty(toc,"No headings on this page.");
}
window.addEventListener("message",event=>{const message=event.data;
  if(message?.type==="confluence.state"&&message.state&&Array.isArray(message.state.pages))renderConfluence(message.state);
  else if(message?.type==="confluence.preview"&&message.document&&Array.isArray(message.document.headings))renderWikiPreview(message.document);
  else if(message?.type==="confluence.reader"&&message.document&&Array.isArray(message.document.headings))renderReader(message.document);
  else if(message?.type==="confluence.readError"){
    if(message.target==="preview"&&selectedConfluencePage?.id===message.id){const article=document.querySelector(".knowledge-article");article.removeAttribute("aria-busy");article.textContent=message.message;article.setAttribute("role","alert");document.querySelector("#confluence-detail").dataset.loadingPage=""}
    else if(message.target==="reader"&&readerPageId===message.id)document.querySelector("#reader-meta").textContent=message.message;
  } else if(message?.type==="confluence.bookmarked"&&typeof message.noteId==="string")pendingBookmarkedNoteId=message.noteId;
});
document.querySelector("#reader-close").addEventListener("click",()=>{readerPageId=undefined;readerDialog.close()});readerDialog.addEventListener("cancel",()=>{readerPageId=undefined});
document.querySelector("#reader-browser").addEventListener("click",()=>{if(readerPageId)vscode.postMessage({type:"confluence.open",id:readerPageId})});
document.querySelector("#confluence-form").addEventListener("submit",event=>{event.preventDefault();vscode.postMessage({type:"confluence.connect",displayName:document.querySelector("#confluence-name").value,baseUrl:document.querySelector("#confluence-url").value})});
document.querySelector("#confluence-search").addEventListener("submit",event=>{event.preventDefault();vscode.postMessage({type:"confluence.search",query:document.querySelector("#confluence-query").value})});
document.querySelector("#confluence-refresh").addEventListener("click",()=>{selectedConfluenceDocument=undefined;document.querySelector("#confluence-detail").dataset.loadingPage="";vscode.postMessage({type:"confluence.refresh"})});
document.querySelector("#confluence-disconnect").addEventListener("click",()=>{selectedConfluenceDocument=undefined;vscode.postMessage({type:"confluence.disconnect"})});
`;
