import { randomUUID } from "node:crypto";

import type { UrlGroup } from "../../domain/home/urlGroups";
import type { UrlGroupRepository } from "../../infrastructure/database/urlGroupRepository";

export const urlGroupLimits = { name: 100, urls: 20, url: 2_000 } as const;

export class UrlGroupService {
  public constructor(private readonly repository: UrlGroupRepository) {}

  public list(): readonly UrlGroup[] {
    return this.repository.list();
  }

  public async create(name: string, urls: readonly string[]): Promise<void> {
    const normalizedName = name.trim();
    if (!normalizedName || normalizedName.length > urlGroupLimits.name)
      throw new Error("URL group name is invalid.");
    if (!urls.length || urls.length > urlGroupLimits.urls)
      throw new Error("A URL group must contain between 1 and 20 URLs.");
    const normalizedUrls = [
      ...new Set(urls.map((url) => this.validateUrl(url))),
    ];
    const now = new Date().toISOString();
    await this.repository.save({
      id: randomUUID(),
      name: normalizedName,
      urls: normalizedUrls,
      createdAt: now,
      updatedAt: now,
    });
  }

  public async delete(id: string): Promise<void> {
    await this.repository.delete(id);
  }

  public getUrls(id: string): readonly string[] {
    const group = this.repository.list().find((item) => item.id === id);
    if (!group) throw new Error("URL group was not found.");
    return group.urls.map((url) => this.validateUrl(url));
  }

  public getUrl(id: string, index: number): string {
    const url = this.getUrls(id)[index];
    if (!url) throw new Error("URL was not found.");
    return url;
  }

  private validateUrl(value: string): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > urlGroupLimits.url)
      throw new Error("URL is invalid.");
    const url = new URL(normalized);
    if (url.protocol !== "https:" || url.username || url.password)
      throw new Error(
        "Saved URLs must use HTTPS without embedded credentials.",
      );
    url.hash = "";
    return url.toString();
  }
}
