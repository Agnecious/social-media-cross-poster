// Throwaway diagnostic: verifies SMTP login against backend/.env, printing a
// clear reason. Loads .env by absolute path so it works regardless of cwd.
// Run:  node scripts/mailcheck.js
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const { verifyMail } = await import('../src/services/MailService.js');
const res = await verifyMail();
console.log('MAILCHECK ' + JSON.stringify(res));
process.exit(res.ok ? 0 : 1);
