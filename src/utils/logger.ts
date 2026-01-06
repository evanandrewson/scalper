/**
 * Logging configuration using Winston
 */
import winston from 'winston';
import chalk from 'chalk';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const { combine, timestamp, printf, errors } = winston.format;

// Custom format for console output
const consoleFormat = printf(({ level, message, timestamp, stack }) => {
  const ts = new Date(timestamp as string).toLocaleTimeString();

  let levelColor = level;
  if (level.includes('info')) levelColor = chalk.green(level);
  else if (level.includes('warn')) levelColor = chalk.yellow(level);
  else if (level.includes('error')) levelColor = chalk.red(level);
  else if (level.includes('debug')) levelColor = chalk.cyan(level);

  return `${chalk.gray(ts)} | ${levelColor} | ${message}${stack ? '\n' + stack : ''}`;
});

// Custom format for file output
const fileFormat = printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} | ${level.toUpperCase().padEnd(7)} | ${message}${stack ? '\n' + stack : ''}`;
});

// Create logs directory if it doesn't exist
const logsDir = join(process.cwd(), 'logs');
if (!existsSync(logsDir)) {
  mkdirSync(logsDir, { recursive: true });
}

// Create logger instance
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(errors({ stack: true }), timestamp()),
  transports: [
    // Console transport
    new winston.transports.Console({
      format: combine(consoleFormat),
    }),
    // File transport for all logs
    new winston.transports.File({
      filename: join(logsDir, 'bot.log'),
      format: combine(fileFormat),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Separate file for errors
    new winston.transports.File({
      filename: join(logsDir, 'error.log'),
      level: 'error',
      format: combine(fileFormat),
      maxsize: 5242880,
      maxFiles: 5,
    }),
  ],
});

// Add method for trade logging
export const tradeLogger = winston.createLogger({
  level: 'info',
  format: combine(timestamp(), fileFormat),
  transports: [
    new winston.transports.File({
      filename: join(logsDir, 'trades.log'),
      maxsize: 10485760, // 10MB
      maxFiles: 10,
    }),
  ],
});
