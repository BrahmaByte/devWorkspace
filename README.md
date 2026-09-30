# DevWorkspace

> A local-first developer command center inside VS Code.

## Vision

DevWorkspace brings the everyday developer workflow into one workspace:

- Jira work
- local projects
- IDEs
- terminals
- commands
- environments
- notes
- sticky notes
- Confluence knowledge
- unified search

The product is designed to feel like a native developer workspace rather than a collection of unrelated VS Code extension panels.

## Supported platforms

- Windows
- macOS
- Linux

The release-validation matrix targets:
- Windows x64
- macOS Intel
- macOS Apple Silicon
- Linux x64

## Product principles

### Local-first

The first version does not require a DevWorkspace cloud backend.

Corporate and personal data stays on the user's machine unless the user explicitly connects to an external service such as Jira or Confluence.

### Security-first

- Jira and Confluence credentials use VS Code SecretStorage.
- Credentials are never stored in SQLite.
- Credentials are never exposed to the Webview.
- No source-code upload.
- No corporate-data telemetry by default.
- Webview operations use a typed message protocol.
- Shell commands go through a controlled execution service.

### AI is future scope

AI is deliberately not part of the initial implementation.

The architecture should provide a clean context/search layer so AI can be added later without changing the trust model.

## Main areas

### Home

Developer command center with:
- current task
- favourite projects
- sticky notes
- quick actions
- recent resources
- search

### Jira

- PAT connection
- current/assigned issues
- issue details
- Kanban-style board
- search
- Start Work workflow

### Workspace

- terminal
- one-click commands
- environment profiles
- Git context

### Notes

Developer-oriented local notes:
- Markdown/rich content
- sticky notes
- search
- pin/archive
- relationships to Jira/projects/Confluence

### Knowledge

Confluence integration:
- PAT connection
- search
- page metadata
- open page
- two-pane page browsing and details
- attach a selected page to an existing note

## Security boundary

```text
Webview UI
    |
    | typed messages only
    v
Extension Host
    |
    +--> SQLite
    |
    +--> VS Code APIs
    |
    +--> Jira API
    |
    +--> Confluence API
    |
    +--> SecretStorage
```

The Webview does not receive credentials and does not directly access filesystem, terminal or network capabilities.

## Architecture and privacy

DevWorkspace is local-first and has no product backend or telemetry. Notes,
projects, commands, layouts, URL groups, relationships, and bounded Jira and
Confluence metadata remain in the VS Code extension global-storage directory.
Environment profiles store variable names, never values. Confluence page bodies
are not cached.

```text
Untrusted Webview
  -> exact, schema-validated messages
  -> trusted Extension Host services
  -> SQLite / SecretStorage / VS Code APIs / Jira / Confluence
```

The Webview cannot access SecretStorage, local files, terminals, or the network
directly. External URLs and filesystem paths are resolved and authorized by the
Extension Host. See the repository-local architecture and security documents for
the full trust model and residual risks.

## Local data

SQLite is used for application state such as:
- notes
- sticky notes
- projects
- commands
- environment metadata
- relationships
- cached integration metadata

Credentials are not stored in SQLite.

## Development

Read these files before contributing:

- `AGENTS.md`
- `SKILL.md`
- `PROJECT_TRACKING.md`

Every milestone must be tested, documented and committed.

### Prerequisites

- Node.js 22
- npm 10 or later
- VS Code 1.95 or later

## Installation

DevWorkspace `0.1.0-rc.1` is a release candidate distributed as a VSIX; it is
not published to the VS Code Marketplace.

1. Download or build `devworkspace.vsix`.
2. In VS Code, run **Extensions: Install from VSIX…** and select the file.
3. Reload VS Code when prompted.
4. Run **DevWorkspace: Open DevWorkspace** from the Command Palette.

For command-line installation:

```sh
code --install-extension devworkspace.vsix --force
```

To build the candidate from source, run `npm ci` followed by
`npm run validate`. The latter produces and verifies `devworkspace.vsix`.

## Jira and Confluence setup

Configuration lives under the settings icon at the bottom of the DevWorkspace
navigation rail. Use the product root URL, not a board, project, space, or page
URL. HTTPS is required except for loopback development endpoints.

For Atlassian Cloud (`*.atlassian.net`):

1. Enter the Cloud product root URL; DevWorkspace selects Cloud authentication
   from the hostname.
