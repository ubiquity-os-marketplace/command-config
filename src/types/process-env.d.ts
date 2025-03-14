declare global {
  namespace NodeJS {
    interface ProcessEnv {
      GITHUB_TOKEN: string;
      OPENROUTER_API_KEY: string;
    }
  }
}

export {};
