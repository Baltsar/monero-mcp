#!/bin/sh
set -eu

if [ -z "${OPENROUTER_API_KEY:-}" ] && [ -z "${OPENAI_API_KEY:-}" ]; then
  echo "Set OPENROUTER_API_KEY or OPENAI_API_KEY"
  exit 1
fi

if [ -z "${STREAM_URL:-}" ]; then
  echo "Set STREAM_URL (for example: https://www.youtube.com/watch?v=CUN_Lv2R3U0)"
  exit 1
fi

mkdir -p /app/transcripts

if [ -n "${OUT_DIR:-}" ]; then
  TARGET_OUT_DIR="${OUT_DIR}"
else
  TARGET_OUT_DIR="/app/transcripts/live-$(date -u +%Y-%m-%dT%H-%M-%S)-vps"
fi
mkdir -p "$TARGET_OUT_DIR"

set -- \
  --url "$STREAM_URL" \
  --out-dir "$TARGET_OUT_DIR" \
  --language "${LANGUAGE:-en}" \
  --segment-seconds "${SEGMENT_SECONDS:-75}" \
  --settle-ms "${SETTLE_MS:-18000}" \
  --idle-stop-minutes "${IDLE_STOP_MINUTES:-35}" \
  --summary-every-minutes "${SUMMARY_EVERY_MINUTES:-10}" \
  --schedule-tz "${SCHEDULE_TZ:-America/Mexico_City}" \
  --event-date "${EVENT_DATE:-$(date -u +%Y-%m-%d)}" \
  --transcribe-model "${TRANSCRIBE_MODEL:-openai/whisper-1}" \
  --summary-model "${SUMMARY_MODEL:-openai/gpt-4o-mini}"

if [ -n "${SCHEDULE_URL:-}" ]; then
  set -- "$@" --schedule-url "$SCHEDULE_URL"
fi

if [ -n "${SCHEDULE_JSON:-}" ]; then
  set -- "$@" --schedule-json "$SCHEDULE_JSON"
fi

if [ -n "${GLOSSARY_FILE:-}" ] && [ -f "${GLOSSARY_FILE}" ]; then
  set -- "$@" --glossary-file "$GLOSSARY_FILE"
fi

if [ -n "${PROMPT_FILE:-}" ] && [ -f "${PROMPT_FILE}" ]; then
  set -- "$@" --prompt-file "$PROMPT_FILE"
fi

echo "Starting live pipeline in: $TARGET_OUT_DIR"
exec npm run transcribe:live:auto -- "$@"
