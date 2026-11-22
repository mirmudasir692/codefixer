export interface TuiStatus {
  mode: string;
  model: string;
  provider: string;
  cwd: string;
  branch: string;
}

export interface SlashCommand {
  name: string;
  description: string;
}

export interface FileSuggestion {
  name: string;
  path: string;
  isDir: boolean;
}

export interface SuggestionState {
  type: "command" | "file";
  items: (SlashCommand | FileSuggestion)[];
  selectedIndex: number;
  query: string;
}
