import type {
  ConfirmationPolicy,
  EnvironmentProfile,
  PreferredIde,
  Project,
  ProjectCommand,
  WorkspaceState,
} from "../../domain/workspace/models";
import type { OperatingSystem } from "../../platform/platformService";
import type { LocalDatabase, SqlValue } from "./localDatabase";

function text(row: Readonly<Record<string, SqlValue>>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error("Invalid workspace data.");
  return value;
}

function optionalText(
  row: Readonly<Record<string, SqlValue>>,
  key: string,
): string | undefined {
  const value = row[key];
  if (value === null) return undefined;
  if (typeof value !== "string") throw new Error("Invalid workspace data.");
  return value;
}

export class WorkspaceRepository {
  public constructor(private readonly database: LocalDatabase) {}

  public getState(): WorkspaceState {
    return {
      projects: this.database
        .query("SELECT * FROM projects ORDER BY is_favourite DESC, name;")
        .map((row): Project => ({
          id: text(row, "id"),
          name: text(row, "name"),
          localPath: text(row, "local_path"),
          preferredIde: optionalText(row, "preferred_ide") as
            PreferredIde | undefined,
          jiraProjectKey: optionalText(row, "jira_project_key"),
          isFavourite: row.is_favourite === 1,
          createdAt: text(row, "created_at"),
          updatedAt: text(row, "updated_at"),
        })),
      commands: this.database
        .query("SELECT * FROM project_commands ORDER BY name;")
        .map((row): ProjectCommand => ({
          id: text(row, "id"),
          projectId: optionalText(row, "project_id"),
          name: text(row, "name"),
          command: text(row, "command"),
          platform: text(row, "platform") as OperatingSystem | "any",
          shell: text(row, "shell"),
          workingDirectory: optionalText(row, "working_directory"),
          confirmationPolicy: text(
            row,
            "confirmation_policy",
          ) as ConfirmationPolicy,
        })),
      environmentProfiles: this.database
        .query("SELECT * FROM environment_profiles ORDER BY name;")
        .map((row): EnvironmentProfile => ({
          id: text(row, "id"),
          projectId: optionalText(row, "project_id"),
          name: text(row, "name"),
          description: text(row, "description"),
          variableNames: JSON.parse(
            text(row, "variable_names_json"),
          ) as string[],
        })),
    };
  }

  public async createProject(project: Project): Promise<void> {
    this.database.run(
      "INSERT INTO projects(id,name,local_path,preferred_ide,is_favourite,created_at,updated_at) VALUES(?,?,?,?,?,?,?);",
      [
        project.id,
        project.name,
        project.localPath,
        project.preferredIde ?? null,
        project.isFavourite ? 1 : 0,
        project.createdAt,
        project.updatedAt,
      ],
    );
    await this.database.persist();
  }

  public async updateProject(
    id: string,
    name: string,
    localPath: string,
    preferredIde: PreferredIde | undefined,
    now: string,
  ): Promise<void> {
    this.requireProject(id);
    this.database.run(
      "UPDATE projects SET name=?,local_path=?,preferred_ide=?,updated_at=? WHERE id=?;",
      [name, localPath, preferredIde ?? null, now, id],
    );
    await this.database.persist();
  }

  public async setFavourite(
    id: string,
    favourite: boolean,
    now: string,
  ): Promise<void> {
    this.requireProject(id);
    this.database.run(
      "UPDATE projects SET is_favourite=?,updated_at=? WHERE id=?;",
      [favourite ? 1 : 0, now, id],
    );
    await this.database.persist();
  }

  public async deleteProject(id: string): Promise<void> {
    this.requireProject(id);
    this.database.run("DELETE FROM projects WHERE id=?;", [id]);
    await this.database.persist();
  }

  public getProject(id: string): Project | undefined {
    return this.getState().projects.find((project) => project.id === id);
  }
  public getProjectByJiraKey(jiraProjectKey: string): Project | undefined {
    return this.getState().projects.find(
      (project) => project.jiraProjectKey === jiraProjectKey,
    );
  }
  public async associateJiraProject(
    id: string,
    jiraProjectKey: string,
    now: string,
  ): Promise<void> {
    this.requireProject(id);
    this.database.run(
      "UPDATE projects SET jira_project_key=NULL WHERE jira_project_key=? AND id<>?;",
      [jiraProjectKey, id],
    );
    this.database.run(
      "UPDATE projects SET jira_project_key=?,updated_at=? WHERE id=?;",
      [jiraProjectKey, now, id],
    );
    await this.database.persist();
  }
  public getCommand(id: string): ProjectCommand | undefined {
    return this.getState().commands.find((command) => command.id === id);
  }

  public async createCommand(command: ProjectCommand): Promise<void> {
    if (command.projectId) this.requireProject(command.projectId);
    this.database.run(
      "INSERT INTO project_commands(id,project_id,name,command,platform,shell,working_directory,confirmation_policy) VALUES(?,?,?,?,?,?,?,?);",
      [
        command.id,
        command.projectId ?? null,
        command.name,
        command.command,
        command.platform,
        command.shell,
        command.workingDirectory ?? null,
        command.confirmationPolicy,
      ],
    );
    await this.database.persist();
  }
  public async deleteCommand(id: string): Promise<void> {
    if (!this.getCommand(id)) throw new Error("Command not found.");
    this.database.run("DELETE FROM project_commands WHERE id=?;", [id]);
    await this.database.persist();
  }

  public async createEnvironment(profile: EnvironmentProfile): Promise<void> {
    if (profile.projectId) this.requireProject(profile.projectId);
    this.database.run(
      "INSERT INTO environment_profiles(id,project_id,name,description,variable_names_json) VALUES(?,?,?,?,?);",
      [
        profile.id,
        profile.projectId ?? null,
        profile.name,
        profile.description,
        JSON.stringify(profile.variableNames),
      ],
    );
    await this.database.persist();
  }
  public async deleteEnvironment(id: string): Promise<void> {
    this.database.run("DELETE FROM environment_profiles WHERE id=?;", [id]);
    await this.database.persist();
  }

  private requireProject(id: string): void {
    if (
      Number(
        this.database.getScalar("SELECT COUNT(*) FROM projects WHERE id=?;", [
          id,
        ]),
      ) !== 1
    )
      throw new Error("Project not found.");
  }
}
