/**
 * Webhook dispatcher — sends POST requests to registered webhook URLs
 * when high-edge arbs are detected.
 */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_WEBHOOK_PATH = path.join(__dirname, '..', 'data', 'webhooks.json');

class WebhookManager {
  constructor({ filePath = DEFAULT_WEBHOOK_PATH } = {}) {
    this.filePath = filePath;
  }

  readWebhooks() {
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  addWebhook(url, { minEdge = 0, label = '' } = {}) {
    const webhooks = this.readWebhooks();
    if (webhooks.some((w) => w.url === url)) return webhooks;
    webhooks.push({ url, minEdge, label, createdAt: new Date().toISOString() });
    this._write(webhooks);
    return webhooks;
  }

  removeWebhook(url) {
    const webhooks = this.readWebhooks().filter((w) => w.url !== url);
    this._write(webhooks);
    return webhooks;
  }

  async dispatch(opportunities) {
    const webhooks = this.readWebhooks();
    if (webhooks.length === 0) return;

    for (const webhook of webhooks) {
      const relevant = opportunities.filter((o) => o.edge >= (webhook.minEdge || 0));
      if (relevant.length === 0) continue;

      try {
        const body = JSON.stringify({
          event: 'arb_alert',
          count: relevant.length,
          opportunities: relevant.slice(0, 10).map((o) => ({
            event: o.eventName,
            market: o.marketLabel || o.marketKey,
            edge: o.edge,
            profit: o.profit,
            confidence: o.confidence,
            legs: (o.legs || []).map((l) => ({ outcome: l.label, bookmaker: l.bookmaker, price: l.price })),
          })),
          sentAt: new Date().toISOString(),
        });

        // Use fetch (Node 18+)
        await fetch(webhook.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        // Webhook failed — silently skip
      }
    }
  }

  _write(webhooks) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(webhooks, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }
}

module.exports = { WebhookManager, DEFAULT_WEBHOOK_PATH };
