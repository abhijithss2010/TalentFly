/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TALENTFLY_PWA_ORIGIN: string;
}

declare const __TALENTFLY_BUILD_INFO__: {
  readonly version: string;
  readonly commit: string;
  readonly builtAt: string;
};
