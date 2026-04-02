const isDebug = process.env.DEBUG === 'true';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function log(level: LogLevel, context: string, message: string, data?: unknown) {
  if (level === 'debug' && !isDebug) return;

  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}] [${context}]`;
  const output = data !== undefined ? `${prefix} ${message} ${JSON.stringify(data)}` : `${prefix} ${message}`;

  if (level === 'error' || level === 'warn') {
    process.stderr.write(output + '\n');
  } else {
    process.stderr.write(output + '\n');
  }
}

export class Logger {
  private context: string;

  private constructor(context: string) {
    this.context = context;
  }

  static forContext(context: string): Logger {
    return new Logger(context);
  }

  debug(message: string, data?: unknown) {
    log('debug', this.context, message, data);
  }

  info(message: string, data?: unknown) {
    log('info', this.context, message, data);
  }

  warn(message: string, data?: unknown) {
    log('warn', this.context, message, data);
  }

  error(message: string, data?: unknown) {
    log('error', this.context, message, data);
  }
}
