#!/usr/bin/env node
/**
 * VWAP Scalper Bot - Main Entry Point - Functional Style
 */
import { createBot, runBot, stopBot } from './bot.js';
import { loadConfig } from './config.js';
import { logger } from './utils/logger.js';
import express from 'express';

async function main() {
  logger.info('='.repeat(60));
  logger.info('VWAP Scalper Bot Starting...');
  logger.info(`Start Time: ${new Date().toLocaleString()}`);
  logger.info('='.repeat(60));

  // Health check server for cloud hosting
  const app = express();
  const port = process.env.PORT || 3000;
  
  app.get('/', (req, res) => {
    res.send('VWAP Scalper Bot is Running');
  });

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date() });
  });

  app.listen(port, () => {
    logger.info(`Health check server listening on port ${port}`);
  });

  try {
    // Load configuration
    const config = loadConfig();
    logger.info('Configuration loaded successfully');

    // Initialize bot
    const bot = createBot(config);
    logger.info('Bot initialized successfully');

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('\n' + '='.repeat(60));
      logger.info('Shutdown signal received...');
      await stopBot(bot);
      logger.info('Bot stopped successfully');
      logger.info('='.repeat(60));
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Termination signal received...');
      await stopBot(bot);
      process.exit(0);
    });

    // Run bot
    await runBot(bot);
  } catch (error) {
    logger.error('Fatal error:', error);
    process.exit(1);
  }
}

main();
