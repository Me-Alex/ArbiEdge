/**
 * Webhook Dispatcher & Notification Manager Component.
 */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_WEBHOOK_PATH = path.join(__dirname, '..', '..', 'data', 'webhooks.json');

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

  static formatTelegramMessage(opportunity) {
    const lines = [
      `🚨 *SUREBET DETECTED* (+${(opportunity.edge * 100).toFixed(2)}%)`,
      `⚽ *Match*: ${opportunity.eventName}`,
      `🏆 *Competition*: ${opportunity.competition || 'N/A'}`,
      `📊 *Market*: ${opportunity.marketLabel || opportunity.marketKey}`,
      `💰 *Guaranteed Profit*: ${opportunity.profit} RON (100 RON bankroll)`,
      '',
      '*Legs*:',
      ...(opportunity.legs || []).map(
        (l) => `  • ${l.label} @ *${l.price}* (${l.bookmaker}) - Stake: ${l.stake} RON`
      ),
    ];
    return lines.join('\n');
  }

  static async sendTelegramAlert(botToken, chatId, opportunity) {
    if (!botToken || !chatId || !opportunity) return false;
    const text = WebhookManager.formatTelegramMessage(opportunity);
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
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
