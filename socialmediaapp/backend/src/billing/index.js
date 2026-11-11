import { billingConfig } from '../config/index.js';
import { MockBillingProvider } from './MockBillingProvider.js';
import { PeachBillingProvider } from './PeachBillingProvider.js';
import { PaystackBillingProvider } from './PaystackBillingProvider.js';

/**
 * Billing provider factory. Resolves the active BillingProvider from
 * BILLING_PROVIDER (default 'mock'). Computed per call so config changes take
 * effect without a code change.
 *
 * @returns {import('./BillingProvider.js').BillingProvider}
 */
export function getBillingProvider() {
  const cfg = billingConfig();
  // Pass the webhook secret + provider-specific creds down to the adapter.
  const providerCfg = {
    webhookSecret: cfg.webhookSecret,
    peach: cfg.peach,
    paystack: cfg.paystack,
  };
  switch (cfg.provider) {
    case 'paystack':
      return new PaystackBillingProvider(providerCfg);
    case 'peach':
      return new PeachBillingProvider(providerCfg);
    case 'mock':
    default:
      return new MockBillingProvider(providerCfg);
  }
}

/** Whether billing is switched on (BILLING_ENABLED=true). */
export function isBillingEnabled() {
  return billingConfig().enabled;
}
