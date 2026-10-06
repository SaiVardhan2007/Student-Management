// Loads .env.local (then .env) for CLI scripts — `next` does this itself for the web app.
import fs from 'fs';

for (const file of ['.env.local', '.env']) {
  if (fs.existsSync(file)) process.loadEnvFile(file);
}
