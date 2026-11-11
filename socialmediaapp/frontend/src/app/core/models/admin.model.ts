/**
 * Per-platform config as returned by the Admin API. The client secret is never
 * sent to the browser in full — only a masked hint and a "has secret" flag.
 */
export interface AdminPlatformConfig {
  key: string;
  enabled: boolean;
  clientId: string;
  clientSecretMasked: string;
  hasClientSecret: boolean;
  redirectUri: string;
  scopes: string[];
  apiVersion: string;
}

/** Fields the UI can send back to update a platform. */
export interface AdminPlatformUpdate {
  enabled?: boolean;
  clientId?: string;
  /** Only send when the user actually typed a new secret. */
  clientSecret?: string;
  redirectUri?: string;
  scopes?: string[];
  apiVersion?: string;
}
