'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

class MemoryAutonomyStore {
  constructor() {
    this.snapshots = [];
    this.providerRuns = [];
    this.opportunities = new Map();
    this.transitions = [];
    this.alerts = new Map();
    this.monitorRuns = [];
    this.fidelityRecords = [];
    this.settlements = [];
    this.nextAlertId = 1;
    this.initialized = false;
  }

  async init() {
    this.initialized = true;
    return this;
  }

  async close() {}

  async saveSnapshot(payload) {
    const row = {
      id: this.snapshots.length + 1,
      fetchedAt: payload?.fetchedAt || new Date().toISOString(),
      mode: payload?.mode || 'unknown',
      eventCount: Array.isArray(payload?.events) ? payload.events.length : 0,
      providerCount: Array.isArray(payload?.providers) ? payload.providers.length : 0,
      payload: structuredClone(payload),
    };
    this.snapshots.push(row);
    return row.id;
  }

  async loadLatestSnapshot() {
    const latest = this.snapshots[this.snapshots.length - 1];
    return latest ? structuredClone(latest.payload) : null;
  }

  async recordProviderRuns(runs, checkedAt = new Date().toISOString()) {
    for (const run of runs || []) {
      this.providerRuns.push({ ...structuredClone(run), checkedAt: run.checkedAt || checkedAt });
    }
  }

  async upsertOpportunity(record) {
    const current = this.opportunities.get(record.fingerprint);
    const next = {
      ...current,
      ...structuredClone(record),
      firstSeenAt: current?.firstSeenAt || record.firstSeenAt,
    };
    this.opportunities.set(record.fingerprint, next);
    if (!current || current.status !== record.status) {
      this.transitions.push({
        fingerprint: record.fingerprint,
        fromStatus: current?.status || null,
        toStatus: record.status,
        reason: record.reason || null,
        createdAt: record.lastSeenAt,
      });
    }
    return { created: !current, statusChanged: current?.status !== record.status, record: next };
  }

  async expireOpportunities(activeFingerprints, expiredAt = new Date().toISOString()) {
    const active = new Set(activeFingerprints || []);
    let count = 0;
    for (const [fingerprint, record] of this.opportunities) {
      if (active.has(fingerprint) || ['expired', 'settled'].includes(record.status)) continue;
      const previousStatus = record.status;
      record.status = 'expired';
      record.lastSeenAt = expiredAt;
      this.transitions.push({
        fingerprint,
        fromStatus: previousStatus,
        toStatus: 'expired',
        reason: 'not present in the latest snapshot',
        createdAt: expiredAt,
      });
      count += 1;
    }
    return count;
  }

  async enqueueAlert({ dedupeKey, channel, destination, payload }) {
    for (const alert of this.alerts.values()) {
      if (alert.dedupeKey === dedupeKey) return { ...alert, inserted: false };
    }
    const alert = {
      id: this.nextAlertId++,
      dedupeKey,
      channel,
      destination: structuredClone(destination),
      payload: structuredClone(payload),
      status: 'pending',
      attempts: 0,
      nextAttemptAt: new Date().toISOString(),
      lastError: null,
    };
    this.alerts.set(alert.id, alert);
    return { ...alert, inserted: true };
  }

  async claimAlerts(limit = 20, now = new Date()) {
    const nowMs = new Date(now).getTime();
    return [...this.alerts.values()]
      .filter((alert) => ['pending', 'retry'].includes(alert.status))
      .filter((alert) => new Date(alert.nextAttemptAt).getTime() <= nowMs)
      .slice(0, limit)
      .map((alert) => {
        alert.status = 'delivering';
        alert.attempts += 1;
        return structuredClone(alert);
      });
  }

  async completeAlert(id, { ok, error = null, retryAt = null, permanent = false } = {}) {
    const alert = this.alerts.get(Number(id));
    if (!alert) return null;
    alert.status = ok ? 'delivered' : permanent ? 'dead' : 'retry';
    alert.lastError = error;
    alert.nextAttemptAt = retryAt || alert.nextAttemptAt;
    alert.deliveredAt = ok ? new Date().toISOString() : null;
    return structuredClone(alert);
  }

  async recordMonitorRun(run) {
    this.monitorRuns.push(structuredClone(run));
  }

