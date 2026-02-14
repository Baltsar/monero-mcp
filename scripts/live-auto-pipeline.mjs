#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access, mkdir, stat, appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = "true";
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function usage() {
  console.log(`Usage:
  node scripts/live-auto-pipeline.mjs --url <youtube-url> [options]

Required:
  --url                     YouTube live URL

Options:
  --out-dir                 Output directory (default: transcripts/live-<timestamp>)
  --summary-every-minutes   Rebuild summary cadence (default: 10)
  --summary-model           Summary model (optional override)
  --summary-chunk-chars     Summary chunk size (default: 12000)
  --schedule-url            Schedule URL for speaker matching (optional)
  --schedule-json           Local schedule JSON file (optional)
  --schedule-tz             Schedule timezone (default: America/Mexico_City)
  --event-date              Event date in schedule timezone (YYYY-MM-DD)
  --transcribe-model        Transcription model (optional override)
  --language                Language hint, e.g. en
  --segment-seconds         Audio chunk length in seconds (default: 75)
  --settle-ms               Wait before transcribing new chunks (default: 12000)
  --idle-stop-minutes       Auto-stop if no new audio progress for N minutes (default: 35, 0=disable)
  --glossary-file           One term per line
  --prompt-file             Extra transcription guidance
  --max-segments            Stop after N segments (testing)

Environment:
  OPENAI_API_KEY            Required if OPENROUTER_API_KEY is not set
  OPENROUTER_API_KEY        Optional alternative to OPENAI_API_KEY
`);
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function runNodeScript(scriptPath, scriptArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...scriptArgs], {
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${path.basename(scriptPath)} failed with code ${code}`));
      }
    });
  });
}

function isEnoent(error) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function assertKeyNotPlaceholder(key, envName) {
  const trimmed = String(key || "").trim();
  if (!trimmed) {
    return;
  }
  if (trimmed === "YOUR_KEY" || trimmed.includes("YOUR_KEY")) {
    throw new Error(
      `${envName} is set to placeholder value 'YOUR_KEY'. Export your real key and restart.`
    );
  }
}

function assertAnyApiKeyLooksValid() {
  const openrouterKey = String(process.env.OPENROUTER_API_KEY || "").trim();
  const openaiKey = String(process.env.OPENAI_API_KEY || "").trim();
  assertKeyNotPlaceholder(openrouterKey, "OPENROUTER_API_KEY");
  assertKeyNotPlaceholder(openaiKey, "OPENAI_API_KEY");
  if (!openrouterKey && !openaiKey) {
    throw new Error("Set OPENROUTER_API_KEY or OPENAI_API_KEY before running.");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help === "true") {
    usage();
    process.exit(0);
  }
  if (!args.url) {
    usage();
    process.exit(1);
  }
  assertAnyApiKeyLooksValid();

  const summaryEveryMinutes = Number(args["summary-every-minutes"] || 10);
  if (!Number.isFinite(summaryEveryMinutes) || summaryEveryMinutes < 1) {
    throw new Error("--summary-every-minutes must be a number >= 1");
  }

  const outDir = args["out-dir"] || path.join("transcripts", `live-${timestampSlug()}`);
  const transcriptPath = path.join(outDir, "transcript.txt");
  const summaryOutDir = path.join(outDir, "summary");
  const pipelineLogPath = path.join(outDir, "pipeline.log");
  await mkdir(outDir, { recursive: true });

  const liveScriptPath = path.join(process.cwd(), "scripts", "live-transcribe.mjs");
  const summarizeScriptPath = path.join(process.cwd(), "scripts", "summarize-transcript.mjs");

  const liveArgs = [
    liveScriptPath,
    "--url",
    args.url,
    "--out-dir",
    outDir,
    "--segment-seconds",
    String(args["segment-seconds"] || 75),
    "--settle-ms",
    String(args["settle-ms"] || 12000),
    "--idle-stop-minutes",
    String(args["idle-stop-minutes"] || 35)
  ];
  if (args["transcribe-model"]) {
    liveArgs.push("--model", args["transcribe-model"]);
  }
  if (args.language) {
    liveArgs.push("--language", args.language);
  }
  if (args["glossary-file"]) {
    liveArgs.push("--glossary-file", args["glossary-file"]);
  }
  if (args["prompt-file"]) {
    liveArgs.push("--prompt-file", args["prompt-file"]);
  }
  if (args["max-segments"]) {
    liveArgs.push("--max-segments", args["max-segments"]);
  }

  await appendFile(
    pipelineLogPath,
    `[${new Date().toISOString()}] Starting auto pipeline in ${outDir}\n`
  );
  console.log(`Output directory: ${outDir}`);

  const liveChild = spawn(process.execPath, liveArgs, { stdio: "inherit" });
  let liveExited = false;
  let liveExitCode = 0;
  liveChild.on("close", (code) => {
    liveExited = true;
    liveExitCode = code ?? 0;
  });

  let summaryRunning = false;
  let summaryQueued = false;
  let lastFingerprint = "";

  async function buildSummary(force = false) {
    if (summaryRunning) {
      summaryQueued = true;
      return;
    }
    summaryRunning = true;
    try {
      await access(transcriptPath);
      const transcriptStats = await stat(transcriptPath);
      const fingerprint = `${transcriptStats.size}:${Math.floor(transcriptStats.mtimeMs)}`;
      if (!force && fingerprint === lastFingerprint) {
        return;
      }
      const transcriptRaw = await readFile(transcriptPath, "utf8");
      if (!/^\[[^\]]+\]\s+\[[^\]]+\]/m.test(transcriptRaw)) {
        return;
      }

      await appendFile(
        pipelineLogPath,
        `[${new Date().toISOString()}] Running summary refresh (force=${String(force)})\n`
      );

      const summaryArgs = [
        "--input",
        transcriptPath,
        "--out-dir",
        summaryOutDir,
        "--chunk-chars",
        String(args["summary-chunk-chars"] || 12000)
      ];
      if (args["schedule-url"]) {
        summaryArgs.push("--schedule-url", args["schedule-url"]);
      }
      if (args["schedule-json"]) {
        summaryArgs.push("--schedule-json", args["schedule-json"]);
      }
      summaryArgs.push("--schedule-tz", String(args["schedule-tz"] || "America/Mexico_City"));
      if (args["event-date"]) {
        summaryArgs.push("--event-date", args["event-date"]);
      }
      if (args["summary-model"]) {
        summaryArgs.push("--model", args["summary-model"]);
      }
      await runNodeScript(summarizeScriptPath, summaryArgs);
      lastFingerprint = fingerprint;
    } catch (error) {
      if (isEnoent(error)) {
        return;
      }
      await appendFile(
        pipelineLogPath,
        `[${new Date().toISOString()}] Summary refresh error: ${String(error)}\n`
      );
      console.error(`Summary refresh failed: ${String(error)}`);
    } finally {
      summaryRunning = false;
      if (summaryQueued) {
        summaryQueued = false;
        void buildSummary(true);
      }
    }
  }

  // Trigger early summary attempts so output appears quickly after first transcript lines.
  void buildSummary(false);
  const warmupTimer = setInterval(() => {
    if (lastFingerprint) {
      clearInterval(warmupTimer);
      return;
    }
    void buildSummary(false);
  }, 30_000);

  const intervalMs = summaryEveryMinutes * 60_000;
  const timer = setInterval(() => {
    void buildSummary(false);
  }, intervalMs);

  let stopping = false;
  function stopPipeline(signal) {
    if (stopping) {
      return;
    }
    stopping = true;
    clearInterval(warmupTimer);
    clearInterval(timer);
    liveChild.kill(signal);
  }
  process.on("SIGINT", () => stopPipeline("SIGINT"));
  process.on("SIGTERM", () => stopPipeline("SIGTERM"));

  while (!liveExited) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  clearInterval(warmupTimer);
  clearInterval(timer);
  await buildSummary(true);

  await appendFile(
    pipelineLogPath,
    `[${new Date().toISOString()}] Pipeline ended. liveExitCode=${liveExitCode}\n`
  );

  if (liveExitCode !== 0 && !stopping) {
    throw new Error(`live-transcribe exited with code ${liveExitCode}`);
  }

  console.log(`Done. Main outputs:`);
  console.log(`- ${transcriptPath}`);
  console.log(`- ${summaryOutDir}/summary.md`);
  console.log(`- ${summaryOutDir}/x_post.txt`);
  console.log(`- ${summaryOutDir}/x_thread.txt`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
