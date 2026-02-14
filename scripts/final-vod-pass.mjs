#!/usr/bin/env node

import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
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
  node scripts/final-vod-pass.mjs --url <youtube-url> [options]

Required:
  --url                   YouTube VOD or previous live URL

Options:
  --out-dir               Output directory (default: transcripts/vod-final-<timestamp>)
  --language              Language hint, e.g. en
  --segment-seconds       Segment length (default: 60)
  --transcribe-model      Transcription model (optional override)
  --summary-model         Summary model (optional override)
  --summary-chunk-chars   Summary chunk size (default: 12000)
  --schedule-url          Schedule URL for speaker matching (optional)
  --schedule-json         Local schedule JSON file (optional)
  --schedule-tz           Schedule timezone (default: America/Mexico_City)
  --event-date            Event date in schedule timezone (YYYY-MM-DD)
  --glossary-file         One term per line
  --prompt-file           Extra transcription guidance
  --compare-transcript    Optional path to previous live transcript for drift checks

Environment:
  OPENAI_API_KEY          Required if OPENROUTER_API_KEY is not set
  OPENROUTER_API_KEY      Optional alternative to OPENAI_API_KEY
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

function cleanTranscriptText(raw) {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#"))
    .join("\n");
}

function toWords(raw) {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\u024f ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3);
}

function jaccardSimilarity(wordsA, wordsB) {
  const setA = new Set(wordsA);
  const setB = new Set(wordsB);
  if (setA.size === 0 && setB.size === 0) {
    return 1;
  }
  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) {
      intersection += 1;
    }
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
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

async function buildHumanReviewFile({
  outDir,
  vodTranscriptPath,
  compareTranscriptPath
}) {
  const reviewPath = path.join(outDir, "HUMAN_REVIEW_REQUIRED.md");
  const now = new Date().toISOString();
  const vodRaw = await readFile(vodTranscriptPath, "utf8");
  const vodText = cleanTranscriptText(vodRaw);
  const vodWords = toWords(vodText);

  let compareSection = "No comparison transcript provided.\n";
  if (compareTranscriptPath) {
    try {
      const baseRaw = await readFile(compareTranscriptPath, "utf8");
      const baseText = cleanTranscriptText(baseRaw);
      const baseWords = toWords(baseText);
      const similarity = jaccardSimilarity(vodWords, baseWords);

      compareSection = [
        `Comparison transcript: ${compareTranscriptPath}`,
        `VOD words: ${vodWords.length}`,
        `Live words: ${baseWords.length}`,
        `Vocabulary Jaccard similarity: ${(similarity * 100).toFixed(1)}%`,
        "",
        "Interpretation:",
        "- Low similarity can indicate major wording/content drift, language mismatch, or a failed pass.",
        "- This metric is only a warning signal. It is not proof of correctness."
      ].join("\n");
    } catch (error) {
      compareSection = `Comparison failed: ${String(error)}\n`;
    }
  }

  const body = `# HUMAN REVIEW REQUIRED

Generated: ${now}

Do not auto-publish from this folder. A human must verify the outputs first.

Final transcript path:
- ${vodTranscriptPath}

${compareSection}

## Mandatory checks

1. Verify names, numbers, dates, and quotes in summary against transcript.
2. Open \`summary/result.json\` and resolve all \`qa_flags\`.
3. Confirm the X drafts are factual and remove uncertain claims.
4. Spot-check at least 10 random transcript lines against source audio.
5. Approve manually before any posting.
`;

  await writeFile(reviewPath, body);
  return reviewPath;
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

  const outDir =
    args["out-dir"] || path.join("transcripts", `vod-final-${timestampSlug()}`);
  await mkdir(outDir, { recursive: true });

  const logPath = path.join(outDir, "vod-pass.log");
  const liveScriptPath = path.join(process.cwd(), "scripts", "live-transcribe.mjs");
  const summarizeScriptPath = path.join(process.cwd(), "scripts", "summarize-transcript.mjs");
  const transcriptPath = path.join(outDir, "transcript.txt");
  const summaryDir = path.join(outDir, "summary");

  await appendFile(logPath, `[${new Date().toISOString()}] Starting final VOD pass\n`);

  const transcribeArgs = [
    "--url",
    args.url,
    "--out-dir",
    outDir,
    "--segment-seconds",
    String(args["segment-seconds"] || 60)
  ];
  if (args["transcribe-model"]) {
    transcribeArgs.push("--model", args["transcribe-model"]);
  }
  if (args.language) {
    transcribeArgs.push("--language", args.language);
  }
  if (args["glossary-file"]) {
    transcribeArgs.push("--glossary-file", args["glossary-file"]);
  }
  if (args["prompt-file"]) {
    transcribeArgs.push("--prompt-file", args["prompt-file"]);
  }

  await runNodeScript(liveScriptPath, transcribeArgs);
  await appendFile(logPath, `[${new Date().toISOString()}] Transcription done\n`);

  const summaryArgs = [
    "--input",
    transcriptPath,
    "--out-dir",
    summaryDir,
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
  await appendFile(logPath, `[${new Date().toISOString()}] Summary done\n`);

  const reviewPath = await buildHumanReviewFile({
    outDir,
    vodTranscriptPath: transcriptPath,
    compareTranscriptPath: args["compare-transcript"] || ""
  });

  await appendFile(logPath, `[${new Date().toISOString()}] Human review file created\n`);
  console.log("Final VOD pass complete.");
  console.log(`- ${transcriptPath}`);
  console.log(`- ${summaryDir}/summary.md`);
  console.log(`- ${summaryDir}/x_post.txt`);
  console.log(`- ${summaryDir}/x_thread.txt`);
  console.log(`- ${reviewPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
