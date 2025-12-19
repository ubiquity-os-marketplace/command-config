export type PluginLocation = string | { owner: string; repo: string; ref?: string };

export type Manifest = {
  name: string;
  description?: string;
  short_name?: string;
  commands?: Record<string, { description?: string; "ubiquity:example"?: string; parameters?: unknown }>;
  "ubiquity:listeners"?: string[];
  configuration?: Record<string, unknown>;
  homepage_url?: string;
  config_properties?: string[];
};
