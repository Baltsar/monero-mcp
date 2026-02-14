# Live Transcription Workflow (High Accuracy)

This workflow captures a YouTube live stream, transcribes it in chunks with OpenAI, then creates a summary and X-ready drafts.

## 1) Prerequisites

Install required local tools:

```bash
brew install yt-dlp ffmpeg
```

Set your API key:

```bash
export OPENAI_API_KEY="YOUR_KEY"
```

Or use OpenRouter:

```bash
export OPENROUTER_API_KEY="YOUR_OPENROUTER_KEY"
```

## 2) Optional: Prepare a glossary (recommended)

For better accuracy on names, brands, or crypto terms, create a glossary file:

```txt
Monero
XMR
Atomic swaps
Seraphis
```

Save it as `transcripts/glossary.txt` (or any path).

## 3) Automatic live mode (recommended)

This mode runs:
- live transcription
- periodic summary refresh
- X draft refresh in the same output folder

```bash
npm run transcribe:live:auto -- \
  --url "https://www.youtube.com/watch?v=CUN_Lv2R3U0" \
  --language en \
  --segment-seconds 75 \
  --settle-ms 12000 \
  --idle-stop-minutes 35 \
  --summary-every-minutes 10 \
  --schedule-url "https://monerotopia.com/schedule-2026/" \
  --schedule-tz "America/Mexico_City" \
  --glossary-file transcripts/glossary.txt
```

Where output appears:
- `transcripts/live-<timestamp>/transcript.txt`
- `transcripts/live-<timestamp>/summary/summary.md`
- `transcripts/live-<timestamp>/summary/x_post.txt`
- `transcripts/live-<timestamp>/summary/x_thread.txt`

Press `Ctrl+C` to stop.

Quick status view:

```bash
npm run transcribe:status
```

Live-refresh status view:

```bash
npm run transcribe:status -- --watch
```

## 4) Manual live mode (if needed)

Command:

```bash
npm run transcribe:live -- \
  --url "https://www.youtube.com/watch?v=CUN_Lv2R3U0" \
  --language en \
  --segment-seconds 75 \
  --glossary-file transcripts/glossary.txt
```

Notes:
- Press `Ctrl+C` to stop.
- Output is written to `transcripts/live-<timestamp>/`.

Main files:
- `transcript.txt`: line-by-line transcript
- `segments.jsonl`: per-segment metadata / errors
- `json/*.json`: raw transcription responses

## 5) Generate summary + X drafts

After stream (or mid-stream against current transcript):

```bash
npm run transcribe:summary -- \
  --input transcripts/live-<timestamp>/transcript.txt \
  --model gpt-4.1
```

Outputs in `transcripts/live-<timestamp>/summary/`:
- `summary.md`
- `x_post.txt`
- `x_thread.txt`
- `result.json`

## 6) Final VOD second pass (higher accuracy)

Run this after the stream has ended and VOD is available:

```bash
npm run transcribe:vod:final -- \
  --url "https://www.youtube.com/watch?v=CUN_Lv2R3U0" \
  --language en \
  --glossary-file transcripts/glossary.txt \
  --compare-transcript transcripts/live-<timestamp>/transcript.txt
```

This creates:
- `transcripts/vod-final-<timestamp>/transcript.txt`
- `transcripts/vod-final-<timestamp>/summary/*`
- `transcripts/vod-final-<timestamp>/HUMAN_REVIEW_REQUIRED.md`

Speaker-aware outputs inside summary folder:
- `summary_by_speaker.md`
- `speaker_assignments.jsonl`
- `name_confirmation_report.md`

`HUMAN_REVIEW_REQUIRED.md` is a mandatory gate before posting.

## 7) Accuracy checklist before posting

For "super correct" output, do this QA pass:

1. Scan `segments.jsonl` for `error` entries and re-run stream capture if needed.
2. Read `summary/result.json` -> `qa_flags`, verify each point against `transcript.txt`.
3. Verify names/numbers/dates manually (these are highest-risk errors).
4. Ensure X draft wording is factual and avoids uncertain claims.

## 8) Recommended settings for best quality

- Keep `--segment-seconds` between `60` and `90`.
- Always provide a glossary for proper nouns.
- Run a second pass on the final VOD if you need publication-grade accuracy.

## 9) VPS Deploy

For a ready-to-run Ubuntu VPS setup with Docker:
- `VPS_LIVE_SETUP.md`
