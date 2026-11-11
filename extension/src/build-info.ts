export interface BuildInfo {
  version: string;
  commit: string;
  builtAt: string;
}

interface ChromeRuntimeApi {
  runtime?: {
    getManifest(): { version?: string };
  };
}

declare const __TALENTFLY_BUILD_INFO__: BuildInfo;

const fallbackBuildInfo: Readonly<BuildInfo> = {
  version: 'unknown',
  commit: 'unknown',
  builtAt: 'unknown',
};

const bundledBuildInfo: Readonly<BuildInfo> =
  typeof __TALENTFLY_BUILD_INFO__ === 'undefined'
    ? fallbackBuildInfo
    : __TALENTFLY_BUILD_INFO__;

export function getExtensionBuildInfo(
  chromeApi: ChromeRuntimeApi | undefined = (
    globalThis as typeof globalThis & { chrome?: ChromeRuntimeApi }
  ).chrome,
): Readonly<BuildInfo> {
  const installedVersion = chromeApi?.runtime?.getManifest().version;
  return {
    ...bundledBuildInfo,
    version: installedVersion ?? bundledBuildInfo.version,
  };
}
