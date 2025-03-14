export type PluginLocation = string | { owner: string; repo: string; ref?: string };

export type Manifest = {
  name: string;
  description?: string;
  commands?: Record<string, { description: string; "ubiquity:example": string }>;
  "ubiquity:listeners"?: string[];
  configuration?: Record<string, unknown>;
};
