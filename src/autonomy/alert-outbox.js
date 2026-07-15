'use strict';

const crypto = require('node:crypto');
const { WebhookManager } = require('../finance/webhook-manager');

class DurableAlertOutbox {
  constructor({
    store,
    webhookManager = new WebhookManager(),
    telegramToken = '',
    telegramChatId = '',
    fetchImpl = global.fetch,
    maxAttempts = 8,
    now = () => new Date(),
    logger = null,
  } = {}) {
    if (!store) throw new Error('DurableAlertOutbox requires a store');
    this.store = store;
    this.webhookManager = webhookManager;
    this.telegramToken = telegramToken;
    this.telegramChatId = telegramChatId;
    this.fetchImpl = fetchImpl;
    this.maxAttempts = maxAttempts;
    this.now = now;
    this.logger = logger;
  }

  async queueOpportunity(opportunity) {
    const fingerprint = opportunity?.autonomy?.fingerprint;
    const pricesHash = opportunity?.autonomy?.pricesHash;
    if (!fingerprint || !pricesHash) return 0;
    let queued = 0;
    for (const webhook of this.webhookManager.readWebhooks()) {
      if (Number(opportunity.edge || 0) < Number(webhook.minEdge || 0)) continue;
      const webhookHash = destinationHash(webhook.url);
      const result = await this.store.enqueueAlert({
        dedupeKey: `${fingerprint}:${pricesHash}:webhook:${webhookHash}`,
        channel: 'webhook',
        destination: { webhookHash },
        payload: opportunity,
      });
      if (result.inserted) queued += 1;
    }
    if (this.telegramToken && this.telegramChatId) {
      const result = await this.store.enqueueAlert({
        dedupeKey: `${fingerprint}:${pricesHash}:telegram:${destinationHash(this.telegramChatId)}`,
        channel: 'telegram',
        destination: { chatId: this.telegramChatId },
        payload: opportunity,
      });
      if (result.inserted) queued += 1;
    }
    return queued;
  }

  async dispatchPending(limit = 20) {
    const alerts = await this.store.claimAlerts(limit, this.now());
    const summary = { claimed: alerts.length, delivered: 0, retried: 0, abandoned: 0 };
    for (const alert of alerts) {
      try {
        await this.#deliver(alert);
        await this.store.completeAlert(alert.id, { ok: true });
        summary.delivered += 1;
      } catch (error) {
        const abandoned = Number(alert.attempts || 0) >= this.maxAttempts;
        const retryAt = new Date(this.now().getTime() + retryDelayMs(alert.attempts)).toISOString();
        await this.store.completeAlert(alert.id, {
          ok: false,
          error: abandoned ? `abandoned after ${alert.attempts} attempts: ${error.message}` : error.message,
          retryAt,
          permanent: abandoned,
        });
        if (abandoned) summary.abandoned += 1;
        else summary.retried += 1;
        this.logger?.warn?.('Alert delivery failed', {
          channel: alert.channel,
          attempts: alert.attempts,
          abandoned,
          error: error.message,
        });
      }
    }
    return summary;
  }

  async #deliver(alert) {
    if (alert.channel === 'webhook') {
      const webhook = this.webhookManager.readWebhooks()
        .find((candidate) => destinationHash(candidate.url) === alert.destination?.webhookHash);
      if (!webhook) throw new Error('Webhook destination is no longer configured');
      const response = await this.fetchImpl(webhook.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(webhookPayload(alert.payload)),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error(`Webhook returned HTTP ${response.status}`);
      return;
    }
    if (alert.channel === 'telegram') {
      if (!this.telegramToken) throw new Error('Telegram token is unavailable');
      const response = await this.fetchImpl(`https://api.telegram.org/bot${this.telegramToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: alert.destination?.chatId,
          text: WebhookManager.formatTelegramMessage(alert.payload),
          parse_mode: 'Markdown',
        }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error(`Telegram returned HTTP ${response.status}`);
      return;
    }
    throw new Error(`Unsupported alert channel: ${alert.channel}`);
  }
}

function webhookPayload(opportunity) {
  return {
    event: 'arb_alert',
    count: 1,
    opportunities: [{
      event: opportunity.eventName,
      market: opportunity.marketLabel || opportunity.marketKey,
      edge: opportunity.edge,
      profit: opportunity.profit,
      confidence: opportunity.confidence,
      expiresAt: opportunity.autonomy?.expiresAt,
      legs: (opportunity.legs || []).map((leg) => ({
        outcome: leg.label || leg.outcome,
        bookmaker: leg.bookmaker,
        price: leg.price,
        stake: leg.stake,
        url: leg.url || '',
      })),
    }],
    sentAt: new Date().toISOString(),
  };
}

function destinationHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24);
}

function retryDelayMs(attempts) {
  return Math.min(15 * 60_000, 1_000 * (2 ** Math.max(0, Number(attempts || 1) - 1)));
}

module.exports = {
  DurableAlertOutbox,
  destinationHash,
  retryDelayMs,
  webhookPayload,
};
