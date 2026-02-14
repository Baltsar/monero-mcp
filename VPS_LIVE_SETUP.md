# VPS Live Transcribe Setup

This deploy keeps the current live pipeline behavior:
- live transcription
- summary refresh
- speaker-separated summary
- auto-stop when stream has no new audio for `IDLE_STOP_MINUTES`

## 1) Provision VPS

Recommended minimum:
- Ubuntu 22.04 or 24.04
- 2 vCPU
- 4 GB RAM
- 30 GB disk

## 2) Clone project on VPS

```bash
git clone <YOUR_REPO_URL> /opt/monero-mcp
cd /opt/monero-mcp
```

## 3) Install Docker on VPS

```bash
sudo bash deploy/vps/bootstrap-ubuntu-docker.sh
```

## 4) Configure environment

```bash
cp .env.vps.example .env.vps
nano .env.vps
```

Required in `.env.vps`:
- `OPENROUTER_API_KEY` (or `OPENAI_API_KEY`)
- `STREAM_URL`
- `EVENT_DATE` (for tomorrow's date in schedule timezone)

## 5) Start service

```bash
docker compose -f deploy/vps/docker-compose.live.yml up -d --build
```

## 6) Verify

Container logs:

```bash
docker logs -f monero-live-transcribe
```

Latest transcript output:

```bash
ls -td transcripts/live-* | head -n1
latest=$(ls -td transcripts/live-* | head -n1)
tail -f "$latest/transcript.txt"
```

## 7) Stop / restart

Stop:

```bash
docker compose -f deploy/vps/docker-compose.live.yml down
```

Restart:

```bash
docker compose -f deploy/vps/docker-compose.live.yml up -d
```

## Notes

- Restart policy is `on-failure`.
- Graceful auto-stop at stream end uses exit code `0`, so container does not loop forever.
- If stream has long silence windows, increase `IDLE_STOP_MINUTES` in `.env.vps`.
