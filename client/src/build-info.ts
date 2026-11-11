export interface BuildInfo {
  version: string;
  commit: string;
  builtAt: string;
}

declare const __TALENTFLY_BUILD_INFO__: BuildInfo;

const fallbackBuildInfo: Readonly<BuildInfo> = {
  version: 'unknown',
  commit: 'unknown',
  builtAt: 'unknown',
};

export const BUILD_INFO: Readonly<BuildInfo> =
  typeof __TALENTFLY_BUILD_INFO__ === 'undefined'
    ? fallbackBuildInfo
    : __TALENTFLY_BUILD_INFO__;