  async saveFidelityRecords(records, checkedAt = new Date().toISOString()) {
    this.fidelityRecords.push(...(records || []).map((record) => ({ ...structuredClone(record), checkedAt })));
  }

  async loadLatestFidelityRecords(maxAgeMs = 6 * 60 * 60_000, now = new Date()) {
    const cutoff = new Date(now).getTime() - maxAgeMs;
    const latest = new Map();
    for (const record of this.fidelityRecords) {
      if (new Date(record.checkedAt).getTime() < cutoff) continue;
      const key = [record.bookmaker, record.eventId, record.marketKey, record.outcome].join('|');
      const current = latest.get(key);
      if (!current || new Date(record.checkedAt) > new Date(current.checkedAt)) latest.set(key, record);
    }
    return [...latest.values()].map((record) => structuredClone(record));
  }

  async recordSettlement(settlement) {
    const key = `${settlement.subjectType}:${settlement.subjectId}:${settlement.provider}`;
    const existing = this.settlements.find((item) => item.key === key);
    if (existing) return existing;
    const row = { key, ...structuredClone(settlement) };
    this.settlements.push(row);
    return row;
  }

  async prune({ snapshotDays = 7, providerRunDays = 30, monitorDays = 90, fidelityDays = 7 } = {}, now = new Date()) {
    const before = {
      snapshots: this.snapshots.length,
      providerRuns: this.providerRuns.length,
      monitorRuns: this.monitorRuns.length,
      fidelityRecords: this.fidelityRecords.length,
    };
    this.snapshots = retainSince(this.snapshots, 'fetchedAt', snapshotDays, now);
    this.providerRuns = retainSince(this.providerRuns, 'checkedAt', providerRunDays, now);
    this.monitorRuns = retainSince(this.monitorRuns, 'checkedAt', monitorDays, now);
    this.fidelityRecords = retainSince(this.fidelityRecords, 'checkedAt', fidelityDays, now);
    return Object.fromEntries(Object.entries(before).map(([key, count]) => [key, count - this[key].length]));
  }

  diagnostics() {
    return {
      type: 'memory',
      initialized: this.initialized,
      snapshots: this.snapshots.length,
      opportunities: this.opportunities.size,
      fidelityRecords: this.fidelityRecords.length,
      pendingAlerts: [...this.alerts.values()].filter((alert) => ['pending', 'retry', 'delivering'].includes(alert.status)).length,
    };
  }
}

class PostgresAutonomyStore {
  constructor({ connectionString, ssl = false, pool = null, migrationPath } = {}) {
    if (!connectionString && !pool) throw new Error('PostgresAutonomyStore requires DATABASE_URL or a pool');
    this.connectionString = connectionString;
    this.ssl = ssl;
    this.pool = pool;
    this.migrationPath = migrationPath || path.join(__dirname, '..', '..', 'migrations', '001_autonomy.sql');
    this.initialized = false;
  }

