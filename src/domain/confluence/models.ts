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
  readonly media?: readonly {
    readonly id: string;
    readonly dataUrl: string;
    readonly alt: string;
  }[];
  readonly mediaWarnings?: readonly string[];
  readonly mediaLoading?: boolean;
  readonly metadata?: {
    readonly spaceKey?: string;
    readonly version?: number;
    readonly status?: string;
    readonly createdBy?: string;
    readonly updatedBy?: string;
    readonly createdAt?: string;
    readonly labels?: readonly string[];
  };
}

export interface ConfluenceState {
  readonly query?: string;
  readonly connection?: ConfluenceConnection;
  readonly pages: readonly ConfluencePage[];
  readonly status: "disconnected" | "connected" | "expired" | "error";
  readonly message?: string;
}
