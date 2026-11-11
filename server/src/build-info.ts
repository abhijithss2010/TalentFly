import { BUILD_INFO as GENERATED_BUILD_INFO } from './build-info.generated.js';

export interface BuildInfo {
  version: string;
  commit: string;
  builtAt: string;
}

export const BUILD_INFO: Readonly<BuildInfo> = GENERATED_BUILD_INFO;
