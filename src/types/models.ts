import { ConfiguredModel } from "./agent.js";

export interface ModelsConfigFile {
  activeModel?: string;
  models: ConfiguredModel[];
}
