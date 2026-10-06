// Render the real dashboard with synthetic, credential-free data only.
import { readFile, writeFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import process from "node:process";

const browser = process.argv[2];
if (!browser)
  throw new Error(
    "Usage: node scripts/capture-screenshots.mjs <Chrome executable path> (run npm run build first)",
  );
const require = createRequire(import.meta.url);
const { createWebviewHtml } = require("../dist/src/webview/app/shell.js");
const output = resolve("assets/screenshots");
const temporary = await mkdtemp(join(tmpdir(), "dashboard-screenshots-"));
const execute = promisify(execFile);
const createdAt = "2026-10-06T09:00:00Z";
const connection = {
  id: "sample",
  displayName: "Team workspace",
  baseUrl: "https://example.test",
  createdAt,
  updatedAt: createdAt,
};
const issue = {
  id: "1",
  key: "DEMO-12",
  summary: "Review the developer onboarding guide",
  status: "In Progress",
  issueType: "Task",
  priority: "Medium",
  assignee: "Demo Developer",
  reporter: "Documentation team",
  createdAt,
  updatedAt: createdAt,
  labels: ["documentation"],
  descriptionHtml:
    "<h2>Review checklist</h2><p>Check the <strong>developer setup</strong> instructions before the next release.</p><ul><li>Verify project setup steps.</li><li>Confirm the test commands.</li><li>Update the troubleshooting notes.</li></ul>",
};
const page = {
  id: "42",
  title: "Developer onboarding",
  spaceName: "Engineering",
  webUrl: "https://example.test/wiki/pages/42",
  updatedAt: createdAt,
};
const documentData = {
  page,
  headings: [{ id: "reader-section-1", level: 2, text: "Getting started" }],
  metadata: {
    spaceKey: "ENG",
    version: 3,
    status: "current",
    createdBy: "Documentation team",
    updatedBy: "Demo Developer",
    createdAt,
    labels: ["onboarding"],
  },
  html: '<h2 data-reader-id="reader-section-1">Getting started</h2><p>Use this guide to set up your <strong>local development workflow</strong>.</p><h3>First steps</h3><ol><li>Open the project folder.</li><li>Install the project dependencies.</li><li>Run the test suite.</li></ol><pre><code>npm install\nnpm test</code></pre><table><tr><th>Tool</th><th>Purpose</th></tr><tr><td>Project terminal</td><td>Run saved commands</td></tr><tr><td>Notes</td><td>Keep local references</td></tr></table>',
};
const notes = [
  {
    id: "00000000-0000-4000-8000-000000000010",
    title: "Development checklist",
    content:
      "Before starting work\n\nReview the active Jira task.\nOpen the project terminal.\nKeep useful links in a URL group.\n\nNotes save automatically while you type.",
    isPinned: false,
    isArchived: false,
    createdAt,
    updatedAt: createdAt,
  },
];
const stickyNotes = [
  {
    id: "00000000-0000-4000-8000-000000000011",
    content: "Review changes before committing.",
    color: "yellow",
    sortOrder: 0,
  },
  {
    id: "00000000-0000-4000-8000-000000000012",
    content: "Keep useful documentation close at hand.",
    color: "blue",
    sortOrder: 1,
  },
];
const home = {
  favouriteProjects: [],
  quickCommands: [],
  recentResources: [],
  stickyNotes,
  developerApplications: [
    "Editor",
    "Browser",
    "API client",
    "Database tool",
  ].map((name, index) => ({
    id: `00000000-0000-4000-8000-00000000000${index}`,
    name,
    status: "stopped",
    canClose: false,
  })),
  urlGroups: [
    {
      id: "00000000-0000-4000-8000-000000000013",
      name: "Developer resources",
      urls: ["https://code.visualstudio.com/docs", "https://github.com"],
      createdAt,
      updatedAt: createdAt,
    },
  ],
  jira: { connected: true },
};
try {
  await mkdir(output, { recursive: true });
  const logo =
    "data:image/png;base64," +
    (await readFile("assets/devdashboardv1-icon.png")).toString("base64");
  for (const [name, view, theme] of [
    ["home-light", "home", "light"],
    ["home-dark", "home", "dark"],
    ["notes", "notes", "light"],
    ["settings", "settings", "light"],
    ["jira-reader", "jira", "light"],
    ["knowledge", "knowledge", "light"],
  ]) {
    let html = createWebviewHtml("file:", logo);
    const nonce = html.match(/<script nonce="([^"]+)"/)[1];
    const initial = [
      { type: "shell.state", page: view, platform: "desktop" },
      { type: "home.state", state: home },
      { type: "notes.state", notes, stickyNotes, query: "" },
      {
        type: "jira.state",
        state: {
          connection,
          currentUser: { accountId: "demo", displayName: "Demo Developer" },
          issues: [issue],
          localCards: [],
          status: "connected",
          filter: "",
        },
      },
      {
        type: "confluence.state",
        state: { connection, pages: [page], status: "connected" },
      },
    ];
    const stub = `const errors=[];window.addEventListener('error',e=>errors.push(e.message));const send=data=>window.dispatchEvent(new MessageEvent('message',{data}));window.acquireVsCodeApi=()=>({getState:()=>({theme:${JSON.stringify(theme)}}),setState:()=>{},postMessage:m=>{if(m.type==='shell.ready')setTimeout(()=>{${JSON.stringify(initial)}.forEach(send);if(${JSON.stringify(view)}==='notes')document.querySelector('.note-row')?.click();if(${JSON.stringify(view)}==='jira')document.querySelector('.jira-issue').click();if(${JSON.stringify(view)}==='knowledge')document.querySelector('.knowledge-page-row').click();},0);if(m.type==='jira.issue')setTimeout(()=>send({type:'jira.issue',issue:${JSON.stringify(issue)}}),0);if(m.type==='jira.comments')setTimeout(()=>send({type:'jira.comments',issueKey:m.issueKey,startAt:0,page:{comments:[{id:'1',author:'Documentation team',createdAt:${JSON.stringify(createdAt)},html:'<p>The setup checklist is ready for review.</p>'}]}}),0);if(m.type==='confluence.preview')setTimeout(()=>send({type:'confluence.preview',document:${JSON.stringify(documentData)}}),0)}});setTimeout(()=>{document.body.dataset.qa=errors.length?'failed':'passed';document.body.dataset.qaErrors=JSON.stringify(errors);},1000);`;
    html = html.replace(
      `<script nonce="${nonce}">`,
      `<script nonce="${nonce}">${stub}</script><script nonce="${nonce}">`,
    );
    const source = join(temporary, name + ".html");
    await writeFile(source, html);
    const { stdout } = await execute(
      browser,
      [
        "--headless",
        "--disable-gpu",
        "--hide-scrollbars",
        "--no-proxy-server",
        `--user-data-dir=${join(temporary, name + "-profile")}`,
        "--window-size=1440,1100",
        "--force-device-scale-factor=1",
        "--virtual-time-budget=2500",
        `--screenshot=${join(output, name + ".png")}`,
        "--dump-dom",
        "file://" + source,
      ],
      { timeout: 45000, maxBuffer: 2_000_000 },
    );
    if (!stdout.includes('data-qa="passed"'))
      throw new Error(
        name +
          " screenshot failed: " +
          stdout.match(/data-qa-errors="[^"]*"/)?.[0],
      );
    process.stdout.write("Captured " + name + ".png\n");
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
