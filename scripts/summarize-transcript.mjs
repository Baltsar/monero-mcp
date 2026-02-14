#!/usr/bin/env node

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
  node scripts/summarize-transcript.mjs --input <transcript.txt> [options]

Required:
  --input             Transcript file from live-transcribe.mjs

Options:
  --out-dir           Output directory (default: <transcript-dir>/summary)
  --model             LLM model (default: provider-specific)
  --chunk-chars       Approx chunk size for long transcripts (default: 12000)
  --schedule-url      Event schedule page URL (optional)
  --schedule-json     Local JSON file with schedule entries (optional)
  --schedule-tz       IANA timezone for schedule matching (default: America/Mexico_City)
  --event-date        Local event date in schedule timezone (YYYY-MM-DD)

Environment:
  OPENAI_API_KEY      Required if OPENROUTER_API_KEY is not set
  OPENROUTER_API_KEY  Optional alternative to OPENAI_API_KEY
`);
}

function splitIntoChunks(lines, maxChars) {
  if (lines.length === 0) {
    return [];
  }

  const chunks = [];
  let current = [];
  let currentSize = 0;

  for (const line of lines) {
    if (currentSize + line.length + 1 > maxChars && current.length > 0) {
      chunks.push(current.join("\n"));
      current = [line];
      currentSize = line.length + 1;
    } else {
      current.push(line);
      currentSize += line.length + 1;
    }
  }

  if (current.length > 0) {
    chunks.push(current.join("\n"));
  }

  return chunks;
}

function extractJson(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Try markdown code fence payload.
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    return JSON.parse(fenced[1]);
  }

  throw new Error("Model output is not valid JSON");
}

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}

function clamp280(text) {
  const clean = normalizeWhitespace(text);
  const chars = [...clean];
  if (chars.length <= 280) {
    return clean;
  }
  return `${chars.slice(0, 277).join("")}...`;
}

function normalizeForMatch(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
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
    return content;
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
  return parts.join("\n");
}

async function chatCompletion({ api, model, messages, temperature = 0.2 }) {
  const response = await fetch(`${api.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${api.apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature,
      messages
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API HTTP ${response.status}: ${body}`);
  }

  const json = await response.json();
  const rawContent = json?.choices?.[0]?.message?.content;
  const content = extractContentText(rawContent).trim();
  if (!content) {
    throw new Error("API returned empty content");
  }
  return content;
}

function parseTranscriptEntries(transcriptRaw, scheduleTz) {
  const rows = transcriptRaw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const parsed = [];
  for (const row of rows) {
    const match = row.match(/^\[([^\]]+)\]\s+\[([^\]]+)\]\s*(.*)$/);
    if (!match) {
      continue;
    }
    const utcIso = match[1];
    const segment = match[2];
    const text = normalizeWhitespace(match[3] || "");
    if (!text) {
      continue;
    }

    const date = new Date(utcIso);
    if (Number.isNaN(date.getTime())) {
      continue;
    }

    const localDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: scheduleTz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);

    const localTime = new Intl.DateTimeFormat("en-GB", {
      timeZone: scheduleTz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);

    const [hh, mm] = localTime.split(":").map((x) => Number(x));
    const localMinuteOfDay = hh * 60 + mm;

    parsed.push({
      utcIso,
      segment,
      text,
      localDate,
      localTime,
      localMinuteOfDay
    });
  }
  return parsed;
}

function cleanHtmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function parseTimeToMinutes(timeLabel) {
  const normalized = String(timeLabel || "").trim().toUpperCase();
  if (!normalized) {
    return null;
  }

  const m = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/);
  if (!m) {
    return null;
  }

  let hour = Number(m[1]);
  const minute = Number(m[2] || 0);
  const ampm = m[3] || "";

  if (minute < 0 || minute > 59 || hour < 0 || hour > 24) {
    return null;
  }

  if (ampm === "AM") {
    if (hour === 12) {
      hour = 0;
    }
  } else if (ampm === "PM") {
    if (hour < 12) {
      hour += 12;
    }
  }

  if (hour === 24 && minute === 0) {
    return 24 * 60;
  }
  if (hour < 0 || hour > 23) {
    return null;
  }
  return hour * 60 + minute;
}

function minutesToHHMM(minutes) {
  if (!Number.isFinite(minutes)) {
    return "";
  }
  const clamped = Math.max(0, Math.min(24 * 60, Math.floor(minutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

async function extractScheduleEntriesFromText({ api, model, scheduleText, eventDate, scheduleTz }) {
  const content = await chatCompletion({
    api,
    model,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "You extract conference schedule rows from raw webpage text. Return strict JSON only."
      },
      {
        role: "user",
        content: `Extract schedule entries for local date ${eventDate} in timezone ${scheduleTz}.

Return JSON object exactly in this shape:
{
  "entries": [
    {
      "start": "HH:MM",
      "end": "HH:MM",
      "title": "string",
      "speakers": ["speaker one", "speaker two"]
    }
  ]
}

Rules:
- 24-hour format HH:MM for start/end.
- Include only talks/panels/sessions; skip breaks/check-in lines.
- If a session has multiple speakers, list all in speakers.
- If speaker unknown, use empty array.
- No explanation text, JSON only.

Raw schedule text:
${scheduleText.slice(0, 70000)}`
      }
    ]
  });

  const parsed = extractJson(content);
  return Array.isArray(parsed.entries) ? parsed.entries : [];
}

function normalizeScheduleEntries(rawEntries) {
  const normalized = rawEntries
    .map((entry) => {
      const start = parseTimeToMinutes(entry.start);
      let end = parseTimeToMinutes(entry.end);
      if (start === null) {
        return null;
      }
      if (end === null || end <= start) {
        end = start + 40;
      }

      const title = normalizeWhitespace(String(entry.title || "Talk"));
      const speakers = Array.isArray(entry.speakers)
        ? entry.speakers.map((s) => normalizeWhitespace(String(s))).filter(Boolean)
        : [];

      const lowerTitle = title.toLowerCase();
      if (lowerTitle.includes("break") || lowerTitle.includes("check-in")) {
        return null;
      }

      return {
        startMin: start,
        endMin: end,
        start: minutesToHHMM(start),
        end: minutesToHHMM(end),
        title,
        speakers
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.startMin - b.startMin);

  // If overlapping/undefined ends happened, smooth by next start when possible.
  for (let i = 0; i < normalized.length - 1; i += 1) {
    const current = normalized[i];
    const next = normalized[i + 1];
    if (current.endMin > next.startMin) {
      current.endMin = next.startMin;
      current.end = minutesToHHMM(current.endMin);
    }
  }

  return normalized;
}

function speakerTokens(name) {
  return normalizeForMatch(name)
    .split(/[^a-z0-9]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4)
    .slice(0, 4);
}

function buildSpeakerIndex(scheduleEntries) {
  const bySpeaker = new Map();
  for (const entry of scheduleEntries) {
    for (const speaker of entry.speakers) {
      if (!bySpeaker.has(speaker)) {
        bySpeaker.set(speaker, speakerTokens(speaker));
      }
    }
  }
  return bySpeaker;
}

function detectMentionedSpeakers(text, speakerIndex) {
  const normalizedText = ` ${normalizeForMatch(text).replace(/[^a-z0-9 ]+/g, " ")} `;
  const mentioned = [];

  for (const [speaker, tokens] of speakerIndex.entries()) {
    if (tokens.length === 0) {
      continue;
    }
    const matched = tokens.some((token) => normalizedText.includes(` ${token} `));
    if (matched) {
      mentioned.push(speaker);
    }
  }
  return mentioned;
}

function assignSpeakers({ transcriptEntries, scheduleEntries }) {
  const speakerIndex = buildSpeakerIndex(scheduleEntries);

  return transcriptEntries.map((entry) => {
    const slot = scheduleEntries.find(
      (s) => entry.localMinuteOfDay >= s.startMin && entry.localMinuteOfDay < s.endMin
    );
    const slotSpeakers = slot?.speakers || [];
    const mentioned = detectMentionedSpeakers(entry.text, speakerIndex);
    const slotSpeakerSet = new Set(slotSpeakers.map((s) => s.toLowerCase()));
    const mentionedInSlot = mentioned.filter((m) => slotSpeakerSet.has(m.toLowerCase()));

    let speakerLabel = "Unknown speaker";
    let confidence = "unassigned";

    if (mentionedInSlot.length === 1) {
      speakerLabel = mentionedInSlot[0];
      confidence = "double_confirmed";
    } else if (mentionedInSlot.length > 1) {
      speakerLabel = mentionedInSlot.join(" + ");
      confidence = "double_confirmed_multi";
    } else if (slotSpeakers.length === 1) {
      speakerLabel = slotSpeakers[0];
      confidence = "time_window_only";
    } else if (mentioned.length === 1) {
      speakerLabel = mentioned[0];
      confidence = slot ? "name_only_conflicts_window" : "name_only";
    } else if (slotSpeakers.length > 1) {
      speakerLabel = `Panel (${slotSpeakers.join(", ")})`;
      confidence = "time_window_panel";
    }

    return {
      ...entry,
      speakerLabel,
      confidence,
      scheduleTitle: slot?.title || "",
      scheduleStart: slot?.start || "",
      scheduleEnd: slot?.end || "",
      mentionedSpeakers: mentioned
    };
  });
}

function groupAssignmentsBySpeaker(assignments) {
  const groups = new Map();
  for (const item of assignments) {
    if (!groups.has(item.speakerLabel)) {
      groups.set(item.speakerLabel, []);
    }
    groups.get(item.speakerLabel).push(item);
  }

  return [...groups.entries()]
    .map(([speaker, items]) => ({ speaker, items }))
    .sort((a, b) => b.items.length - a.items.length);
}

function buildSpeakerContext(groups) {
  const parts = [];
  for (const group of groups) {
    const confidenceCounts = group.items.reduce((acc, item) => {
      acc[item.confidence] = (acc[item.confidence] || 0) + 1;
      return acc;
    }, {});

    const windows = [...new Set(
      group.items
        .map((item) => (item.scheduleStart && item.scheduleEnd ? `${item.scheduleStart}-${item.scheduleEnd}` : ""))
        .filter(Boolean)
    )];

    const excerptLines = group.items
      .slice(0, 25)
      .map((item) => `[${item.localTime}] ${item.text}`)
      .join("\n");

    parts.push(`### Speaker: ${group.speaker}
- line_count: ${group.items.length}
- confidence_counts: ${JSON.stringify(confidenceCounts)}
- schedule_windows_local: ${windows.length > 0 ? windows.join(", ") : "unknown"}
- transcript_excerpt:\n${excerptLines}`);
  }
  return parts.join("\n\n");
}

async function summarizeChunk({ api, model, chunkText, chunkIndex, totalChunks }) {
  const content = await chatCompletion({
    api,
    model,
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content:
          "You are a precise transcript analyst. Extract only what is supported by the text. Do not invent facts."
      },
      {
        role: "user",
        content: `Chunk ${chunkIndex + 1}/${totalChunks}

Summarize this transcript chunk with:
- 5 to 10 factual bullet points
- 3 notable quotes or moments (short, plain text)
- Open questions or unclear claims

Transcript chunk:
${chunkText}`
      }
    ]
  });

  return content.trim();
}

async function buildFinalArtifacts({
  api,
  model,
  chunkSummaries,
  speakerContext,
  eventDate,
  scheduleTz
}) {
  const content = await chatCompletion({
    api,
    model,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "You write factual summaries and social drafts. Return strict JSON only. Keep different speakers separated."
      },
      {
        role: "user",
        content: `Build final outputs from transcript summaries and speaker-assignment context.

Event local date: ${eventDate}
Timezone: ${scheduleTz}

Return JSON with keys:
- title: string
- summary_markdown: string (overall high-level summary)
- speaker_summaries_markdown: string (separate section per speaker; do not merge speakers)
- x_post: string (single post, <=280 chars)
- x_thread: string[] (3 to 5 posts, each <=280 chars, factual tone)
- qa_flags: string[] (0-12 items, include name/speaker verification checks)

Chunk summaries:
${chunkSummaries.map((item, idx) => `### Chunk ${idx + 1}\n${item}`).join("\n\n")}

Speaker context:
${speakerContext}`
      }
    ]
  });

  const parsed = extractJson(content);

  const xPost = clamp280(String(parsed.x_post || ""));
  const xThreadRaw = Array.isArray(parsed.x_thread) ? parsed.x_thread : [];
  const xThread = xThreadRaw
    .map((item) => clamp280(String(item)))
    .filter(Boolean)
    .slice(0, 5);

  return {
    title: String(parsed.title || "Transcript Summary"),
    summaryMarkdown: String(parsed.summary_markdown || "").trim(),
    speakerSummariesMarkdown: String(parsed.speaker_summaries_markdown || "").trim(),
    xPost,
    xThread,
    qaFlags: Array.isArray(parsed.qa_flags)
      ? parsed.qa_flags.map((item) => String(item)).filter(Boolean)
      : []
  };
}

function buildNameConfirmationReport(assignments) {
  const rows = assignments
    .filter((a) => a.mentionedSpeakers.length > 0)
    .map((a) => {
      const matched = a.confidence.startsWith("double_confirmed") ? "YES" : "NO";
      return `- [${a.localTime}] seg ${a.segment} | speaker=${a.speakerLabel} | confidence=${a.confidence} | name_mention=${a.mentionedSpeakers.join(", ")} | double_confirmation=${matched}`;
    });

  if (rows.length === 0) {
    return "- No explicit speaker-name mentions detected in transcript lines.";
  }
  return rows.join("\n");
}

async function maybeLoadSchedule({ api, model, scheduleUrl, scheduleJsonPath, outDir, eventDate, scheduleTz }) {
  if (scheduleJsonPath) {
    const raw = await readFile(scheduleJsonPath, "utf8");
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed) ? parsed : Array.isArray(parsed.entries) ? parsed.entries : [];
    return normalizeScheduleEntries(entries);
  }

  if (!scheduleUrl) {
    return [];
  }

  const response = await fetch(scheduleUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch schedule URL (${response.status}) ${scheduleUrl}`);
  }
  const html = await response.text();
  const scheduleText = cleanHtmlToText(html);

  const rawEntries = await extractScheduleEntriesFromText({
    api,
    model,
    scheduleText,
    eventDate,
    scheduleTz
  });

  await writeFile(
    path.join(outDir, "schedule_extracted.json"),
    JSON.stringify({ eventDate, scheduleTz, entries: rawEntries }, null, 2)
  );

  return normalizeScheduleEntries(rawEntries);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help === "true") {
    usage();
    process.exit(0);
  }

  if (!args.input) {
    usage();
    process.exit(1);
  }

  const api = resolveApiCredentials();

  const chunkChars = Number(args["chunk-chars"] || 12000);
  if (!Number.isFinite(chunkChars) || chunkChars < 3000) {
    throw new Error("--chunk-chars must be a number >= 3000");
  }

  const inputPath = args.input;
  const outDir = args["out-dir"] || path.join(path.dirname(inputPath), "summary");
  await mkdir(outDir, { recursive: true });

  const scheduleTz = args["schedule-tz"] || "America/Mexico_City";
  const model = args.model || (api.provider === "openrouter" ? "openai/gpt-4o-mini" : "gpt-4.1");

  const transcriptRaw = await readFile(inputPath, "utf8");
  const transcriptEntries = parseTranscriptEntries(transcriptRaw, scheduleTz);
  if (transcriptEntries.length === 0) {
    throw new Error("Transcript has no parseable entries");
  }

  const eventDate = args["event-date"] || transcriptEntries[0].localDate;

  let scheduleEntries = [];
  try {
    scheduleEntries = await maybeLoadSchedule({
      api,
      model,
      scheduleUrl: args["schedule-url"] || "",
      scheduleJsonPath: args["schedule-json"] || "",
      outDir,
      eventDate,
      scheduleTz
    });
  } catch (error) {
    await appendFile(path.join(outDir, "warnings.log"), `${new Date().toISOString()} schedule_load_error: ${String(error)}\n`);
  }

  const assignments = assignSpeakers({
    transcriptEntries,
    scheduleEntries
  });
  const groups = groupAssignmentsBySpeaker(assignments);

  const transcriptLinesForChunking = assignments.map(
    (a) => `[${a.localTime}] [${a.segment}] ${a.speakerLabel} (${a.confidence}) ${a.text}`
  );
  const chunks = splitIntoChunks(transcriptLinesForChunking, chunkChars);

  const chunkSummaries = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const summary = await summarizeChunk({
      api,
      model,
      chunkText: chunks[i],
      chunkIndex: i,
      totalChunks: chunks.length
    });
    chunkSummaries.push(summary);
    console.log(`Summarized chunk ${i + 1}/${chunks.length}`);
  }

  const speakerContext = buildSpeakerContext(groups);
  const finalArtifacts = await buildFinalArtifacts({
    api,
    model,
    chunkSummaries,
    speakerContext,
    eventDate,
    scheduleTz
  });

  const summaryMd = `# ${finalArtifacts.title}

Generated: ${new Date().toISOString()}
Event date (${scheduleTz}): ${eventDate}

## Overall Summary
${finalArtifacts.summaryMarkdown}

## By Speaker
${finalArtifacts.speakerSummariesMarkdown}

## QA Flags
${finalArtifacts.qaFlags.length > 0 ? finalArtifacts.qaFlags.map((x) => `- ${x}`).join("\n") : "- None"}
`;

  const threadText = finalArtifacts.xThread
    .map((item, index) => `${index + 1}. ${item}`)
    .join("\n\n");

  const assignmentsJsonl = assignments.map((a) => JSON.stringify(a)).join("\n");
  const nameReport = buildNameConfirmationReport(assignments);

  await Promise.all([
    writeFile(path.join(outDir, "summary.md"), summaryMd),
    writeFile(path.join(outDir, "summary_by_speaker.md"), `${finalArtifacts.speakerSummariesMarkdown}\n`),
    writeFile(path.join(outDir, "x_post.txt"), `${finalArtifacts.xPost}\n`),
    writeFile(path.join(outDir, "x_thread.txt"), `${threadText}\n`),
    writeFile(path.join(outDir, "speaker_assignments.jsonl"), `${assignmentsJsonl}\n`),
    writeFile(path.join(outDir, "name_confirmation_report.md"), `${nameReport}\n`),
    writeFile(
      path.join(outDir, "chunk_summaries.md"),
      chunkSummaries.map((item, idx) => `## Chunk ${idx + 1}\n\n${item}`).join("\n\n")
    ),
    writeFile(
      path.join(outDir, "result.json"),
      JSON.stringify(
        {
          ...finalArtifacts,
          generated_at: new Date().toISOString(),
          model,
          schedule_tz: scheduleTz,
          event_date: eventDate,
          schedule_entry_count: scheduleEntries.length,
          speaker_group_count: groups.length
        },
        null,
        2
      )
    )
  ]);

  console.log(`Summary outputs written to: ${outDir}`);
  console.log(`- ${path.join(outDir, "summary.md")}`);
  console.log(`- ${path.join(outDir, "summary_by_speaker.md")}`);
  console.log(`- ${path.join(outDir, "x_post.txt")}`);
  console.log(`- ${path.join(outDir, "x_thread.txt")}`);
  console.log(`- ${path.join(outDir, "speaker_assignments.jsonl")}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
