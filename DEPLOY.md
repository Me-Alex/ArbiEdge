# Deployment

This app is a Node.js HTTP service. It can run on a small always-on VM or as a
container. For the current bookmaker workload, a VM is usually simpler than a
serverless platform because live odds refreshes can run for several seconds.

## Recommended: autonomous Compose stack

The included Compose file runs the application with PostgreSQL, continuous
collection, production fail-closed behavior, persistent volumes, and Chromium
for rotating fidelity checks. Supply secrets through the environment:

```bash
export POSTGRES_PASSWORD='generate-and-store-this-outside-the-repository'
export RESULTS_ENABLED=1
export RESULTS_API_KEY='runtime-secret'
docker compose up --build -d
```

Keep port 3000 private or bind it behind an authenticated HTTPS reverse proxy.
The application container does not need direct public exposure for autonomous
collection and alerts. PostgreSQL is intentionally not published to the host.

## Option 1: Google Cloud free VM

Use an Always Free eligible Compute Engine VM, then run the app with systemd.

1. Create an Ubuntu VM in an Always Free eligible region.
2. Install Node.js 20 or newer.
3. Clone the repository and install production dependencies:

```bash
git clone <your-repo-url> oddsScraper
cd oddsScraper
npm ci --omit=dev
```

4. Create an environment file:

```bash
sudo mkdir -p /etc/odds-dashboard
sudo nano /etc/odds-dashboard/env
```

Example:

```bash
PORT=3000
ODDS_CACHE_TTL_MS=60000
ODDS_WARM_CACHE_ON_START=1
BOOKMAKER_EVENT_TARGET=1000
BETANO_BROWSER_ENABLED=0
```

5. Create `/etc/systemd/system/odds-dashboard.service`:

```ini
[Unit]
Description=Odds dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/YOUR_USER/oddsScraper
EnvironmentFile=/etc/odds-dashboard/env
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=5
User=YOUR_USER

[Install]
WantedBy=multi-user.target
```

6. Enable and start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now odds-dashboard
sudo systemctl status odds-dashboard
```

7. Check the app:

```bash
curl http://127.0.0.1:3000/api/health
```

For public HTTPS access, put nginx or Caddy in front of port `3000`.

## Option 2: Docker on a VM

Build and run locally or on any small VPS:

```bash
docker build -t odds-dashboard .
docker run --name odds-dashboard --restart unless-stopped -p 3000:3000 \
  -e PORT=3000 \
  -e ODDS_CACHE_TTL_MS=60000 \
  odds-dashboard
```

Health check:

```bash
curl http://127.0.0.1:3000/api/health
curl http://127.0.0.1:3000/api/readiness
curl http://127.0.0.1:3000/api/metrics
```

The health response includes cache age, whether an odds refresh is already
running, the latest refresh status, odds-audit status, and slow provider
timings. This is the safest endpoint for uptime
checks because it does not trigger bookmaker requests. Readiness returns `503`
until a first usable refresh is cached or currently running; use it for stricter
load balancer readiness checks.

## Option 3: Google Cloud Run

Cloud Run works best when traffic is low and refreshes complete inside request
timeouts. Containerize with the included `Dockerfile`, then deploy:

```bash
gcloud run deploy odds-dashboard \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars ODDS_CACHE_TTL_MS=60000,BETANO_BROWSER_ENABLED=0
```

Use the VM option if you need browser-backed providers or long-running scraping.

## Production notes

- Keep `BETANO_BROWSER_ENABLED=0` on tiny free servers unless you install and
  maintain Chrome intentionally.
- Set `ODDS_WARM_CACHE_ON_START=1` on servers so the first odds refresh starts
  immediately after boot instead of waiting for a user to open the dashboard.
- Increase `ODDS_CACHE_TTL_MS` if refreshes are slow or providers rate-limit.
- Keep secrets in environment variables, not in the repository.
- Use `AUTONOMY_ENABLED=1`, `DATABASE_URL`, and `PRODUCTION_FAIL_CLOSED=1` for
  unattended operation. Autonomous production refuses to start without durable
  PostgreSQL storage.
- Verify `/api/autonomy/status` as well as health/readiness after every deploy.
- Use `/api/health` for basic uptime checks, `/api/readiness` for stricter
  load-balancer checks, and `/api/odds/stream` for user-facing refreshes.
