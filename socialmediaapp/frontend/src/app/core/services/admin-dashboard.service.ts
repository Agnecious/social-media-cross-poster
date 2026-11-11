import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AdminCustomer, AuditEntry, DashboardStats, SystemHealth } from '../models/admin-dashboard.model';

/**
 * AdminDashboardService — owner-only business data. The admin JWT is attached
 * by the admin-auth interceptor (these URLs contain '/admin/').
 */
@Injectable({ providedIn: 'root' })
export class AdminDashboardService {
  private readonly http = inject(HttpClient);

  stats(): Promise<DashboardStats> {
    return firstValueFrom(
      this.http.get<DashboardStats>(`${environment.apiBaseUrl}/admin/dashboard`)
    );
  }

  customers(): Promise<AdminCustomer[]> {
    return firstValueFrom(
      this.http.get<{ customers: AdminCustomer[] }>(`${environment.apiBaseUrl}/admin/customers`)
    ).then((r) => r.customers);
  }

  setPlan(customerId: string, plan: string): Promise<{ id: string; plan: string }> {
    return firstValueFrom(
      this.http.patch<{ id: string; plan: string }>(
        `${environment.apiBaseUrl}/admin/customers/${customerId}/plan`,
        { plan }
      )
    );
  }

  /** Create a new customer (Supabase login + Customer row). */
  addCustomer(input: {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    plan?: string;
  }): Promise<AdminCustomer> {
    return firstValueFrom(
      this.http.post<AdminCustomer>(`${environment.apiBaseUrl}/admin/customers`, input)
    );
  }

  /** Delete a customer (Customer row + best-effort Supabase login). */
  deleteCustomer(customerId: string): Promise<{ ok: boolean; authDeleted: boolean }> {
    return firstValueFrom(
      this.http.delete<{ ok: boolean; authDeleted: boolean }>(
        `${environment.apiBaseUrl}/admin/customers/${customerId}`
      )
    );
  }

  /** Recent audit-trail entries (who did what). */
  audit(limit = 100): Promise<AuditEntry[]> {
    return firstValueFrom(
      this.http.get<{ entries: AuditEntry[] }>(
        `${environment.apiBaseUrl}/admin/audit?limit=${limit}`
      )
    ).then((r) => r.entries);
  }

  /** System health/readiness + runtime metrics. */
  health(): Promise<SystemHealth> {
    return firstValueFrom(
      this.http.get<SystemHealth>(`${environment.apiBaseUrl}/admin/health`)
    );
  }
}
