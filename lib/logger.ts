/**
 * Minimal structured logger. Single choke point for log output so a remote
 * sink (Sentry, CloudWatch RUM, etc.) can be wired in later without touching
 * every call site — today it writes structured JSON to console, tagged by
 * level and an optional context object for correlation (turn id, person, etc).
 *
 * Also keeps a bounded in-memory ring buffer of recent entries. There's no
 * way to pull `adb logcat` off a user's device in practice, so on-device
 * failures (e.g. conversation mode behaving differently on Android than on
 * web) were previously undiagnosable without physical device access. Settings
 * exposes this buffer via a "Share Diagnostics" action (see settings.tsx) so
 * a user can send it directly instead of describing symptoms secondhand.
 */
type LogContext = Record<string, unknown>;
type LogLevel = 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  ts: string;
  context?: LogContext;
}

const MAX_BUFFER_SIZE = 300;
const buffer: LogEntry[] = [];

function emit(level: LogLevel, message: string, context?: LogContext) {
  const entry: LogEntry = {
    level,
    message,
    ts: new Date().toISOString(),
    ...(context ? { context } : {}),
  };

  buffer.push(entry);
  if (buffer.length > MAX_BUFFER_SIZE) buffer.shift();

  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (message: string, context?: LogContext) => emit('info', message, context),
  warn: (message: string, context?: LogContext) => emit('warn', message, context),
  error: (message: string, error?: unknown, context?: LogContext) =>
    emit('error', message, {
      ...(context || {}),
      error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error,
    }),

  /** Recent log entries (oldest first), newest-N capped at MAX_BUFFER_SIZE. */
  getRecentEntries: (): readonly LogEntry[] => buffer.slice(),

  /** Render the buffer as plain text, suitable for Share/clipboard/email. */
  formatRecentEntries: (): string => {
    if (buffer.length === 0) return '(no log entries captured this session)';
    return buffer
      .map((e) => `[${e.ts}] ${e.level.toUpperCase()} ${e.message}${e.context ? ' ' + JSON.stringify(e.context) : ''}`)
      .join('\n');
  },
};
