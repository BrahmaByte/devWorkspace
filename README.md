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

Initial architecture should target:
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

- favourite projects
- preferred IDE
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
- attach pages to notes

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

Milestones 0 through 4 provide the npm/TypeScript toolchain, VS Code extension
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
Workspace management adds folder-picker-based local project CRUD, favourites,
preferred IDE and Git branch metadata, terminal launching, stored
platform-specific commands with confirmation policies, and environment profiles
that retain variable names but never secret values.
Commands can only be launched after they have passed host-side validation and
been stored locally. Tests, packaging, and a Windows/macOS/Linux CI matrix are
included. Jira, Confluence, and AI are intentionally not implemented yet.

See `docs/ARCHITECTURE.md` for the source boundaries.

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

## Non-goals for the initial release

- AI assistant
- DevWorkspace cloud sync
- centralized corporate data ingestion
- full Jira replacement
- full Confluence replacement
- arbitrary remote code execution
- automatic destructive Git operations

## License

To be decided.
