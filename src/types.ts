export interface Env {
  SHORTY_KV: KVNamespace;
  API_KEY?: string;
  APP_NAME?: string;
  DEFAULT_REDIRECT_CODE?: string;
  RATE_LIMIT_PER_MINUTE?: string;
}

export interface LinkRecord {
  slug: string;
  target: string;
  createdAt: number;
  expiresAt: number | null;
  status: number;
  clicks: number;
  lastClickedAt: number | null;
  createdBy?: string;
}

export interface LinkStats extends LinkRecord {
  countries: Record<string, number>;
  referrers: Record<string, number>;
}

export interface CreateLinkPayload {
  url: string;
  slug?: string;
  expiresIn?: number;
  status?: number;
}
