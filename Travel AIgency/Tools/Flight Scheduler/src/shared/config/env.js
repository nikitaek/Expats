import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../../..");

dotenv.config({ path: path.join(rootDir, ".env") });

export const paths = {
  root: rootDir,
  data: path.join(rootDir, "data"),
  seeds: path.join(rootDir, "data", "seeds"),
  config: path.join(rootDir, "data", "config"),
  jobs: path.join(rootDir, "data", "jobs"),
  localR2: path.join(rootDir, "data", "local-r2"),
  migrations: path.join(rootDir, "migrations"),
};

export const fr24 = {
  apiToken: process.env.FR24_API_TOKEN || "",
  requestDelayMs: Number(process.env.FR24_REQUEST_DELAY_MS || 3500),
  pageSize: Number(process.env.FR24_PAGE_SIZE || 2000),
};

/**
 * R2 S3 credentials: explicit R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY,
 * or derived from Cloudflare API token per
 * https://developers.cloudflare.com/r2/api/tokens/#get-s3-api-credentials-from-an-api-token
 *   Access Key ID = token id
 *   Secret Access Key = SHA-256(token value)
 */
function resolveR2S3Credentials() {
  if (process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY) {
    return {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    };
  }

  const tokenId =
    process.env.R2_API_TOKEN_ID || process.env.CLOUDFLARE_API_TOKEN_ID || "";
  const tokenValue = process.env.CLOUDFLARE_API_TOKEN || "";

  if (tokenId && tokenValue) {
    return {
      accessKeyId: tokenId,
      secretAccessKey: crypto
        .createHash("sha256")
        .update(tokenValue)
        .digest("hex"),
    };
  }

  return { accessKeyId: "", secretAccessKey: "" };
}

const r2S3 = resolveR2S3Credentials();

export const r2 = {
  accountId: process.env.R2_ACCOUNT_ID || "",
  accessKeyId: r2S3.accessKeyId,
  secretAccessKey: r2S3.secretAccessKey,
  bucket: process.env.R2_BUCKET || "tour-aigency-flights",
  endpoint:
    process.env.R2_ENDPOINT ||
    (process.env.R2_ACCOUNT_ID
      ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
      : ""),
};

export const bigquery = {
  project: process.env.BIGQUERY_PROJECT || "",
  dataset: process.env.BIGQUERY_DATASET || "vn_flights",
};

export function requireFr24Token() {
  if (!fr24.apiToken) {
    throw new Error("FR24_API_TOKEN is not set in .env");
  }
}

/** Local filesystem unless R2 S3 credentials are fully configured. */
export function useLocalStorage() {
  return !(r2.accountId && r2.accessKeyId && r2.secretAccessKey);
}

export function useR2Storage() {
  return !useLocalStorage();
}
