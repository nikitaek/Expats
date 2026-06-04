import "dotenv/config";
import express from "express";
import path from "node:path";
import { paths, port } from "./config.js";
import apiRouter from "./routes/api.js";

const app = express();
app.use(express.json());
app.use("/api", apiRouter);
app.use(express.static(paths.public));

app.get("*", (_req, res) => {
  res.sendFile(path.join(paths.public, "index.html"));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

app.listen(port, () => {
  console.log(`Flight Scheduler running at http://localhost:${port}`);
});
