export interface Env {
  SHORTY_KV: KVNamespace;
  API_KEY?: string;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  SESSION_SECRET?: string;
  APP_NAME?: string;
  DEFAULT_REDIRECT_CODE?: string;
  RATE_LIMIT_PER_MINUTE?: string;
}

export interface SessionPayload {
  sub: string;
  iat: number;
  exp: number;
  jti: string;
}

export interface LinkRecord {
  slug: string;
  target: string;
  createdAt: number;
  expiresAt: number | null;
  status: number;
  clicks: number;
  lastClickedAt: number | null;
  domain?: string;
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
