#!/usr/bin/env node
/**
 * Smoke-test R2 connectivity (put → head → get → delete).
 * Requires R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY in .env (from R2 API token, not cfat_*).
 */
import { r2, useLocalStorage, useR2Storage } from "../src/shared/config/env.js";
import * as objectStore from "../src/shared/storage/object-store.js";

const testKey = `raw/_healthcheck/${new Date().toISOString().slice(0, 10)}/ping.json`;

console.log("R2 config:", {
  bucket: r2.bucket,
  endpoint: r2.endpoint,
  accountId: r2.accountId ? `${r2.accountId.slice(0, 8)}…` : "(unset)",
  mode: useR2Storage() ? "r2" : "local",
});

if (useLocalStorage()) {
  console.error(
    "\nR2 S3 credentials missing. Set either:\n" +
      "  R2_API_TOKEN_ID + CLOUDFLARE_API_TOKEN (cfat_* secret), or\n" +
      "  R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY\n" +
      "See https://developers.cloudflare.com/r2/api/tokens/",
  );
  process.exit(1);
}

const payload = { ok: true, at: new Date().toISOString() };
await objectStore.putObject(testKey, payload);
const exists = await objectStore.headObject(testKey);
const read = await objectStore.getObject(testKey);

console.log(JSON.stringify({ ok: true, testKey, exists, read }, null, 2));
