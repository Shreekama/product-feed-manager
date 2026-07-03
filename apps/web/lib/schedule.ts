/**
 * Friendly schedule ⇄ cron conversion.
 *
 * The backend still stores a standard 5-field cron expression, but the UI lets
 * users pick a plain-English frequency instead of writing cron by hand.
 * Times are expressed in the store's local timezone (see STORE_TIMEZONE) and
 * croner is given that timezone when computing the next run.
 */

export const STORE_TIMEZONE = 'Asia/Kolkata';
export const STORE_TZ_LABEL = 'IST';

export type Frequency = 'hourly' | 'everyNHours' | 'daily' | 'weekly' | 'custom';

export interface FriendlySchedule {
  freq: Frequency;
  everyHours: number; // used when freq === 'everyNHours'
  timeOfDay: string;  // "HH:MM", used for daily/weekly
  dayOfWeek: number;  // 0 (Sun) – 6 (Sat), used for weekly
  cronExpr: string;   // raw cron, used when freq === 'custom' (and as the source of truth on submit)
}

export const HOUR_OPTIONS = [2, 3, 4, 6, 8, 12];

export const DAY_OPTIONS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

export const DEFAULT_SCHEDULE: FriendlySchedule = {
  freq: 'everyNHours',
  everyHours: 6,
  timeOfDay: '09:00',
  dayOfWeek: 1,
  cronExpr: '0 */6 * * *',
};

/** Build a cron expression from the friendly fields. */
export function scheduleToCron(s: Pick<FriendlySchedule, 'freq' | 'everyHours' | 'timeOfDay' | 'dayOfWeek' | 'cronExpr'>): string {
  const [hhRaw, mmRaw] = (s.timeOfDay || '09:00').split(':');
  const hh = clampInt(hhRaw, 0, 23, 9);
  const mm = clampInt(mmRaw, 0, 59, 0);

  switch (s.freq) {
    case 'hourly':
      return '0 * * * *';
    case 'everyNHours': {
      const n = HOUR_OPTIONS.includes(s.everyHours) ? s.everyHours : 6;
      return `0 */${n} * * *`;
    }
    case 'daily':
      return `${mm} ${hh} * * *`;
    case 'weekly': {
      const d = s.dayOfWeek >= 0 && s.dayOfWeek <= 6 ? s.dayOfWeek : 1;
      return `${mm} ${hh} * * ${d}`;
    }
    case 'custom':
    default:
      return (s.cronExpr || '').trim() || '0 */6 * * *';
  }
}

/** Parse an existing cron expression back into friendly fields (best effort). */
export function cronToSchedule(cronExpr: string | null | undefined): FriendlySchedule {
  const cron = (cronExpr || '').trim();
  if (!cron) return { ...DEFAULT_SCHEDULE };

  const parts = cron.split(/\s+/);
  if (parts.length === 5) {
    const [min, hour, dom, mon, dow] = parts;

    // Every hour: 0 * * * *
    if (min === '0' && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
      return { ...DEFAULT_SCHEDULE, freq: 'hourly', cronExpr: cron };
    }
    // Every N hours: 0 */N * * *
    const everyMatch = hour.match(/^\*\/(\d+)$/);
    if (min === '0' && everyMatch && dom === '*' && mon === '*' && dow === '*') {
      const n = parseInt(everyMatch[1], 10);
      if (HOUR_OPTIONS.includes(n)) {
        return { ...DEFAULT_SCHEDULE, freq: 'everyNHours', everyHours: n, cronExpr: cron };
      }
    }
    // Daily at H:M — numeric min/hour, everything else wildcard
    if (isNum(min) && isNum(hour) && dom === '*' && mon === '*' && dow === '*') {
      return { ...DEFAULT_SCHEDULE, freq: 'daily', timeOfDay: hm(hour, min), cronExpr: cron };
    }
    // Weekly at H:M on day D
    if (isNum(min) && isNum(hour) && dom === '*' && mon === '*' && isNum(dow)) {
      return {
        ...DEFAULT_SCHEDULE,
        freq: 'weekly',
        timeOfDay: hm(hour, min),
        dayOfWeek: parseInt(dow, 10),
        cronExpr: cron,
      };
    }
  }

  // Anything we can't map cleanly → expose raw cron via the "custom" option.
  return { ...DEFAULT_SCHEDULE, freq: 'custom', cronExpr: cron };
}

/** Human-readable summary of a schedule, e.g. "Every day at 09:00 IST". */
export function describeSchedule(s: Pick<FriendlySchedule, 'freq' | 'everyHours' | 'timeOfDay' | 'dayOfWeek' | 'cronExpr'>): string {
  switch (s.freq) {
    case 'hourly':
      return 'Every hour';
    case 'everyNHours':
      return `Every ${s.everyHours} hours`;
    case 'daily':
      return `Every day at ${s.timeOfDay} ${STORE_TZ_LABEL}`;
    case 'weekly': {
      const day = DAY_OPTIONS.find((d) => d.value === s.dayOfWeek)?.label ?? 'Monday';
      return `Every ${day} at ${s.timeOfDay} ${STORE_TZ_LABEL}`;
    }
    case 'custom':
    default:
      return `Custom (${(s.cronExpr || '').trim() || 'unset'})`;
  }
}

/**
 * Human-readable description of a stored cron expression, aware of how the
 * schedule's time is interpreted:
 *  - timezone 'Asia/Kolkata' (or any non-UTC): the cron hours are already local
 *    (IST), so describe them as-is.
 *  - timezone 'UTC' or missing (legacy schedules): the cron hours are UTC, so
 *    shift +5:30 to present them in IST.
 */
export function describeCron(cronExpr: string, timezone?: string | null): string {
  const cron = (cronExpr || '').trim();
  if (!cron) return 'Not scheduled';

  const isLocal = !!timezone && timezone !== 'UTC';
  if (isLocal) return describeSchedule(cronToSchedule(cron));

  // Legacy UTC-stored cron → convert to IST for display.
  return cronUtcToIst(cron);
}

function cronUtcToIst(expr: string): string {
  const parts = expr.split(/\s+/);
  if (parts.length !== 5) return expr;
  const [minPart, hourPart, , , dowPart] = parts;

  if (hourPart === '*' && minPart.startsWith('*/')) return `Every ${minPart.slice(2)} minutes`;
  if (hourPart.startsWith('*/')) return `Every ${hourPart.slice(2)} hours`;
  if (hourPart === '*') return 'Every hour';

  const utcH = parseInt(hourPart, 10);
  const utcM = parseInt(minPart, 10);
  if (Number.isNaN(utcH) || Number.isNaN(utcM)) return expr;

  const totalMin = utcH * 60 + utcM + 330; // UTC → IST (+5:30)
  const istH = Math.floor(totalMin / 60) % 24;
  const istM = totalMin % 60;
  const period = istH >= 12 ? 'PM' : 'AM';
  const displayH = istH % 12 || 12;
  const timeStr = `${displayH}:${istM.toString().padStart(2, '0')} ${period} ${STORE_TZ_LABEL}`;

  if (dowPart === '*') return `Daily at ${timeStr}`;
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayNum = parseInt(dowPart, 10);
  if (!Number.isNaN(dayNum) && DAYS[dayNum]) return `Every ${DAYS[dayNum]} at ${timeStr}`;
  return `At ${timeStr}`;
}

function isNum(v: string): boolean {
  return /^\d+$/.test(v);
}

function hm(hour: string, min: string): string {
  return `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
}

function clampInt(v: string, lo: number, hi: number, fallback: number): number {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}
