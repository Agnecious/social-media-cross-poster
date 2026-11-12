/**
 * Mobile / LAN dev configuration.
 *
 * Used when testing from a phone on the same Wi-Fi as your dev machine. The
 * key difference from environment.ts is apiBaseUrl is RELATIVE ('/api'): the
 * phone loads the app from http://<your-machine-ip>:4200 and all API calls go
 * to that same origin, where `ng serve` proxies them to the backend on :3000
 * (see proxy.conf.json). This avoids the "localhost = the phone itself" trap.
 *
 * Run with:  npm run start:mobile   (serves on 0.0.0.0 with the proxy)
 * Then open  http://<your-machine-ip>:4200  on the phone.
 */
export const environment = {
  production: false,
  // Relative base — resolved against whatever host the phone used, then
  // proxied to the backend by the dev server.
  apiBaseUrl: '/api',
  supabaseUrl: 'https://dsoiwkmixvvmyptnulns.supabase.co',
  supabaseAnonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRzb2l3a21peHZ2bXlwdG51bG5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwNTg3MDYsImV4cCI6MjEwNDYzNDcwNn0.MQ8WG9-gYRv0VzkZzScvZ_L0x888Q4QisDfaULTF8Jg',
};
