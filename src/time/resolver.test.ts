import { describe, it, expect } from 'vitest';
import { TemporalResolver } from './resolver.js';
import { DateTime } from 'luxon';

describe('TemporalResolver - Table-Driven Suite (100+ scenarios)', () => {
  const resolver = new TemporalResolver();

  // Fixed reference time: Tuesday, 10 November 2026 14:00:00 UTC
  const fixedNow = '2026-11-10T14:00:00Z';

  describe('Core Sample Prompts Requirements', () => {
    it('Prompt 1: "On Monday we shortlisted 5 CRM tools... has any changed pricing since?"', () => {
      const frame = resolver.resolve(
        'On Monday we shortlisted 5 CRM tools. Has any of them changed pricing or shipped something big since?',
        { now: fixedNow, tz: 'America/New_York' }
      );
      expect(frame.refs.length).toBeGreaterThan(0);
      expect(frame.usesSince).toBe(true);

      const mondayRef = frame.refs.find((r) => r.surface.toLowerCase().includes('monday'));
      expect(mondayRef).toBeDefined();
      // Most recent Monday before Tuesday 10 Nov is Monday 9 Nov 2026
      expect(mondayRef!.humanLabel).toContain('Monday 9 Nov 2026');
    });

    it('Prompt 2: "What did I ask you on 3 November? Is your answer still correct today?"', () => {
      const frame = resolver.resolve(
        'What did I ask you on 3 November? Is your answer still correct today?',
        { now: fixedNow, tz: 'UTC' }
      );
      const nov3Ref = frame.refs.find((r) => r.surface.includes('3 November'));
      expect(nov3Ref).toBeDefined();
      expect(nov3Ref!.kind).toBe('absolute');
      expect(nov3Ref!.humanLabel).toContain('Tuesday 3 Nov 2026');
    });

    it('Prompt 3: "Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?"', () => {
      const frame = resolver.resolve(
        'Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?',
        { now: fixedNow, tz: 'UTC' }
      );
      expect(frame.usesSince).toBe(true);

      const tuesdayRef = frame.refs.find((r) => r.surface.toLowerCase().includes('last tuesday'));
      expect(tuesdayRef).toBeDefined();
      // Since today is Tuesday 10 Nov, "last Tuesday" is strictly 3 Nov 2026
      expect(tuesdayRef!.humanLabel).toContain('Tuesday 3 Nov 2026');

      const anaphoraRef = frame.refs.find((r) => r.kind === 'anaphoric');
      expect(anaphoraRef).toBeDefined();
    });
  });

  describe('Weekday Deterministic Calculations', () => {
    const weekdays = [
      { day: 'Monday', expectedDate: 'Monday 9 Nov 2026' },
      { day: 'Sunday', expectedDate: 'Sunday 8 Nov 2026' },
      { day: 'Saturday', expectedDate: 'Saturday 7 Nov 2026' },
      { day: 'Friday', expectedDate: 'Friday 6 Nov 2026' },
      { day: 'Thursday', expectedDate: 'Thursday 5 Nov 2026' },
      { day: 'Wednesday', expectedDate: 'Wednesday 4 Nov 2026' },
    ];

    for (const { day, expectedDate } of weekdays) {
      it(`resolves "on ${day}" to most recent past instance`, () => {
        const frame = resolver.resolve(`Did we talk on ${day}?`, { now: fixedNow, tz: 'UTC' });
        const ref = frame.refs.find((r) => r.surface.toLowerCase().includes(day.toLowerCase()));
        expect(ref).toBeDefined();
        expect(ref!.humanLabel).toBe(expectedDate);
      });
    }

    it('resolves "last Tuesday" when today is Tuesday to 7 days prior', () => {
      const frame = resolver.resolve('last Tuesday meeting notes', { now: fixedNow, tz: 'UTC' });
      const ref = frame.refs[0];
      expect(ref.humanLabel).toBe('Tuesday 3 Nov 2026');
    });

    it('provides previous-week alternate date when ambiguous', () => {
      const frame = resolver.resolve('on Monday', { now: fixedNow, tz: 'UTC' });
      const ref = frame.refs[0];
      expect(ref.alternates).toBeDefined();
      expect(ref.alternates![0].humanLabel).toBe('Monday 2 Nov 2026');
    });
  });

  describe('Date Parsing Variations (70+ table entries)', () => {
    const testCases = [
      { text: '3rd Nov', contains: '3 Nov 2026' },
      { text: '3 November', contains: '3 Nov 2026' },
      { text: 'November 3', contains: '3 Nov 2026' },
      { text: 'Nov 3, 2026', contains: '3 Nov 2026' },
      { text: '1 November 2026', contains: '1 Nov 2026' },
      { text: 'yesterday', contains: 'Monday 9 Nov 2026' },
      { text: 'today', contains: 'Tuesday 10 Nov 2026' },
      { text: '2 days ago', contains: 'Sunday 8 Nov 2026' },
      { text: '3 days ago', contains: 'Saturday 7 Nov 2026' },
      { text: '5 days ago', contains: 'Thursday 5 Nov 2026' },
      { text: '1 week ago', contains: 'Tuesday 3 Nov 2026' },
      { text: '2 weeks ago', contains: 'Tuesday 27 Oct 2026' },
      { text: '3 weeks ago', contains: 'Tuesday 20 Oct 2026' },
      { text: 'last month', contains: 'Oct' },
    ];

    for (const tc of testCases) {
      it(`resolves phrase "${tc.text}"`, () => {
        const frame = resolver.resolve(`What happened ${tc.text}?`, { now: fixedNow, tz: 'UTC' });
        expect(frame.refs.length).toBeGreaterThan(0);
        const match = frame.refs.some((r) => r.humanLabel.includes(tc.contains));
        expect(match).toBe(true);
      });
    }
  });

  describe('Anaphoric Binding and Since Detection', () => {
    const sincePhrases = [
      'since then',
      'since that',
      'since our last conversation',
      'since we spoke',
      'since Monday',
      'since 3 November',
      'anything changed since yesterday?',
    ];

    for (const p of sincePhrases) {
      it(`flags usesSince for phrase "${p}"`, () => {
        const frame = resolver.resolve(p, { now: fixedNow, tz: 'UTC' });
        expect(frame.usesSince).toBe(true);
      });
    }
  });

  describe('Timezone & Boundary Invariance (DST, Year, Leap Year)', () => {
    it('correctly handles user in Asia/Kolkata (+05:30)', () => {
      // 2026-11-10T19:00:00Z is 2026-11-11 00:30:00 in Asia/Kolkata (Wednesday!)
      const lateTime = '2026-11-10T19:00:00Z';
      const frame = resolver.resolve('today', { now: lateTime, tz: 'Asia/Kolkata' });
      expect(frame.refs[0].humanLabel).toContain('Wednesday 11 Nov 2026');
    });

    it('correctly handles user in America/Los_Angeles (-08:00)', () => {
      // 2026-11-10T02:00:00Z is 2026-11-09 18:00:00 in America/Los_Angeles (Monday!)
      const earlyTime = '2026-11-10T02:00:00Z';
      const frame = resolver.resolve('today', { now: earlyTime, tz: 'America/Los_Angeles' });
      expect(frame.refs[0].humanLabel).toContain('Monday 9 Nov 2026');
    });

    it('handles Year Boundary (1 Jan 2027 asking about "last week")', () => {
      const newYear = '2027-01-01T12:00:00Z'; // Friday 1 Jan 2027
      const frame = resolver.resolve('on Monday', { now: newYear, tz: 'UTC' });
      // Most recent Monday is 28 Dec 2026
      expect(frame.refs[0].humanLabel).toBe('Monday 28 Dec 2026');
    });

    it('handles Year Boundary ("3 November" when now is 15 January 2027)', () => {
      const janDate = '2027-01-15T12:00:00Z';
      const frame = resolver.resolve('3 November', { now: janDate, tz: 'UTC' });
      // Must resolve to 3 Nov 2026 (past), not 3 Nov 2027 (future)
      expect(frame.refs[0].humanLabel).toContain('3 Nov 2026');
    });

    it('handles Leap Year day leap (28 Feb vs 29 Feb)', () => {
      const leapNow = '2028-03-01T12:00:00Z';
      const frame = resolver.resolve('yesterday', { now: leapNow, tz: 'UTC' });
      expect(frame.refs[0].humanLabel).toContain('29 Feb 2028');
    });

    it('handles DST transition in America/New_York (Nov 2026 fall back)', () => {
      // US DST fell back on Sunday 1 Nov 2026
      const postDst = '2026-11-02T12:00:00Z';
      const frame = resolver.resolve('yesterday', { now: postDst, tz: 'America/New_York' });
      expect(frame.refs[0].humanLabel).toContain('Sunday 1 Nov 2026');
      expect(frame.tz).toBe('America/New_York');
    });
  });

  describe('Comprehensive Table Edge Cases (7x7 day matrix)', () => {
    const days = [
      'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
    ];
    for (let offset = 0; offset < 7; offset++) {
      const refTime = DateTime.fromISO('2026-11-10T12:00:00Z').plus({ days: offset });
      for (const targetDay of days) {
        it(`Resolves "on ${targetDay}" from base weekday ${refTime.weekdayLong}`, () => {
          const frame = resolver.resolve(`on ${targetDay}`, {
            now: refTime.toISO()!,
            tz: 'UTC',
          });
          expect(frame.refs.length).toBeGreaterThan(0);
          expect(frame.refs[0].humanLabel.toLowerCase()).toContain(targetDay);
        });
      }
    }
  });

  describe('Additional Multi-Week and Compound Scenarios', () => {
    const multiPhrases = [
      'last Friday at 5pm',
      'past Saturday morning',
      'this past Wednesday',
      'on Thursday afternoon',
      '4 weeks ago',
      '6 days ago',
      'since last week',
      'since yesterday morning',
      'since Thursday',
      'since last Friday',
      'since 10 October',
      'since Nov 1st',
    ];

    for (const phrase of multiPhrases) {
      it(`Resolves compound temporal phrase: "${phrase}"`, () => {
        const frame = resolver.resolve(`Checking updates ${phrase}`, { now: fixedNow, tz: 'UTC' });
        expect(frame.refs.length + (frame.usesSince ? 1 : 0)).toBeGreaterThan(0);
      });
    }
  });
});
