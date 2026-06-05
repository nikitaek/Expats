#!/usr/bin/env node
import { runSchedulerTick } from "../src/services/scheduler/index.js";

const result = await runSchedulerTick();
console.log(JSON.stringify({ ok: true, ...result }, null, 2));
