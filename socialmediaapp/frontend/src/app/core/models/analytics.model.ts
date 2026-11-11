/** Insight categories used to group metrics in the UI. */
export type MetricCategory = 'reach' | 'audience' | 'engagement' | 'monetization';

/** A single analytics metric returned for an account. */
export interface AnalyticsMetric {
  key: string;
  label: string;
  value: number;
  /** Which insight group this metric belongs to (defaults to engagement). */
  category?: MetricCategory;
}

/**
 * Monetisation block. Kept separate from the main metrics because most
 * platforms don't expose revenue at all — `supported:false` carries a `note`
 * explaining why, rather than us inventing numbers.
 */
export interface MonetizationInfo {
  supported: boolean;
  metrics?: AnalyticsMetric[];
  note?: string;
}

/** The analytics result for one connected account over a period. */
export interface AnalyticsResult {
  supported: boolean;
  metrics: AnalyticsMetric[];
  monetization?: MonetizationInfo;
  note?: string;
  /** Diagnostic lines (e.g. which metrics the platform API rejected and why). */
  debug?: string[];
}
