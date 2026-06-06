import path from "node:path";
import { paths } from "../config/env.js";
import { readJson, writeJson } from "./fs-json.js";

export function jobManifestPath(job) {
  const day = job.startedAt?.slice(0, 10) || new Date().toISOString().slice(0, 10);
  return path.join(paths.jobs, day, `${job.jobId}.json`);
}

export async function saveJobManifest(job) {
  const filePath = jobManifestPath(job);
  await writeJson(filePath, job);
  return filePath;
}

export async function loadJobManifest(jobId, day) {
  const filePath = path.join(paths.jobs, day, `${jobId}.json`);
  return readJson(filePath, null);
}

export async function listJobManifests({ sinceDay } = {}) {
  const fs = await import("node:fs/promises");
  const jobs = [];
  let days;
  try {
    days = await fs.readdir(paths.jobs);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  for (const day of days.sort()) {
    if (sinceDay && day < sinceDay) continue;
    const dayDir = path.join(paths.jobs, day);
    const files = await fs.readdir(dayDir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const job = await readJson(path.join(dayDir, file), null);
      if (job) jobs.push(job);
    }
  }
  return jobs;
}
