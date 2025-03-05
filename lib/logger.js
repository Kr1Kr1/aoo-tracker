import { createLogger, format, transports } from "winston";

// Read log level from the environment or use a default
const logLevel = process.env.LOG_LEVEL || "info";

const logger = createLogger({
  level: logLevel,
  format: format.combine(
    format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    format.printf(({ timestamp, level, message }) => `[${timestamp}] ${level.toUpperCase()}: ${message}`)
  ),
  transports: [
    new transports.Console(),
    new transports.File({ filename: "logs/app.log" }),
  ],
});

// Allow changing the log level dynamically
logger.setLevel = (level) => {
  logger.level = level;
  logger.info(`Logger level changed to: ${level}`);
};

export { logger };