  async init() {
    if (!this.pool) {
      const { Pool } = require('pg');
      this.pool = new Pool({
        connectionString: this.connectionString,
        ...(this.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
        max: 8,
      });
    }
    const migration = fs.readFileSync(this.migrationPath, 'utf8');
    await this.pool.query(migration);
    this.initialized = true;
    return this;
  }

  async close() {
    await this.pool?.end?.();
  }

  async saveSnapshot(payload) {
    const json = Buffer.from(JSON.stringify(payload));
    const payloadGzip = zlib.gzipSync(json, { level: zlib.constants.Z_BEST_SPEED });
    const result = await this.pool.query(
      `INSERT INTO odds_snapshots
       (fetched_at, mode, source, event_count, provider_count, payload_gzip)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        payload?.fetchedAt || new Date().toISOString(),
        payload?.mode || 'unknown',
        payload?.source || null,
        Array.isArray(payload?.events) ? payload.events.length : 0,
        Array.isArray(payload?.providers) ? payload.providers.length : 0,
        payloadGzip,
      ],
    );
    return result.rows[0].id;
  }

  async loadLatestSnapshot() {
    const result = await this.pool.query(
      'SELECT payload_gzip FROM odds_snapshots ORDER BY fetched_at DESC, id DESC LIMIT 1',
    );
    if (!result.rows[0]) return null;
    return JSON.parse(zlib.gunzipSync(result.rows[0].payload_gzip).toString('utf8'));
  }

  async recordProviderRuns(runs, checkedAt = new Date().toISOString()) {
    for (const run of runs || []) {
      await this.pool.query(
        `INSERT INTO provider_runs
         (provider, feed_group, ok, event_count, duration_ms, schema_hash, circuit_state, error, details, checked_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [run.name || run.provider, run.feedGroup || null, Boolean(run.ok), Number(run.events || 0),
          finiteOrNull(run.durationMs), run.schemaHash || null, run.circuitState || null,
          run.error || null, run, run.checkedAt || checkedAt],
      );
    }
  }

  async upsertOpportunity(record) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(
        'SELECT status FROM opportunities WHERE fingerprint = $1 FOR UPDATE',
        [record.fingerprint],
      );
      const previousStatus = existing.rows[0]?.status || null;
      await client.query(
        `INSERT INTO opportunities
         (fingerprint,status,event_key,market_key,edge,expires_at,first_seen_at,last_seen_at,price_confirmed,payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (fingerprint) DO UPDATE SET
           status=EXCLUDED.status, edge=EXCLUDED.edge, expires_at=EXCLUDED.expires_at,
           last_seen_at=EXCLUDED.last_seen_at, price_confirmed=EXCLUDED.price_confirmed,
           payload=EXCLUDED.payload`,
        [record.fingerprint, record.status, record.eventKey, record.marketKey, record.edge,
          record.expiresAt, record.firstSeenAt, record.lastSeenAt, Boolean(record.priceConfirmed), record.payload],
      );
      if (previousStatus !== record.status) {
        await client.query(
          `INSERT INTO opportunity_transitions
           (fingerprint,from_status,to_status,reason,created_at) VALUES ($1,$2,$3,$4,$5)`,
          [record.fingerprint, previousStatus, record.status, record.reason || null, record.lastSeenAt],
        );
      }
      await client.query('COMMIT');
      return { created: !previousStatus, statusChanged: previousStatus !== record.status, record };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async expireOpportunities(activeFingerprints, expiredAt = new Date().toISOString()) {
    const fingerprints = Array.isArray(activeFingerprints) ? activeFingerprints : [];
    const result = await this.pool.query(
      `WITH expired AS (
         UPDATE opportunities SET status='expired', last_seen_at=$2
         WHERE status NOT IN ('expired','settled') AND NOT (fingerprint = ANY($1::text[]))
         RETURNING fingerprint
       )
       INSERT INTO opportunity_transitions (fingerprint,from_status,to_status,reason,created_at)
       SELECT fingerprint,NULL,'expired','not present in the latest snapshot',$2 FROM expired
       RETURNING id`,
      [fingerprints, expiredAt],
    );
    return result.rowCount;
  }

  async enqueueAlert({ dedupeKey, channel, destination, payload }) {
    const result = await this.pool.query(
      `INSERT INTO alert_outbox (dedupe_key,channel,destination,payload)
       VALUES ($1,$2,$3,$4) ON CONFLICT (dedupe_key) DO NOTHING RETURNING *`,
      [dedupeKey, channel, destination, payload],
    );
    return result.rows[0] ? { ...camelRow(result.rows[0]), inserted: true } : { inserted: false };
  }

  async claimAlerts(limit = 20, now = new Date()) {
    const result = await this.pool.query(
      `WITH claimed AS (
         SELECT id FROM alert_outbox
         WHERE status IN ('pending','retry') AND next_attempt_at <= $1
         ORDER BY id FOR UPDATE SKIP LOCKED LIMIT $2
       )
       UPDATE alert_outbox a SET status='delivering', attempts=a.attempts+1
       FROM claimed WHERE a.id=claimed.id RETURNING a.*`,
      [now, limit],
    );
    return result.rows.map(camelRow);
  }

  async completeAlert(id, { ok, error = null, retryAt = null, permanent = false } = {}) {
    const status = ok ? 'delivered' : permanent ? 'dead' : 'retry';
    const result = await this.pool.query(
      `UPDATE alert_outbox SET status=$2, last_error=$3, next_attempt_at=COALESCE($4,next_attempt_at),
       delivered_at=CASE WHEN $2='delivered' THEN now() ELSE NULL END WHERE id=$1 RETURNING *`,
      [id, status, error, retryAt],
    );
    return result.rows[0] ? camelRow(result.rows[0]) : null;
  }

  async recordMonitorRun(run) {
    await this.pool.query(
      `INSERT INTO monitor_runs (kind,ok,summary,error,checked_at) VALUES ($1,$2,$3,$4,$5)`,
      [run.kind, Boolean(run.ok), run.summary || {}, run.error || null, run.checkedAt || new Date()],
    );
  }

  async saveFidelityRecords(records, checkedAt = new Date().toISOString()) {
    for (const record of records || []) {
      await this.pool.query(
        `INSERT INTO fidelity_records
         (bookmaker,event_id,market_key,outcome,endpoint_price,website_price,status,evidence,checked_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [record.bookmaker, record.eventId || null, record.marketKey, record.outcome,
          finiteOrNull(record.endpointPrice), finiteOrNull(record.websitePrice), record.status,
          record.evidence || {}, record.checkedAt || checkedAt],
      );
    }
  }

  async loadLatestFidelityRecords(maxAgeMs = 6 * 60 * 60_000, now = new Date()) {
    const cutoff = new Date(new Date(now).getTime() - maxAgeMs);
    const result = await this.pool.query(
      `SELECT DISTINCT ON (bookmaker,COALESCE(event_id,''),market_key,outcome) *
       FROM fidelity_records WHERE checked_at >= $1
       ORDER BY bookmaker,COALESCE(event_id,''),market_key,outcome,checked_at DESC`,
      [cutoff],
    );
    return result.rows.map(camelRow);
  }

  async recordSettlement(settlement) {
    const result = await this.pool.query(
      `INSERT INTO settlements
       (subject_type,subject_id,provider,result,home_score,away_score,payload,settled_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (subject_type,subject_id,provider) DO NOTHING RETURNING *`,
      [settlement.subjectType, settlement.subjectId, settlement.provider, settlement.result,
        finiteOrNull(settlement.homeScore), finiteOrNull(settlement.awayScore),
        settlement.payload || {}, settlement.settledAt || new Date()],
    );
    return result.rows[0] ? camelRow(result.rows[0]) : null;
  }

  async prune({ snapshotDays = 7, providerRunDays = 30, monitorDays = 90, fidelityDays = 7 } = {}) {
    const queries = [
      ['snapshots', 'DELETE FROM odds_snapshots WHERE fetched_at < now() - ($1 * interval \'1 day\')', snapshotDays],
      ['providerRuns', 'DELETE FROM provider_runs WHERE checked_at < now() - ($1 * interval \'1 day\')', providerRunDays],
      ['monitorRuns', 'DELETE FROM monitor_runs WHERE checked_at < now() - ($1 * interval \'1 day\')', monitorDays],
      ['fidelityRecords', 'DELETE FROM fidelity_records WHERE checked_at < now() - ($1 * interval \'1 day\')', fidelityDays],
      ['opportunities', `DELETE FROM opportunities WHERE status IN ('expired','settled','rejected') AND last_seen_at < now() - interval '30 days'`, null],
      ['alerts', `DELETE FROM alert_outbox WHERE status IN ('delivered','dead') AND created_at < now() - interval '30 days'`, null],
    ];
    const summary = {};
    for (const [key, sql, days] of queries) {
      const result = await this.pool.query(sql, days === null ? [] : [days]);
      summary[key] = result.rowCount;
    }
    return summary;
  }

  diagnostics() {
    return { type: 'postgres', initialized: this.initialized };
  }
}

function createAutonomyStore(env = process.env) {
  if (env.DATABASE_URL) {
    return new PostgresAutonomyStore({
      connectionString: env.DATABASE_URL,
      ssl: ['1', 'true', 'yes'].includes(String(env.DATABASE_SSL || '').toLowerCase()),
    });
  }
  if (env.NODE_ENV === 'production' && env.AUTONOMY_ENABLED === '1') {
    throw new Error('DATABASE_URL is required when autonomous production mode is enabled');
  }
  return new MemoryAutonomyStore();
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function camelRow(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key.replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase()),
    value,
  ]));
}

function retainSince(rows, field, days, now) {
  const cutoff = new Date(now).getTime() - Math.max(1, Number(days) || 1) * 24 * 60 * 60_000;
  return rows.filter((row) => new Date(row?.[field] || 0).getTime() >= cutoff);
}

module.exports = {
  MemoryAutonomyStore,
  PostgresAutonomyStore,
  createAutonomyStore,
};
