export const stickyColors = ["yellow", "blue", "green", "pink"] as const;

export type StickyColor = (typeof stickyColors)[number];

export interface Note {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly isPinned: boolean;
  readonly isArchived: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StickyNote {
  readonly id: string;
  readonly content: string;
  readonly color: StickyColor;
  readonly sortOrder: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}
