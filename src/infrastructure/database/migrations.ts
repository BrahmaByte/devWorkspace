export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: "initial_schema",
    sql: `
      CREATE TABLE notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
        is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE sticky_notes (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL DEFAULT 'yellow',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        local_path TEXT NOT NULL UNIQUE,
        preferred_ide TEXT,
        jira_project_key TEXT,
        is_favourite INTEGER NOT NULL DEFAULT 0 CHECK (is_favourite IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE project_commands (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        command TEXT NOT NULL,
        platform TEXT NOT NULL CHECK (platform IN ('windows', 'macos', 'linux', 'any')),
        shell TEXT NOT NULL,
        working_directory TEXT,
        confirmation_policy TEXT NOT NULL CHECK (confirmation_policy IN ('always', 'dangerous', 'never')),
        UNIQUE(project_id, name, platform)
      );
      CREATE TABLE environment_profiles (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        variable_names_json TEXT NOT NULL DEFAULT '[]',
        UNIQUE(project_id, name)
      );
      CREATE TABLE jira_connections (
        id TEXT PRIMARY KEY,
        base_url TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE jira_issue_cache (
        id TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL REFERENCES jira_connections(id) ON DELETE CASCADE,
        external_id TEXT NOT NULL,
        issue_key TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(connection_id, external_id)
      );
      CREATE TABLE confluence_connections (
        id TEXT PRIMARY KEY,
        base_url TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE confluence_page_cache (
        id TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL REFERENCES confluence_connections(id) ON DELETE CASCADE,
        external_id TEXT NOT NULL,
        title TEXT NOT NULL,
        web_url TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(connection_id, external_id)
      );
      CREATE TABLE relationships (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        CHECK (source_type IN ('note', 'project', 'jira_issue', 'confluence_page', 'repository', 'file', 'command', 'url')),
        CHECK (target_type IN ('note', 'project', 'jira_issue', 'confluence_page', 'repository', 'file', 'command', 'url')),
        UNIQUE(source_type, source_id, target_type, target_id)
      );
      CREATE TABLE recent_resources (
        id TEXT PRIMARY KEY,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        accessed_at TEXT NOT NULL,
        UNIQUE(resource_type, resource_id)
      );
      CREATE TABLE favourites (
        id TEXT PRIMARY KEY,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(resource_type, resource_id)
      );
    `,
  },
  {
    version: 2,
    name: "optional_command_project",
    sql: `
      CREATE TABLE project_commands_v2 (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        command TEXT NOT NULL,
        platform TEXT NOT NULL CHECK (platform IN ('windows', 'macos', 'linux', 'any')),
        shell TEXT NOT NULL,
        working_directory TEXT,
        confirmation_policy TEXT NOT NULL CHECK (confirmation_policy IN ('always', 'dangerous', 'never'))
      );
      INSERT INTO project_commands_v2
        SELECT id, project_id, name, command, platform, shell, working_directory, confirmation_policy
        FROM project_commands;
      DROP TABLE project_commands;
      ALTER TABLE project_commands_v2 RENAME TO project_commands;
    `,
  },
  {
    version: 3,
    name: "jira_local_cards",
    sql: `
      CREATE TABLE jira_local_cards (
        id TEXT PRIMARY KEY,
        summary TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'done')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 4,
    name: "jira_board_preferences",
    sql: `
      CREATE TABLE jira_board_preferences (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        jql_filter TEXT NOT NULL DEFAULT ''
      );
      INSERT INTO jira_board_preferences(id, jql_filter) VALUES(1, '');
    `,
  },
  {
    version: 5,
    name: "home_url_groups",
    sql: `
      CREATE TABLE url_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        urls_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 6,
    name: "developer_applications",
    sql: `
      CREATE TABLE developer_applications (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        executable_path TEXT NOT NULL UNIQUE,
        last_launched_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 7,
    name: "calendar_planner",
    sql: `
      CREATE TABLE calendar_leave_types (id TEXT PRIMARY KEY,name TEXT NOT NULL,unit TEXT NOT NULL);
      CREATE TABLE calendar_entries (id TEXT PRIMARY KEY,start_date TEXT NOT NULL,end_date TEXT NOT NULL,leave_type_id TEXT REFERENCES calendar_leave_types(id) ON DELETE RESTRICT,data TEXT NOT NULL);
      CREATE INDEX calendar_dates ON calendar_entries(start_date,end_date);
    `,
  },
  {
    version: 8,
    name: "leave_allowances_and_colors",
    sql: `
      ALTER TABLE calendar_leave_types ADD COLUMN allowance REAL CHECK(allowance IS NULL OR (allowance >= 0 AND allowance <= 10000));
      ALTER TABLE calendar_leave_types ADD COLUMN color TEXT NOT NULL DEFAULT 'blue' CHECK(color IN ('blue','teal','amber','pink'));
    `,
  },
  {
    version: 9,
    name: "calendar_custom_colors",
    sql: `
      ALTER TABLE calendar_leave_types ADD COLUMN custom_color TEXT CHECK(custom_color IS NULL OR (length(custom_color)=7 AND substr(custom_color,1,1)='#' AND lower(substr(custom_color,2)) NOT GLOB '*[^0-9a-f]*'));
    `,
  },
  {
    version: 10,
    name: "team_calendar_sources",
    sql: `CREATE TABLE team_calendar_sources (id TEXT PRIMARY KEY, name TEXT NOT NULL, origin TEXT NOT NULL, color TEXT NOT NULL, holidays INTEGER NOT NULL CHECK(holidays IN (0,1)));`,
  },
];
