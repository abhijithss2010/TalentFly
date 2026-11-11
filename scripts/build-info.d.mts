export interface BuildInfo {
  version: string;
  commit: string;
  builtAt: string;
}

export function createBuildInfo(packagePath: string): BuildInfo;
