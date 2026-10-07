# DevDashboardV1

<p align="center">
  <img src="https://BrahmaByte.gallery.vsassets.io/_apis/public/gallery/publisher/BrahmaByte/extension/devdashboardv1/latest/assetbyname/Microsoft.VisualStudio.Services.Icons.Default" width="128" height="128" alt="DevDashboardV1 logo" />
</p>

A local-first developer dashboard for VS Code on Windows, macOS, and Linux.

## Install and open

Install [DevDashboardV1 from the Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=BrahmaByte.devdashboardv1).
Then run **DevDashboardV1: Open DevDashboardV1** from the Command Palette.

You can reopen the dashboard at any time with the same command.

On first use, a starter guide opens automatically and walks through each page.
Use **Back**, **Next**, **Skip**, or **Escape**; the dashboard remains usable.
Replay it from the header guide icon or **DevDashboardV1: Show starter guide**.
After an update, a shorter **What's new** guide appears once per installed
version. Skipping or closing it will not cause repeated prompts on restart.

## Version 0.1.10

- Added a skippable starter tour, replay controls and once-per-version update guide.
- Added secure network logs and accurate proxy rejection messages.
- Improved proxy credential setup instructions.

## Screenshots

![Dashboard screenshot carousel: Home light and dark, Notes, Jira, Confluence and Settings](assets/screenshots/carousel.gif)

Still images: [Home light](assets/screenshots/home-light.png) ·
[Home dark](assets/screenshots/home-dark.png) · [Notes](assets/screenshots/notes.png) ·
[Jira](assets/screenshots/jira-reader.png) · [Confluence](assets/screenshots/knowledge.png) ·
[Settings](assets/screenshots/settings.png).

## Home

Home contains:

- **Sticky notes:** create a note with the plus icon, then click a sticky to view,
  edit, recolor, or delete it.
- **Current Jira task:** opens the Jira board when selected.
- **URL groups:** save a named set of frequently used HTTPS links.
- **Developer apps:** add an application with the native picker, launch it, see
  whether a dashboard-started instance is running, and close that instance after
  confirmation. Apps appear in a grid with their installed icon when available.

On macOS, apps open through the system application launcher. An app already
running is brought forward; its close action stays disabled to protect sessions
opened outside the dashboard. Closing a dashboard-started app updates its tile
to Stopped once it exits.

Hover over or focus a URL-group name to show its URLs. Select an individual URL
to open it, or use the open-all icon to launch the complete group in your default
browser. Every icon includes a hover description.

Application paths stay in the local database and are never sent to the dashboard
Webview. DevDashboardV1 tracks and closes only instances that it launched; it does
not scan for or terminate unrelated system processes.

## Jira

The Jira page presents work in **To Do**, **In Progress**, and **Done** columns.

- Enter JQL in the filter field and apply it with the check icon. The last
  successful filter is restored automatically.
- Use the sync icon to refresh Jira on demand while retaining the saved filter.
- Select an issue for a full-screen viewer with formatted details and comments.
  Load more comments, refresh the thread, or open it in your default browser.
  New comments require confirmation in VS Code and Jira Add Comments permission.
- Add local-only cards at the bottom of the board. These cards stay on your
  computer and are never sent to Jira.

## Workspace

Use Workspace to manage local development tools:

- **Projects:** select folders with the VS Code folder picker, view the current
  Git branch, and open a VS Code terminal in a project.
- **Command shortcuts:** save a command with an optional terminal folder. Running
  it opens a visible VS Code terminal and requires confirmation when appropriate.
- **Environment profiles:** save environment-variable names for reference. Secret
  values are not stored.

Command text is preserved exactly, including repeated spaces.

## Notes

Notes are stored locally and save automatically while you type.

Updating the extension preserves your saved notes, bookmarks, and project folders.

- Use the plus icon above the notes list to create a note.
- Search notes from the left column.
- Select a note to view or edit it.
- Use the delete icon in the editor header to remove the selected note.

Confluence bookmarks appear as structured reference cards with actions to open
the page in Focus Reader or your default browser.

## Knowledge

Knowledge provides a two-column Confluence browser:

Previously opened pages load from a five-minute session cache (up to five pages,
24 MB). Refresh Confluence in Settings to discard it and retrieve fresh content.
Page bodies and images are never cached on disk.

Search matches titles, page text and labels across pages you can access. Suggestions
appear after a short typing pause; press Enter to search immediately. Repeated
searches use a one-minute session cache. Formatted text appears first, while images
and diagrams load in parallel.

1. Search for a Confluence page in the left column.
2. Select a result to read its formatted content in the right pane. The header
   shows its space, version, authors, dates, status, and labels when available.
3. Use the reader icon for a full-screen, distraction-free view with a generated
   table of contents.
4. Use the bookmark icon to save the page as a local note reference.
5. Use the external-open icon to open the original page in your default browser.

