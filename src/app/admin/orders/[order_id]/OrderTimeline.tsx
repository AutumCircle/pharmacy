import type { AdminStatusHistory } from '@/lib/api-v1/admin-types';
import { formatOrderDateTime } from '@/lib/order-time';
import {
  TIMELINE_TRUNCATED_TEXT, timelineActorLabel, timelineEventText, timelineEvents,
} from '@/lib/order-timeline';
import { statusLabels } from '../ui';

const legacyActorLabels: Record<string, string> = { customer: 'клиент', admin: 'админ', staff: 'сотрудник', system: 'система' };

/**
 * Job 016: the order's history — creation, status changes, pharmacy answers and price changes,
 * assembly marks, courier checklist steps and every admin/courier edit — oldest first. The Lambda
 * sends whitelisted events (`timeline`); an older Lambda without it falls back to the status history.
 */
export default function OrderTimeline({ timeline, truncated, statusHistory }: {
  timeline: unknown; truncated?: boolean; statusHistory: AdminStatusHistory[];
}) {
  const events = timelineEvents(timeline);
  if (!Array.isArray(timeline)) {
    return <ol className="od-history">
      {statusHistory.map((entry, index) => <li key={`${entry.created_at}-${index}`}>
        <span className="od-dot" />
        <div><strong>{entry.from_status ? `${statusLabels[entry.from_status]} → ` : 'Создан · '}{statusLabels[entry.to_status]}</strong>
          <small>{formatOrderDateTime(entry.created_at)} · {legacyActorLabels[entry.actor_type] ?? entry.actor_type}
            {entry.actor_id ? ` ${entry.actor_id}` : ''}</small>
          {entry.reason && <p>{entry.reason}</p>}</div>
      </li>)}
    </ol>;
  }
  if (events.length === 0) return <p className="od-muted od-small">Событий пока нет.</p>;
  return <>
    {truncated && <p className="od-muted od-small">{TIMELINE_TRUNCATED_TEXT}</p>}
    <ol className="od-history">
      {events.map((event, index) => <li key={`${event.at}-${index}`}>
        <span className={`od-dot od-dot-${event.actor}`} />
        <div><strong>{timelineEventText(event)}</strong>
          <small><time dateTime={event.at}>{formatOrderDateTime(event.at)}</time> · {timelineActorLabel(event)}</small>
          {event.kind === 'status_changed' && event.reason && <p>{event.reason}</p>}</div>
      </li>)}
    </ol>
  </>;
}
