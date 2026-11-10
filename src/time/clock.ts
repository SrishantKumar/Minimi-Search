import { DateTime } from 'luxon';

export interface Clock {
  now(): DateTime;
  nowIso(): string;
  nowMs(): number;
}

export class SystemClock implements Clock {
  now(): DateTime {
    return DateTime.utc();
  }

  nowIso(): string {
    return this.now().toISO() ?? new Date().toISOString();
  }

  nowMs(): number {
    return Date.now();
  }
}

export class FixedClock implements Clock {
  private readonly fixedTime: DateTime;

  constructor(isoStringOrMs: string | number) {
    if (typeof isoStringOrMs === 'string') {
      const parsed = DateTime.fromISO(isoStringOrMs, { zone: 'utc' });
      if (!parsed.isValid) {
        throw new Error(`Invalid ISO date string for FixedClock: ${isoStringOrMs}`);
      }
      this.fixedTime = parsed;
    } else {
      this.fixedTime = DateTime.fromMillis(isoStringOrMs, { zone: 'utc' });
    }
  }

  now(): DateTime {
    return this.fixedTime;
  }

  nowIso(): string {
    return this.fixedTime.toISO() ?? '';
  }

  nowMs(): number {
    return this.fixedTime.toMillis();
  }
}