2. Enter the Atlassian account email in VS Code's native prompt.
3. Enter an Atlassian API token in the following masked prompt.

For Jira or Confluence Data Center:

1. Enter the Data Center product root URL; DevWorkspace selects bearer-token
   authentication for non-Cloud hosts.
2. Enter the PAT in VS Code's masked native prompt.

Jira credentials need permission to read the current user and browse the issues
selected by the board filter. Confluence credentials need permission to search
and view the intended pages. Credentials are stored only in VS Code
SecretStorage; connection metadata and bounded issue/page metadata caches are
stored locally in SQLite. Disconnecting removes the credential and provider
cache.

### Validate the scaffold

```sh
npm install
npm run validate
```

The validation command checks formatting, lint, type safety, unit tests,
compilation and VSIX packaging. The generated `devworkspace.vsix` is ignored by
Git.

### Run the extension

Open the repository in VS Code, press `F5`, and run **DevWorkspace: Open
DevWorkspace** in the Extension Development Host. See `docs/MANUAL_TESTING.md`
for the complete Milestone 0 manual check.

## Current implementation

Milestones 0 through 12 provide the npm/TypeScript toolchain, VS Code extension
manifest, a full editor shell with Home/Jira/Workspace/Notes/Knowledge
navigation, a typed and runtime-validated Webview protocol, restrictive CSP,
error boundary, platform abstraction, and a migration-backed local SQLite data
layer. The database is stored under VS Code's extension global-storage directory,
not inside the extension or a project. New and existing notes support debounced
autosave, plus create, delete, pin/archive, and local text search. Sticky notes use
a centered editor dialog for viewing and editing. Saved content is rendered
as plain text inside the network-isolated Webview. A shared header provides a
live local clock and persistent light/dark appearance toggle. Home includes a
desktop sticky-note card, while Notes uses a familiar three-pane notes layout.
The shared enterprise visual system uses layered color gradients, elevated
content panels, and a foreground navigation rail across both themes.
Workspace management adds folder-picker-based local project CRUD, Git branch
metadata, VS Code terminal launching, stored platform-specific commands with
confirmation policies, and environment profiles
that retain variable names but never secret values.
Commands can only be launched after they have passed host-side validation and
been stored locally. Command shortcuts can run in the default VS Code terminal
directory or an optional folder explicitly chosen with the native folder picker;
they do not require a project association. The shortcut form exposes only its
name, stored command, and optional terminal folder. Platform, shell, and
confirmation defaults remain controlled by the Extension Host. Tests, packaging,
and a Windows/macOS/Linux CI matrix are included. Home provides fixed-size
sticky-note previews, the current Jira task, and locally saved groups of
frequently used HTTPS URLs. Hovering a URL group reveals its links; individual
links or the whole bounded group open through VS Code's external-browser API.
Page cards can be resized and rearranged, with layout retained in VS Code
Webview state. Jira and Confluence automatically select the
direct authentication scheme from the site URL: Atlassian Cloud uses an account
email plus API token over HTTP Basic authentication, while Data Center uses a
personal access token (PAT) as a bearer token. VS Code collects emails and
tokens in native prompts and stores the complete credential only in
SecretStorage; the Webview receives only connection,
current-user, and issue data. Assigned unresolved issues are cached locally for
offline display, and issue details are loaded on demand. Integration connection
details are configured from the dedicated Settings page; credential entry
remains in native VS Code prompts. Jira work is shown in fixed To Do, In
Progress, and Done columns with a bounded custom JQL filter. Local-only cards
are stored separately in SQLite and are never sent to Jira. The last successful
custom JQL filter is persisted locally, restored at startup, and reapplied after
board interactions. Selected issues show status, type, priority, people, parent,
labels, timestamps, and a plain-text description. Issue links are constructed
and opened by the Extension Host through VS Code's external-browser API. An
issue can be associated with a local
project and opened in a VS Code terminal; optional Git branch changes use fixed
Git arguments and require explicit confirmation. Confluence Cloud site roots
are normalized to the product's `/wiki` path. Knowledge search fetches at most
25 page-metadata results, caches
no page bodies, and opens same-origin page URLs through VS Code. The two-pane
Knowledge view can save a selected cached page as persistent linked context on
an existing local note. AI remains
intentionally unimplemented. Notes can attach cached Jira issues, Confluence
pages, and local projects as persistent linked context. External links open only
through host-validated provider services; unavailable external resources remain
visible as stale context, while deleting a note or project removes its local
relationships.
Jira and Confluence connection attempts show progress and sanitized, actionable
errors in Settings for invalid URLs, rejected credentials, missing API endpoints, HTTP
failures, DNS, connection refusal, timeout, and TLS failures. Raw server errors
and credentials remain host-only; TLS verification is never bypassed.
Jira validates identity before loading assigned issues. If identity succeeds but
issue access is denied, the valid connection is retained and the UI requests the
required Browse Projects and issue permissions instead of mislabeling the PAT.
The dedicated Global Search page searches local notes, projects, and stored
commands together with locally cached Jira issues and Confluence page metadata.
An empty query shows recent resources, while unavailable providers are reported
without hiding results from healthy providers. Results are rendered only through
DOM text nodes and open through host-side, type-specific handlers. Use
`Ctrl+Alt+K` (`Cmd+Alt+K` on macOS) or the header search icon to open it.
Security hardening adds a documented threat model, strict plain-object protocol
validation, one-use native folder-picker authorization for new project paths,
and dedicated regression coverage for hostile messages, XSS sinks, command
controls, path traversal, URLs, and credential boundaries.
Cross-platform release validation runs the same format, lint, typecheck, test,
build, and VSIX packaging gate on pinned Windows x64, macOS Intel, macOS Apple
Silicon, and Linux x64 runners. Each job verifies its actual runtime architecture
before testing and retains its validated VSIX as a CI artifact.

