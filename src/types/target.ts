export type Target = {
  type: string;
  owner: string;
  repo: string;
  localDir: string;
  url: string;
  filePath: string;
  readonly: boolean;
};
