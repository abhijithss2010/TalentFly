/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_TALENTFLY_API_URL?: string;
}

declare const __TALENTFLY_BUILD_INFO__: {
  readonly version: string;
  readonly commit: string;
  readonly builtAt: string;
};
