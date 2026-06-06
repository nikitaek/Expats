import fs from "node:fs/promises";
import path from "node:path";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { paths, r2, useLocalStorage } from "../config/env.js";

let s3Client;

function getS3() {
  if (!s3Client && !useLocalStorage()) {
    s3Client = new S3Client({
      region: "auto",
      endpoint: r2.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: r2.accessKeyId,
        secretAccessKey: r2.secretAccessKey,
      },
    });
  }
  return s3Client;
}

function localPath(key) {
  return path.join(paths.localR2, key);
}

export async function headObject(key) {
  if (useLocalStorage()) {
    try {
      await fs.access(localPath(key));
      return true;
    } catch {
      return false;
    }
  }
  try {
    await getS3().send(
      new HeadObjectCommand({ Bucket: r2.bucket, Key: key }),
    );
    return true;
  } catch (err) {
    if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw err;
  }
}

export async function getObject(key) {
  if (useLocalStorage()) {
    const text = await fs.readFile(localPath(key), "utf8");
    return JSON.parse(text);
  }
  const res = await getS3().send(
    new GetObjectCommand({ Bucket: r2.bucket, Key: key }),
  );
  const text = await res.Body.transformToString();
  return JSON.parse(text);
}

export async function getObjectText(key) {
  if (useLocalStorage()) {
    return fs.readFile(localPath(key), "utf8");
  }
  const res = await getS3().send(
    new GetObjectCommand({ Bucket: r2.bucket, Key: key }),
  );
  return res.Body.transformToString();
}

export async function putObject(key, data) {
  const body =
    typeof data === "string" ? data : `${JSON.stringify(data, null, 2)}\n`;

  if (useLocalStorage()) {
    const filePath = localPath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, body, "utf8");
    return;
  }

  await getS3().send(
    new PutObjectCommand({
      Bucket: r2.bucket,
      Key: key,
      Body: body,
      ContentType: "application/json",
    }),
  );
}

/**
 * List object keys under a prefix (local or R2).
 * @param {string} prefix
 * @returns {Promise<string[]>}
 */
export async function listPrefix(prefix) {
  const normalized = prefix.endsWith("/") ? prefix : `${prefix}/`;

  if (useLocalStorage()) {
    const base = localPath(normalized);
    const keys = [];

    async function walk(dir, rel) {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (err) {
        if (err.code === "ENOENT") return;
        throw err;
      }
      for (const ent of entries) {
        const childRel = rel ? `${rel}/${ent.name}` : ent.name;
        const childPath = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          await walk(childPath, childRel);
        } else {
          keys.push(`${normalized}${childRel}`);
        }
      }
    }

    await walk(base, "");
    return keys;
  }

  const keys = [];
  let token;
  do {
    const res = await getS3().send(
      new ListObjectsV2Command({
        Bucket: r2.bucket,
        Prefix: normalized,
        ContinuationToken: token,
      }),
    );
    for (const obj of res.Contents || []) {
      if (obj.Key) keys.push(obj.Key);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);

  return keys;
}
