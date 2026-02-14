#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
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
  node scripts/live-status.mjs [--watch] [--base-dir transcripts]

Options:
  --watch              Refresh every 5 seconds
  --base-dir           Root directory for transcript runs (default: transcripts)
`);
}

async function latestRunDir(baseDir) {
  const entries = await readdir(baseDir, { withFileTypes: true });
  const liveDirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("live-"))
    .map((entry) => path.join(baseDir, entry.name));
  if (liveDirs.length === 0) {
    return "";
  }

  const withMtime = await Promise.all(
    liveDirs.map(async (dir) => {
      const s = await stat(dir);
      return { dir, mtimeMs: s.mtimeMs };
    })
  );
  withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return withMtime[0].dir;
}

function tailLines(text, count) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  return lines.slice(-count);
}

async function render(baseDir) {
  const latest = await latestRunDir(baseDir);
  if (!latest) {
    console.log(`No live runs found under ${baseDir}`);
    return;
  }

  const transcriptPath = path.join(latest, "transcript.txt");
  const segmentsPath = path.join(latest, "segments.jsonl");
  const summaryPath = path.join(latest, "summary", "summary.md");
  const xPostPath = path.join(latest, "summary", "x_post.txt");

  const transcriptRaw = await readFile(transcriptPath, "utf8").catch(() => "");
  const segmentsRaw = await readFile(segmentsPath, "utf8").catch(() => "");
  const summaryRaw = await readFile(summaryPath, "utf8").catch(() => "");
  const xPostRaw = await readFile(xPostPath, "utf8").catch(() => "");

  const transcriptLines = transcriptRaw
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .filter((line) => line.startsWith("["));

  const segmentEntries = segmentsRaw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const errorEntries = segmentEntries.filter((entry) => entry.error);
  const lastError = errorEntries.length > 0 ? errorEntries[errorEntries.length - 1] : null;

  console.log(`Run: ${latest}`);
  console.log(`Transcribed lines: ${transcriptLines.length}`);
  console.log(`Segment log entries: ${segmentEntries.length}`);
  console.log(`Errors: ${errorEntries.length}`);
  if (transcriptLines.length > 0) {
    console.log(`Last transcript: ${transcriptLines[transcriptLines.length - 1]}`);
  }
  if (lastError) {
    console.log(`Last error: [${lastError.segment}] ${lastError.error}`);
  }
  console.log(`Summary ready: ${summaryRaw.trim() ? "yes" : "no"}`);
  if (xPostRaw.trim()) {
    console.log(`X draft: ${xPostRaw.trim()}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help === "true") {
    usage();
    process.exit(0);
  }
  const baseDir = args["base-dir"] || "transcripts";
  const watch = args.watch === "true";

  if (!watch) {
    await render(baseDir);
    return;
  }

  while (true) {
    process.stdout.write("\x1Bc");
    console.log(new Date().toISOString());
    console.log("");
    try {
      await render(baseDir);
    } catch (error) {
      console.log(`Status error: ${String(error)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
