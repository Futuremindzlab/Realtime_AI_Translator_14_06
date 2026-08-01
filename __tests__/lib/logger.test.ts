import { logger } from '@/lib/logger';

describe('logger', () => {
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    error = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const parse = (spy: jest.SpyInstance) => JSON.parse(spy.mock.calls[0][0] as string);

  it('writes info as structured JSON on console.log', () => {
    logger.info('started');

    const entry = parse(log);
    expect(entry.level).toBe('info');
    expect(entry.message).toBe('started');
    expect(Number.isNaN(Date.parse(entry.ts))).toBe(false);
    expect(entry).not.toHaveProperty('context');
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('includes the context object when one is given', () => {
    logger.warn('slow turn', { turnId: 7, person: 'A' });

    expect(parse(warn)).toMatchObject({
      level: 'warn',
      message: 'slow turn',
      context: { turnId: 7, person: 'A' },
    });
  });

  it('serialises an Error into name/message/stack under context.error', () => {
    const cause = new Error('boom');
    logger.error('translation failed', cause, { turnId: 3 });

    const entry = parse(error);
    expect(entry.level).toBe('error');
    expect(entry.context.turnId).toBe(3);
    expect(entry.context.error).toMatchObject({ name: 'Error', message: 'boom' });
    expect(typeof entry.context.error.stack).toBe('string');
  });

  it('passes non-Error rejection values through as-is', () => {
    logger.error('failed', { status: 500 });

    expect(parse(error).context.error).toEqual({ status: 500 });
  });
});
