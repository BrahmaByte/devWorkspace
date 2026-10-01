export interface ConfluenceConnection {
  readonly id: string;
  readonly baseUrl: string;
  readonly displayName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ConfluencePage {
  readonly id: string;
  readonly title: string;
  readonly spaceName?: string;
  readonly webUrl: string;
  readonly updatedAt: string;
}

export interface ConfluenceReaderHeading {
  readonly id: string;
  readonly level: number;
  readonly text: string;
}

export interface ConfluenceReaderDocument {
  readonly page: ConfluencePage;
  readonly html: string;
  readonly headings: readonly ConfluenceReaderHeading[];
}

export interface ConfluenceState {
  readonly connection?: ConfluenceConnection;
  readonly pages: readonly ConfluencePage[];
  readonly status: "disconnected" | "connected" | "expired" | "error";
  readonly message?: string;
}
