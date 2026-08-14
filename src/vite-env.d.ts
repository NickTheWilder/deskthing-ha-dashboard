/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HA_DASHBOARD_MOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
