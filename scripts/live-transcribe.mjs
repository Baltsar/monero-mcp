#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, appendFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";

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
  node scripts/live-transcribe.mjs --url <youtube-url> [options]

Required:
  --url               YouTube live URL (or VOD URL)

Options:
  --out-dir           Output directory (default: transcripts/live-<timestamp>)
  --segment-seconds   Audio chunk length in seconds (default: 75)
  --poll-ms           Poll interval for new chunks (default: 2000)
  --settle-ms         Wait this long before processing a new chunk (default: 12000)
  --idle-stop-minutes Auto-stop if no new audio progress for N minutes (default: 35, 0=disable)
  --model             Transcription model (default: provider-specific)
  --language          Language hint, e.g. en
  --prompt-file       File containing custom transcription guidance
  --glossary-file     File with one key term per line
  --max-segments      Stop after N segments (for testing)
  --audio-url         Optional direct audio URL (skip yt-dlp resolution)

Environment:
  OPENAI_API_KEY      Required if OPENROUTER_API_KEY is not set
  OPENROUTER_API_KEY  Optional alternative to OPENAI_API_KEY
  OPENROUTER_BASE_URL Optional (default: https://openrouter.ai/api/v1)
  OPENROUTER_CHAT_AUDIO_MODEL Optional fallback model (default: openai/gpt-audio-mini)
`);
}

function assertCommandExists(command) {
  const out = spawnSync("which", [command], { encoding: "utf8" });
  if (out.status !== 0) {
    throw new Error(`Missing required command: ${command}`);
  }
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function normalizeText(text) {
  return text.replace(/\s+/g, " ").trim();
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

function resolveApiCredentials() {
  const openrouterKey = String(process.env.OPENROUTER_API_KEY || "").trim();
  const openaiKey = String(process.env.OPENAI_API_KEY || "").trim();
  assertKeyNotPlaceholder(openrouterKey, "OPENROUTER_API_KEY");
  assertKeyNotPlaceholder(openaiKey, "OPENAI_API_KEY");

  if (openrouterKey) {
    return {
      provider: "openrouter",
      apiKey: openrouterKey,
      baseUrl: String(process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1")
    };
  }
  if (openaiKey) {
    return {
      provider: "openai",
      apiKey: openaiKey,
      baseUrl: String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1")
    };
  }
  throw new Error("Set OPENROUTER_API_KEY or OPENAI_API_KEY before running.");
}

function extractContentText(content) {
  if (typeof content === "string") {
    return normalizeText(content);
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts = [];
  for (const item of content) {
    if (typeof item === "string") {
      parts.push(item);
      continue;
    }
    if (!item || typeof item !== "object") {
      continue;
    }
    if (typeof item.text === "string") {
      parts.push(item.text);
      continue;
    }
    if (typeof item.output_text === "string") {
      parts.push(item.output_text);
    }
  }
  return normalizeText(parts.join(" "));
}

function looksLikeNonTranscript(text) {
  const lowered = String(text || "").toLowerCase();
  if (!lowered) {
    return true;
  }
  const patterns = [
    "can't hear",
    "cannot hear",
    "can't process audio",
    "cannot process audio",
    "provide a text description",
    "i'm sorry, but i can't"
  ];
  return patterns.some((p) => lowered.includes(p));
}

async function loadOptionalText(filePath) {
  if (!filePath) {
    return "";
  }
  try {
    return (await readFile(filePath, "utf8")).trim();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error(
        `Optional file not found: ${filePath}. Create it, or remove the corresponding flag.`
      );
    }
    throw error;
  }
}

async function buildPrompt({ promptFile, glossaryFile }) {
  const sections = [];
  const customPrompt = await loadOptionalText(promptFile);
  if (customPrompt) {
    sections.push(customPrompt);
  }

  if (glossaryFile) {
    const glossaryRaw = await loadOptionalText(glossaryFile);
    const terms = glossaryRaw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    if (terms.length > 0) {
      sections.push(
        `Use the exact spelling for these terms when they appear: ${terms.join(", ")}.`
      );
    }
  }

  return sections.join("\n\n").trim();
}

function resolveAudioUrl(url) {
  const attempts = [
    ["-g", "-f", "bestaudio/best", url],
    ["-g", "-f", "ba/b", url],
    ["-g", "-f", "best", url],
    ["-g", url]
  ];
  const errors = [];

  for (const args of attempts) {
    const out = spawnSync("yt-dlp", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });

    if (out.status !== 0) {
      const stderr = (out.stderr || "").trim();
      errors.push(stderr || `yt-dlp exited with status ${String(out.status)}`);
      continue;
    }

    const lines = (out.stdout || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      errors.push("yt-dlp returned empty stdout");
      continue;
    }

    // If yt-dlp returns multiple URLs, prefer the last one (often the audio URL).
    return lines[lines.length - 1];
  }

  throw new Error(
    `yt-dlp failed to resolve stream URL after fallback attempts. Last errors: ${errors
      .slice(-2)
      .join(" | ")}`
  );
}

async function transcribeChunk({
  filePath,
  model,
  language,
  prompt,
  api,
  retries = 3
}) {
  const buffer = await readFile(filePath);
  const fileName = path.basename(filePath);

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      if (api.provider === "openrouter") {
        // Prefer OpenAI-compatible transcription endpoint; fallback to chat+audio.
        try {
          const formData = new FormData();
          formData.append("file", new Blob([buffer], { type: "audio/wav" }), fileName);
          formData.append("model", model);
          if (language) {
            formData.append("language", language);
          }
          if (prompt) {
            formData.append("prompt", prompt);
          }

          const response = await fetch(`${api.baseUrl}/audio/transcriptions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${api.apiKey}` },
            body: formData
          });

          if (!response.ok) {
            const body = await response.text();
            throw new Error(`audio/transcriptions HTTP ${response.status}: ${body}`);
          }

          const json = await response.json();
          const text = typeof json.text === "string" ? normalizeText(json.text) : "";
          if (looksLikeNonTranscript(text)) {
            throw new Error("audio/transcriptions returned empty/non-transcript output");
          }
          return { text, raw: json };
        } catch (audioApiError) {
          const fallbackModel =
            String(process.env.OPENROUTER_CHAT_AUDIO_MODEL || "").trim() || "openai/gpt-audio-mini";
          const instructions = [
            "Transcribe this audio as accurately as possible.",
            "Output only the transcript text.",
            "Do not add commentary or metadata."
          ];
          if (language) {
            instructions.push(`The likely spoken language is: ${language}.`);
          }
          if (prompt) {
            instructions.push(prompt);
          }

          const response = await fetch(`${api.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${api.apiKey}`
            },
            body: JSON.stringify({
              model: fallbackModel,
              temperature: 0,
              messages: [
                {
                  role: "user",
                  content: [
                    { type: "text", text: instructions.join("\n") },
                    {
                      type: "input_audio",
                      input_audio: {
                        data: buffer.toString("base64"),
                        format: "wav"
                      }
                    }
                  ]
                }
              ]
            })
          });

          if (!response.ok) {
            const body = await response.text();
            throw new Error(
              `OpenRouter transcription failed: audio_api=${String(
                audioApiError
              )}; chat_fallback_http_${response.status}=${body}`
            );
          }

          const json = await response.json();
          const text = extractContentText(json?.choices?.[0]?.message?.content);
          if (looksLikeNonTranscript(text)) {
            throw new Error(
              `OpenRouter transcription failed: audio_api=${String(
                audioApiError
              )}; chat_fallback_non_transcript=${text}`
            );
          }
          return { text, raw: json };
        }
      }

      const formData = new FormData();
      formData.append("file", new Blob([buffer], { type: "audio/wav" }), fileName);
      formData.append("model", model);
      if (language) {
        formData.append("language", language);
      }
      if (prompt) {
        formData.append("prompt", prompt);
      }

      const response = await fetch(`${api.baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${api.apiKey}` },
        body: formData
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`audio/transcriptions HTTP ${response.status}: ${body}`);
      }

      const json = await response.json();
      const text = typeof json.text === "string" ? normalizeText(json.text) : "";
      if (looksLikeNonTranscript(text)) {
        throw new Error("audio/transcriptions returned empty/non-transcript output");
      }
      return { text, raw: json };
    } catch (error) {
      if (attempt >= retries) {
        throw error;
      }
      await sleep(1500 * attempt);
    }
  }

  throw new Error("Exhausted retries while transcribing chunk");
}

async function waitForStableFile(filePath, checks = 2, delayMs = 1200) {
  let lastSize = -1;
  for (let i = 0; i < checks; i += 1) {
    const s = await stat(filePath);
    if (s.size <= 0) {
      return false;
    }
    if (lastSize >= 0 && s.size !== lastSize) {
      return false;
    }
    lastSize = s.size;
    if (i < checks - 1) {
      await sleep(delayMs);
    }
  }
  return true;
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

  const api = resolveApiCredentials();

  assertCommandExists("ffmpeg");
  if (!args["audio-url"]) {
    assertCommandExists("yt-dlp");
  }

  const segmentSeconds = Number(args["segment-seconds"] || 75);
  const pollMs = Number(args["poll-ms"] || 2000);
  const settleMs = Number(args["settle-ms"] || 12000);
  const idleStopMinutes = Number(args["idle-stop-minutes"] || 35);
  const idleStopMs = idleStopMinutes > 0 ? idleStopMinutes * 60_000 : 0;
  const maxSegments = args["max-segments"] ? Number(args["max-segments"]) : null;

  if (!Number.isFinite(segmentSeconds) || segmentSeconds < 15) {
    throw new Error("--segment-seconds must be a number >= 15");
  }
  if (!Number.isFinite(pollMs) || pollMs < 250) {
    throw new Error("--poll-ms must be a number >= 250");
  }
  if (!Number.isFinite(settleMs) || settleMs < 1000) {
    throw new Error("--settle-ms must be a number >= 1000");
  }
  if (!Number.isFinite(idleStopMinutes) || idleStopMinutes < 0) {
    throw new Error("--idle-stop-minutes must be a number >= 0");
  }
  if (maxSegments !== null && (!Number.isFinite(maxSegments) || maxSegments <= 0)) {
    throw new Error("--max-segments must be a positive integer");
  }

  const outDir = args["out-dir"] || path.join("transcripts", `live-${timestampSlug()}`);
  const audioDir = path.join(outDir, "audio");
  const jsonDir = path.join(outDir, "json");
  const logDir = path.join(outDir, "logs");
  const transcriptPath = path.join(outDir, "transcript.txt");
  const jsonlPath = path.join(outDir, "segments.jsonl");
  const sessionPath = path.join(outDir, "session.json");

  await mkdir(audioDir, { recursive: true });
  await mkdir(jsonDir, { recursive: true });
  await mkdir(logDir, { recursive: true });

  const prompt = await buildPrompt({
    promptFile: args["prompt-file"],
    glossaryFile: args["glossary-file"]
  });

  const model =
    args.model ||
    (api.provider === "openrouter" ? "openai/whisper-1" : "gpt-4o-transcribe");

  const audioUrl = args["audio-url"] || resolveAudioUrl(args.url);
  const ffmpegOutPattern = path.join(audioDir, "%06d.wav");
  const ffmpegLogPath = path.join(logDir, "ffmpeg.log");

  await writeFile(
    sessionPath,
    JSON.stringify(
      {
        source_url: args.url,
        audio_url: audioUrl,
        provider: api.provider,
        model,
        language: args.language || null,
        segment_seconds: segmentSeconds,
        created_at: new Date().toISOString()
      },
      null,
      2
    )
  );

  await appendFile(
    transcriptPath,
    `# Live transcript\n# Source: ${args.url}\n# Started: ${new Date().toISOString()}\n\n`
  );

  const ffmpegArgs = [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-reconnect",
    "1",
    "-reconnect_streamed",
    "1",
    "-reconnect_delay_max",
    "30",
    "-i",
    audioUrl,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-f",
    "segment",
    "-segment_time",
    String(segmentSeconds),
    "-reset_timestamps",
    "1",
    ffmpegOutPattern
  ];

  const ffmpeg = spawn("ffmpeg", ffmpegArgs, {
    stdio: ["ignore", "ignore", "pipe"]
  });

  const ffmpegLogStream = createWriteStream(ffmpegLogPath, { flags: "a" });
  ffmpeg.stderr.pipe(ffmpegLogStream);

  let ffmpegExited = false;
  let ffmpegExitCode = 0;
  ffmpeg.on("close", (code) => {
    ffmpegExited = true;
    ffmpegExitCode = code ?? 0;
  });

  let shouldStop = false;
  process.on("SIGINT", () => {
    shouldStop = true;
    ffmpeg.kill("SIGINT");
  });
  process.on("SIGTERM", () => {
    shouldStop = true;
    ffmpeg.kill("SIGTERM");
  });

  const processed = new Set();
  const failedAttempts = new Map();
  const language = args.language || "";
  let transcribedCount = 0;
  let lastAudioProgressAt = Date.now();
  let lastAudioKey = "";
  let stopReason = "";

  console.log(`Output directory: ${outDir}`);
  console.log("Capturing audio and transcribing segments. Press Ctrl+C to stop.");

  while (!shouldStop) {
    const files = (await readdir(audioDir))
      .filter((name) => name.endsWith(".wav"))
      .sort((a, b) => a.localeCompare(b));

    if (files.length > 0) {
      const latestName = files[files.length - 1];
      const latestPath = path.join(audioDir, latestName);
      const latestStats = await stat(latestPath);
      const key = `${latestName}:${Math.floor(latestStats.mtimeMs)}:${latestStats.size}`;
      if (key !== lastAudioKey) {
        lastAudioKey = key;
        lastAudioProgressAt = Date.now();
      }
    }

    let progressed = false;

    for (const fileName of files) {
      if (processed.has(fileName)) {
        continue;
      }

      const fullPath = path.join(audioDir, fileName);
      const fileStats = await stat(fullPath);
      if (Date.now() - fileStats.mtimeMs < settleMs) {
        continue;
      }
      const stable = await waitForStableFile(fullPath, 2, 1200);
      if (!stable) {
        continue;
      }

      const startedAt = new Date().toISOString();
      try {
        const { text, raw } = await transcribeChunk({
          filePath: fullPath,
          model,
          language,
          prompt,
          api
        });

        const segmentId = path.basename(fileName, ".wav");
        const finalText = text || "[[NO_TEXT_RETURNED]]";
        const line = `[${startedAt}] [${segmentId}] ${finalText}`;
        await appendFile(transcriptPath, `${line}\n`);

        const perSegmentJsonPath = path.join(jsonDir, `${segmentId}.json`);
        await writeFile(perSegmentJsonPath, JSON.stringify(raw, null, 2));

        await appendFile(
          jsonlPath,
          `${JSON.stringify({
            timestamp: startedAt,
            segment: segmentId,
            audio_file: fullPath,
            text: finalText,
            json_file: perSegmentJsonPath
          })}\n`
        );

        processed.add(fileName);
        failedAttempts.delete(fileName);
        transcribedCount += 1;
        progressed = true;
        console.log(`Transcribed segment ${segmentId}`);

        if (maxSegments !== null && transcribedCount >= maxSegments) {
          shouldStop = true;
          ffmpeg.kill("SIGINT");
          break;
        }
      } catch (error) {
        const attempts = (failedAttempts.get(fileName) || 0) + 1;
        failedAttempts.set(fileName, attempts);
        await appendFile(
          jsonlPath,
          `${JSON.stringify({
            timestamp: startedAt,
            segment: path.basename(fileName, ".wav"),
            audio_file: fullPath,
            attempt: attempts,
            error: String(error)
          })}\n`
        );
        console.error(`Failed segment ${fileName} (attempt ${attempts}): ${String(error)}`);
        if (attempts >= 3) {
          processed.add(fileName);
          console.error(`Giving up on segment ${fileName} after ${attempts} attempts`);
        }
        progressed = true;
      }
    }

    if (!progressed) {
      if (!ffmpegExited && idleStopMs > 0 && Date.now() - lastAudioProgressAt >= idleStopMs) {
        stopReason = `idle timeout: no new audio progress for ${idleStopMinutes} minutes`;
        shouldStop = true;
        ffmpeg.kill("SIGINT");
        break;
      }
      if (ffmpegExited) {
        const remaining = (await readdir(audioDir)).filter(
          (name) => name.endsWith(".wav") && !processed.has(name)
        );
        if (remaining.length === 0) {
          break;
        }
      }
      await sleep(pollMs);
    }
  }

  ffmpegLogStream.end();
  await appendFile(
    transcriptPath,
    `\n# Ended: ${new Date().toISOString()} | Segments transcribed: ${transcribedCount}\n`
  );
  if (stopReason) {
    await appendFile(transcriptPath, `# Stop reason: ${stopReason}\n`);
    console.log(`Auto-stopped: ${stopReason}`);
  }

  if (ffmpegExitCode !== 0 && !shouldStop) {
    throw new Error(`ffmpeg exited with code ${ffmpegExitCode}. See ${ffmpegLogPath}`);
  }

  console.log(`Done. Transcript: ${transcriptPath}`);
  console.log(`Segments JSONL: ${jsonlPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
