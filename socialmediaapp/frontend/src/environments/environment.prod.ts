/**
 * Production config (used by Docker/nginx builds).
 * Uses a relative '/api' path so nginx can proxy it to the backend container.
 */
export const environment = {
  production: true,
  apiBaseUrl: '/api',
  // Set these to your PRODUCTION Supabase project's values at deploy time.
  supabaseUrl: 'https://dsoiwkmixvvmyptnulns.supabase.co',
  supabaseAnonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRzb2l3a21peHZ2bXlwdG51bG5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwNTg3MDYsImV4cCI6MjEwNDYzNDcwNn0.MQ8WG9-gYRv0VzkZzScvZ_L0x888Q4QisDfaULTF8Jg',
};
