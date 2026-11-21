import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
const target = resolve(process.argv[2] || ".env");
writeFileSync(target, `SIG_DREAM_ACCESS_USER=sig-dream\nSIG_DREAM_ACCESS_PASSWORD=${randomBytes(32).toString("base64url")}\nSIG_DREAM_SECURE_COOKIE=0\n`, { mode: 0o600, flag: "wx" });
console.log(`Created private access settings at ${target}. Read the file locally for the password; it is not printed or committed. Set SIG_DREAM_SECURE_COOKIE=1 behind HTTPS.`);
