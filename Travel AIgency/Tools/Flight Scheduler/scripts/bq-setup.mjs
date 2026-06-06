#!/usr/bin/env node
import { setupBigQuery } from "../src/shared/storage/bigquery-client.js";

const result = await setupBigQuery();
console.log(JSON.stringify({ ok: true, ...result }, null, 2));
