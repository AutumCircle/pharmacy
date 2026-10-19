// Pure helpers for the «Обзор» drill-down. No `@/` or Next.js imports so that
// `node --test` can import this file directly.

export const DRILL_METRICS = ['ordered', 'delivered', 'average_check', 'profit', 'cancelled', 'clients'] as const;

export type DrillMetric = (typeof DRILL_METRICS)[number];

export function parseDrillMetric(value: unknown): DrillMetric | null {
  return typeof value === 'string' && (DRILL_METRICS as readonly string[]).includes(value) ? value as DrillMetric : null;
}

export const DRILL_TITLES: Record<DrillMetric, string> = {
  ordered: 'Заказали',
  delivered: 'Доставлено',
  average_check: 'Средний чек',
  profit: 'Прибыль с товаров',
  cancelled: 'Отменено',
  clients: 'Клиенты',
};

const EXPLANATIONS: Record<DrillMetric, string> = {
  ordered: 'Заказы, созданные за период, в любом статусе (новые, собираются, в пути, доставлены), кроме отменённых. '
    + 'Считаются по дате создания.',
  delivered: 'Заказы со статусом «Доставлен», доставленные за период. Считаются по дате доставки, '
    + 'поэтому сюда попадают и заказы, созданные раньше периода.',
  average_check: 'Средний чек = сумма доставленных заказов ÷ их количество. Ниже — эти доставленные заказы '
    + 'по дате доставки.',
  profit: 'Прибыль каждого доставленного заказа: сумма клиента − цена аптеки × количество. '
    + 'Сначала заказы с наименьшей прибылью, убыточные — вверху.',
  cancelled: 'Отменённые заказы, созданные за период. Считаются по дате создания.',
  clients: 'Уникальные номера телефонов с неотменённым заказом за период. '
    + 'Новый клиент — первый заказ с этого номера сделан в этом периоде.',
};

export function drillExplanation(metric: DrillMetric): string {
  return EXPLANATIONS[metric];
}

function toCents(value: number | string | null | undefined): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

/**
 * Average courier earnings per working day (a day with courier_fee > 0),
 * computed in whole cents and rounded to 0.01.
 */
export function courierAveragePerDay(
  daily: ReadonlyArray<{ courier_fee: number | string | null | undefined }>,
): { average: number; workingDays: number } {
  let totalCents = 0;
  let workingDays = 0;
  for (const day of daily) {
    const cents = toCents(day.courier_fee);
    if (cents > 0) {
      totalCents += cents;
      workingDays += 1;
    }
  }
  return { average: workingDays ? Math.round(totalCents / workingDays) / 100 : 0, workingDays };
}
