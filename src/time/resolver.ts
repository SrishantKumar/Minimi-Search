import { DateTime } from 'luxon';
import * as chrono from 'chrono-node';
import type { TemporalFrame, TemporalRef } from '../core/events.js';

export interface TemporalResolverOptions {
  now?: DateTime | string;
  tz?: string;
}

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export class TemporalResolver {
  resolve(text: string, options?: TemporalResolverOptions): TemporalFrame {
    const tz = options?.tz || 'UTC';
    let baseNow: DateTime;

    if (options?.now instanceof DateTime) {
      baseNow = options.now.setZone(tz);
    } else if (typeof options?.now === 'string') {
      baseNow = DateTime.fromISO(options.now, { zone: 'utc' }).setZone(tz);
    } else {
      baseNow = DateTime.utc().setZone(tz);
    }

    if (!baseNow.isValid) {
      baseNow = DateTime.utc().setZone(tz);
    }

    const refs: TemporalRef[] = [];
    let usesSince = false;

    // Check for anaphoric "since then" / "since that" or standalone "since"
    if (/\bsince\b/i.test(text)) {
      usesSince = true;
      if (/\bsince\s+(then|that|our last conversation|we spoke)\b/i.test(text)) {
        refs.push({
          surface: text.match(/\bsince\s+(then|that|our last conversation|we spoke)\b/i)![0],
          kind: 'anaphoric',
          start: baseNow.toUTC().toISO() ?? '',
          end: baseNow.toUTC().toISO() ?? '',
          humanLabel: 'Recalled as-of date (anaphoric)',
          confidence: 0.95,
        });
      }
    }

    // Specialized deterministic pass for weekday expressions ("on Monday", "last Tuesday")
    const weekdayRegex = /\b(?:(last|this|past|on)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi;
    let match: RegExpExecArray | null;

    while ((match = weekdayRegex.exec(text)) !== null) {
      const surface = match[0];
      const prefix = (match[1] || '').toLowerCase();
      const targetDayName = match[2].toLowerCase();
      const targetDayNum = WEEKDAYS.indexOf(targetDayName) + 1; // 1 = Monday, 7 = Sunday (Luxon convention)

      let resolvedDate: DateTime;
      const currentWeekday = baseNow.weekday;

      if (prefix === 'last') {
        // "last Tuesday": Tuesday strictly before today
        let daysAgo = (currentWeekday - targetDayNum + 7) % 7;
        if (daysAgo === 0) daysAgo = 7;
        resolvedDate = baseNow.minus({ days: daysAgo });
      } else {
        // "on Monday" or bare "Monday": most recent past occurrence
        let daysAgo = (currentWeekday - targetDayNum + 7) % 7;
        if (daysAgo === 0) {
          daysAgo = 0; // Same day
        }
        resolvedDate = baseNow.minus({ days: daysAgo });
      }

      const dayStart = resolvedDate.startOf('day').toUTC().toISO() ?? '';
      const dayEnd = resolvedDate.endOf('day').toUTC().toISO() ?? '';
      const humanLabel = resolvedDate.toFormat('cccc d LLL yyyy');

      // Create alternate (previous week's day) if ambiguous
      const altDate = resolvedDate.minus({ days: 7 });
      const alternates = [
        {
          start: altDate.startOf('day').toUTC().toISO() ?? '',
          end: altDate.endOf('day').toUTC().toISO() ?? '',
          humanLabel: altDate.toFormat('cccc d LLL yyyy'),
        },
      ];

      refs.push({
        surface,
        kind: 'relative',
        start: dayStart,
        end: dayEnd,
        humanLabel,
        confidence: prefix === 'last' ? 0.95 : 0.85,
        alternates,
      });
    }

    // Chrono pass for absolute and other relative expressions (e.g. "3 November", "yesterday", "2 weeks ago")
    const referenceDate = baseNow.toJSDate();
    const parsedChrono = chrono.parse(text, referenceDate, { forwardDate: false });

    for (const item of parsedChrono) {
      const surface = item.text;
      // Skip if already captured by the weekday parser
      if (refs.some((r) => r.surface.toLowerCase().includes(surface.toLowerCase()))) {
        continue;
      }

      const jsDate = item.start.date();
      let dt = DateTime.fromJSDate(jsDate, { zone: tz });

      // Ambiguity rule: if no year was explicitly stated in text and parsed date is in the future, push to past year
      if (!item.start.isCertain('year') && dt > baseNow) {
        dt = dt.minus({ years: 1 });
      }

      const dayStart = dt.startOf('day').toUTC().toISO() ?? '';
      const dayEnd = dt.endOf('day').toUTC().toISO() ?? '';

      const isAbsolute = item.start.isCertain('day') && item.start.isCertain('month');

      refs.push({
        surface,
        kind: isAbsolute ? 'absolute' : 'relative',
        start: dayStart,
        end: dayEnd,
        humanLabel: dt.toFormat('cccc d LLL yyyy'),
        confidence: isAbsolute ? 0.95 : 0.85,
      });
    }

    return {
      now: baseNow.toUTC().toISO() ?? '',
      tz,
      refs,
      usesSince,
    };
  }
}