Images and static diagrams appear in both reading views. Unavailable or blocked
media is clearly identified; use the external-open icon for active macros or
unsupported embeds. Page bodies and images are loaded on selection and are not
cached on disk. Focus Reader includes the same metadata and a table of contents.

## Global search

Use the search icon in the header or:

- `Ctrl+Alt+K` on Windows and Linux
- `Cmd+Alt+K` on macOS

Search covers local notes, projects, command shortcuts, cached Jira issues, and
cached Confluence page metadata.

## Settings and Atlassian connections

Open Settings with the icon at the bottom of the navigation rail. Enter the Jira
or Confluence product root URL, not a board, project, space, or page URL.

For Atlassian Cloud:

1. Enter the `atlassian.net` product URL.
2. Enter your Atlassian account email in the VS Code prompt.
3. Enter an Atlassian API token in the masked prompt.

For Jira or Confluence Data Center:

1. Enter the HTTPS product root URL.
2. Enter a personal access token in the masked VS Code prompt.

Credentials are stored in VS Code SecretStorage and are never sent to the
dashboard Webview or written to the local database. Disconnecting removes the
stored credential and cached provider metadata.

VS Code-managed networking is the default, including for existing installs with
legacy custom proxy settings. Legacy settings remain saved but inactive; explicitly
configure an extension-only proxy again if you need that override. To restore the
default later, select **Settings → Network proxy → Use VS Code proxy (default)**.
This delegates PAC/bypass rules and supported
authentication negotiation to VS Code. The picker can open VS Code proxy settings;
it never changes global network settings automatically. Authentication support
depends on your VS Code version, OS and corporate policy.

If VS Code's proxy does not work, use **Settings → Network proxy** to configure
an extension-only HTTP/HTTPS proxy. For Basic authentication, enter your
IT-provided proxy username and password in the VS Code prompts, not your Jira
or Confluence credentials. Leave the username empty if authentication is not
required. Credentials are stored in SecretStorage. You can select an IT-approved
PEM CA bundle for corporate TLS certificates. Certificate verification stays on.
The override affects only Jira and Confluence, takes effect on the next request,
and never falls back to a direct connection. Select **Use VS Code proxy (default)**
to remove it. Other extensions and VS Code settings are unchanged.

## Appearance and layout

- The header greets you using your connected Jira display name and shows local time.
- Use the floating bottom-right zoom widget to scale from 80% to 150%; minimize
  it with the minus icon and expand with the plus icon. Click the percentage
  to reset. `Ctrl/Cmd` with `+`, `-`, or `0` and `Ctrl/Cmd` + wheel also work when
  the dashboard has focus. VS Code may handle its own global zoom shortcuts.
- Use the header theme icon to switch between light and dark mode.
- Resize cards from their lower-right edge.
- Home and Settings cards start at consistent sizes unless you saved a manual resize.
- Drag cards with the grip icon, or focus the grip and use the arrow keys, to
  rearrange them.
- Theme, zoom, and card layout are restored when the dashboard is reopened.
- Window resizing temporarily constrains cards without replacing saved sizes.

## Troubleshooting

- **Open command is missing:** confirm the extension is installed, then reload VS Code.
- **Jira or Confluence authentication fails:** confirm the product root URL,
  token type, and browse/view permissions.
- **Jira or Confluence is blocked by a corporate network:** connect the required
  VPN, then use **Open Proxy Settings** from the error message. DevDashboardV1
  uses VS Code's proxy, proxy authentication, and trusted system certificates;
  reload VS Code after changing managed proxy settings.
  Alternatively, configure **Settings → Network proxy** for this extension only.
- **Proxy connection diagnostics:** open **View → Output**, select
  **DevDashboardV1 Network**, then retry connecting, syncing Jira, or refreshing
  Confluence. Logs show network mode, HTTP status, elapsed time and safe
  DNS/TLS/proxy/timeout hints. URLs, credentials, headers and page content are
  omitted. Cached pages do not trigger network logs.
  **Proxy CONNECT HTTP 403** indicates proxy access policy, **3xx** may indicate
  a corporate sign-in redirect, **407** indicates proxy authentication, and
  **502/504** indicate a proxy/upstream failure, not a user cancellation; they
  do not establish whether routing, authentication, DNS or server availability
  caused it. Compare the failing route with the working browser or VS Code route.
  The extension-only proxy supports Basic authentication; use VS Code's managed
  proxy for corporate NTLM/Kerberos/SSO authentication.
- **A project or terminal folder is rejected:** select it with the provided VS
  Code folder picker instead of typing a path.
- **A command does not run:** save it first and approve the VS Code confirmation
  prompt. Multiline commands are rejected.
- **The dashboard stops responding:** run **Developer: Reload Window** and reopen
  DevDashboardV1.
