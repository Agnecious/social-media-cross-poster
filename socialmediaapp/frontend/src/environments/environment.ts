/**
 * Frontend configuration. The API base URL is the only thing the UI needs to
 * know about the backend. Everything platform-specific comes from the backend
 * (which reads it from env), so the UI stays generic and configurable.
 */
export const environment = {
  production: false,
  // Dev: talk directly to the backend dev server.
  // In Docker, nginx serves the app and proxies `/api` to the backend, so a
  // production build should use the relative '/api' (see environment.prod.ts).
  apiBaseUrl: 'http://localhost:3000/api',
  // Supabase (customer auth). The anon key is safe to expose in frontend code
  // — that's its purpose. The service_role key stays backend-only.
  supabaseUrl: 'https://dsoiwkmixvvmyptnulns.supabase.co',
  supabaseAnonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRzb2l3a21peHZ2bXlwdG51bG5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwNTg3MDYsImV4cCI6MjEwNDYzNDcwNn0.MQ8WG9-gYRv0VzkZzScvZ_L0x888Q4QisDfaULTF8Jg',
};
