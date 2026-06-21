const path = require('node:path');
const express = require('express');

function createApp({
  oddsService,
  liveConfigured,
  logger = console,
  publicDirectory = path.join(__dirname, '..', 'public'),
}) {
  const app = express();
  app.disable('x-powered-by');

  app.get('/api/health', (request, response) => {
    response.json({
      status: 'ok',
      provider: liveConfigured ? 'live' : 'demo',
    });
  });

  app.get('/api/odds', async (request, response) => {
    try {
      if (request.query.refresh === '1') {
        oddsService.clearCache?.();
      }

      response.json(await oddsService.getOdds());
    } catch (error) {
      logger.error('Unable to load odds', error);
      response.status(500).json({ error: 'Unable to load odds' });
    }
  });

  app.use(express.static(publicDirectory));

  app.use('/api', (request, response) => {
    response.status(404).json({ error: 'API route not found' });
  });

  return app;
}

module.exports = { createApp };
