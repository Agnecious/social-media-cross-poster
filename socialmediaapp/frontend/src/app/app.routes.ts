/**
 * Application routes. Compose is the default screen. The Administrator route is
 * protected by `adminGuard`, which redirects to the login screen when the user
 * isn't authenticated. See ARCHITECTURE.md §8.
 */
import { Routes } from '@angular/router';
import { LandingComponent } from './features/landing/landing.component';
import { ComposeComponent } from './features/compose/compose.component';
import { ConnectionsComponent } from './features/connections/connections.component';
import { AnalyticsComponent } from './features/analytics/analytics.component';
import { AiAssistantComponent } from './features/ai/ai-assistant.component';
import { AdminComponent } from './features/admin/admin.component';
import { AdminDashboardComponent } from './features/admin/admin-dashboard.component';
import { AdminLoginComponent } from './features/admin/admin-login.component';
import { CustomerAuthComponent } from './features/customer/customer-auth.component';
import { ResetPasswordComponent } from './features/customer/reset-password.component';
import { BillingComponent } from './features/billing/billing.component';
import { MockCheckoutComponent } from './features/billing/mock-checkout.component';
import { ProfileComponent } from './features/profile/profile.component';
import { SupportComponent } from './features/support/support.component';
import { adminGuard } from './core/guards/admin.guard';
import { customerGuard } from './core/guards/customer.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', component: LandingComponent },
  { path: 'login', component: CustomerAuthComponent },
  { path: 'reset-password', component: ResetPasswordComponent },
  // App screens now require a signed-in customer.
  { path: 'compose', component: ComposeComponent, canActivate: [customerGuard] },
  { path: 'connections', component: ConnectionsComponent, canActivate: [customerGuard] },
  { path: 'analytics', component: AnalyticsComponent, canActivate: [customerGuard] },
  { path: 'ai', component: AiAssistantComponent, canActivate: [customerGuard] },
  { path: 'billing', component: BillingComponent, canActivate: [customerGuard] },
  { path: 'mock-checkout', component: MockCheckoutComponent, canActivate: [customerGuard] },
  { path: 'profile', component: ProfileComponent, canActivate: [customerGuard] },
  { path: 'support', component: SupportComponent, canActivate: [customerGuard] },
  { path: 'admin-login', component: AdminLoginComponent },
  { path: 'admin', component: AdminComponent, canActivate: [adminGuard] },
  { path: 'admin-dashboard', component: AdminDashboardComponent, canActivate: [adminGuard] },
  { path: '**', redirectTo: '' },
];
