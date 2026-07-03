'use client';

import {
  HOUR_OPTIONS, DAY_OPTIONS, STORE_TZ_LABEL,
  describeSchedule, type Frequency,
} from '../lib/schedule';

/**
 * Friendly schedule picker shared by the create & edit feed forms.
 * Works on flat react-hook-form fields: freq, everyHours, timeOfDay, dayOfWeek, cronExpr.
 * The parent computes the final cron expression from these via scheduleToCron() on submit.
 */
export function ScheduleFields({ register, watch }: { register: any; watch: any }) {
  const freq: Frequency = watch('freq');
  const everyHours = Number(watch('everyHours'));
  const timeOfDay = watch('timeOfDay');
  const dayOfWeek = Number(watch('dayOfWeek'));
  const cronExpr = watch('cronExpr');

  const summary = describeSchedule({ freq, everyHours, timeOfDay, dayOfWeek, cronExpr });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">How often?</label>
          <select
            {...register('freq')}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="hourly">Every hour</option>
            <option value="everyNHours">Every few hours</option>
            <option value="daily">Every day</option>
            <option value="weekly">Every week</option>
            <option value="custom">Custom (advanced)</option>
          </select>
        </div>

        {freq === 'everyNHours' && (
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Interval</label>
            <select
              {...register('everyHours')}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {HOUR_OPTIONS.map((h) => (
                <option key={h} value={h}>Every {h} hours</option>
              ))}
            </select>
          </div>
        )}

        {(freq === 'daily' || freq === 'weekly') && (
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">
              Time ({STORE_TZ_LABEL})
            </label>
            <input
              type="time"
              {...register('timeOfDay')}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        )}
      </div>

      {freq === 'weekly' && (
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">Day of week</label>
          <select
            {...register('dayOfWeek')}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {DAY_OPTIONS.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </div>
      )}

      {freq === 'custom' && (
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">Cron expression (UTC)</label>
          <input
            {...register('cronExpr')}
            placeholder="0 */6 * * *"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <p className="text-xs text-gray-400 mt-1">
            5-field cron. Examples: <code>0 */6 * * *</code> (every 6h), <code>0 9 * * *</code> (daily 9 AM UTC)
          </p>
        </div>
      )}

      <p className="text-xs text-brand-700 bg-brand-50 border border-brand-100 rounded-md px-3 py-2">
        Runs <strong>{summary}</strong>.
      </p>
    </div>
  );
}
