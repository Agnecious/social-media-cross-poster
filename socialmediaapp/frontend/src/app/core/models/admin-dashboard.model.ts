/** Business metrics for the admin dashboard. */
export interface DashboardStats {
  customers: {
    total: number;
    active30d: number;
    newThisMonth: number;
    planBreakdown: Record<string, number>;
  };
  /** Recurring revenue from active (paying) subscriptions. */
  revenue?: {
    mrrZar: number;
    payingCustomers: number;
    currency: string;
  };
  traffic: {
    pageviewsToday: number;
    pageviews7d: number;
    pageviews30d: number;
    signups7d: number;
  };
}

/** System health/readiness for the admin dashboard (GET /api/admin/health). */
export interface SystemHealth {
  ready: boolean;
  checks: {
    database?: { ok: boolean; latencyMs?: number; error?: string };
    supabase?: {
      ok: boolean;
      configured: boolean;
      /** true = reachable, false = network/egress block, null = not configured. */
      reachable?: boolean | null;
      reason?: string;
      latencyMs?: number;
    };
    ai?: {
      ok: boolean;
      enabled: boolean;
      configured: boolean;
      /** true = reachable, false = network/egress block, null = nothing configured. */
      reachable?: boolean | null;
      /** Which provider answered the probe ('gemini' | 'openrouter'). */
      provider?: string;
      reason?: string;
      latencyMs?: number;
    };
  };
  metrics: {
    version: string;
    nodeVersion: string;
    uptimeSeconds: number;
    memory: { rssMb: number; heapUsedMb: number; heapTotalMb: number };
  };
  timestamp: string;
}

/** One entry in the audit trail (who did what). */
export interface AuditEntry {
  id: string;
  actorType: 'admin' | 'customer' | 'system' | string;
  actorId: string | null;
  actorLabel: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

/** One customer row in the admin customer table. */
export interface AdminCustomer {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  plan: string;
  planStatus: string;
  createdAt: string;
  accounts: number;
  posts: number;
}
