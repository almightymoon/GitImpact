/** v1.2 — saved / team views for architecture focus */
export interface SavedView {
  id: string;
  repositoryId: string;
  name: string;
  /** Architecture system component ids to pin / emphasize */
  pinnedSystemIds: string[];
  /** Optional bands to hide (actors, client, server, …) */
  hiddenBands: string[];
  /** Optional free-form notes for the team */
  notes?: string;
  /** Local vs shared (DB) */
  scope: "local" | "team";
  createdAt: string;
  updatedAt: string;
}

export interface SavedViewInput {
  name: string;
  pinnedSystemIds?: string[];
  hiddenBands?: string[];
  notes?: string;
  scope?: "local" | "team";
}