See `docs/ARCHITECTURE.md` for the source boundaries.
See `docs/SECURITY.md` for the threat model, privacy behavior, residual risks,
and release security checks.

## Roadmap

1. Repository/scaffolding
2. Cross-platform shell
3. SQLite
4. Notes
5. Workspace/projects
6. Home
7. Jira
8. Jira Start Work
9. Confluence
10. Knowledge relationships
11. Search
12. Security hardening
13. Cross-platform release validation
14. Release candidate

See `PROJECT_TRACKING.md` for acceptance criteria and milestone gates.

## Troubleshooting

- **The command is missing:** run it in the Extension Development Host or ensure
  the VSIX is installed and VS Code has been reloaded. The command is named
  **DevWorkspace: Open DevWorkspace**.
- **The extension host times out under F5:** use `npm run dev:host` or VS Code's
  **Run Without Debugging** action. A debugger paused on entry can produce the
  ten-second timeout before activation runs.
- **The panel is unresponsive:** reload the VS Code window and inspect
  **Developer: Toggle Developer Tools** for a Webview script or CSP error. The
  automated suite parses the emitted Webview script to prevent syntax regressions.
- **Jira or Confluence rejects authentication:** Cloud requires account email plus
  API token; Data Center uses a PAT. Verify the product root URL and required
  browse/view permissions. Raw server errors and credentials are intentionally
  not displayed.
- **A project or command folder is rejected:** select it with the provided VS Code
  folder button. Typed filesystem paths are not trusted.
- **A command does not run:** commands must be saved first, contain no newlines or
  NUL characters, and pass the native confirmation step.
- **Cached integration data looks stale:** refresh the provider or reconnect from
  Settings. Offline metadata is deliberately retained for local continuity.

## Known limitations

- This is an `0.1.0-rc.1` release candidate, not a Marketplace release.
- OAuth 2.0 registered-app authentication is not implemented; Cloud API tokens
  and Data Center PATs are supported.
- Jira status values are mapped into a fixed To Do, In Progress, and Done view;
  the app is not a complete Jira client.
- Confluence stores and searches bounded page metadata only. It does not cache or
  render page bodies and does not bulk synchronize spaces.
- Commands run in a visible VS Code terminal after confirmation; DevWorkspace is
  not a shell sandbox and cannot prove that an approved command is harmless.
- Local SQLite data relies on device and VS Code profile protection and is not
  separately encrypted by the extension.
- There is no cloud sync, multi-device synchronization, telemetry, or AI layer.
- The package is `UNLICENSED` and intended for evaluation until a distribution
  license is selected.

## Non-goals for the initial release

- AI assistant
- DevWorkspace cloud sync
- centralized corporate data ingestion
- full Jira replacement
- full Confluence replacement
- arbitrary remote code execution
- automatic destructive Git operations

## License

UNLICENSED. No redistribution grant is provided with this release candidate.
