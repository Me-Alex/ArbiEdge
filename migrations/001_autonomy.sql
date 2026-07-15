CREATE TABLE IF NOT EXISTS autonomy_meta (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_runs (
  id bigserial PRIMARY KEY,
  provider text NOT NULL,
  feed_group text,
  ok boolean NOT NULL,
  event_count integer NOT NULL DEFAULT 0,
  duration_ms integer,
  schema_hash text,
  circuit_state text,
  error text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  checked_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS provider_runs_provider_checked_idx
  ON provider_runs (provider, checked_at DESC);

CREATE TABLE IF NOT EXISTS odds_snapshots (
  id bigserial PRIMARY KEY,
  fetched_at timestamptz NOT NULL,
  mode text NOT NULL,
  source text,
  event_count integer NOT NULL,
  provider_count integer NOT NULL DEFAULT 0,
  payload_gzip bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS odds_snapshots_fetched_idx
  ON odds_snapshots (fetched_at DESC);

CREATE TABLE IF NOT EXISTS opportunities (
  fingerprint text PRIMARY KEY,
  status text NOT NULL,
  event_key text NOT NULL,
  market_key text NOT NULL,
  edge double precision NOT NULL DEFAULT 0,
  expires_at timestamptz,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  price_confirmed boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS opportunities_status_last_seen_idx
  ON opportunities (status, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS opportunity_transitions (
  id bigserial PRIMARY KEY,
  fingerprint text NOT NULL REFERENCES opportunities(fingerprint) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS opportunity_transitions_fingerprint_idx
  ON opportunity_transitions (fingerprint, created_at DESC);

CREATE TABLE IF NOT EXISTS alert_outbox (
  id bigserial PRIMARY KEY,
  dedupe_key text NOT NULL UNIQUE,
  channel text NOT NULL,
  destination jsonb NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS alert_outbox_delivery_idx
  ON alert_outbox (status, next_attempt_at);

CREATE TABLE IF NOT EXISTS monitor_runs (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,
  ok boolean NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  checked_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS monitor_runs_kind_checked_idx
  ON monitor_runs (kind, checked_at DESC);

CREATE TABLE IF NOT EXISTS fidelity_records (
  id bigserial PRIMARY KEY,
  bookmaker text NOT NULL,
  event_id text,
  market_key text NOT NULL,
  outcome text NOT NULL,
  endpoint_price double precision,
  website_price double precision,
  status text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  checked_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS fidelity_records_lookup_idx
  ON fidelity_records (bookmaker, market_key, outcome, checked_at DESC);

CREATE TABLE IF NOT EXISTS settlements (
  id bigserial PRIMARY KEY,
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  provider text NOT NULL,
  result text NOT NULL,
  home_score integer,
  away_score integer,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  settled_at timestamptz NOT NULL,
  UNIQUE (subject_type, subject_id, provider)
);
