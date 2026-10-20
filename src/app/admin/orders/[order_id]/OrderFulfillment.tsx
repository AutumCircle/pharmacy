import type { AdminOrderFulfillment } from '@/lib/api-v1/admin-types';
import type { OrderStatus } from '@/lib/api-v1/types';
import { CHECKLIST_STEPS, isStepDone } from '@/lib/courier-checklist';
import { confirmedAmountText, courierItemAnswerLabel, courierItemAnswerTone } from '@/lib/pharmacy-answers';
import { courierAssemblyLines } from '@/lib/pharmacy-assembly';

const PHARMACY_LABELS: Record<number, string> = { 1: 'Ватан 1', 2: 'Ватан 2' };

/**
 * Job 013: read-only view of the courier checklist and the pharmacies' work on a website order
 * (answers per item, «Сборка сделана» marks, the pharmacy-confirmed sum). No buttons or inputs:
 * the courier and the pharmacies change these in /staff. Hidden for staff-created orders
 * (`fulfillment: null`) and for an older Lambda without the field.
 */
export default function OrderFulfillment({ fulfillment, status, itemNames }: {
  fulfillment: AdminOrderFulfillment; status: OrderStatus; itemNames: Record<number, string>;
}) {
  const checklistOrder = {
    status, website_order: true, own_order: false,
    checklist_steps: Array.isArray(fulfillment.checklist_steps) ? fulfillment.checklist_steps : [],
    pharmacy_answers_complete: fulfillment.pharmacy_answers_complete === true,
  };
  const assembly = courierAssemblyLines({ assembly: fulfillment.assembly });
  const items = Array.isArray(fulfillment.items) ? fulfillment.items : [];
  const done = CHECKLIST_STEPS.filter((step) => isStepDone(checklistOrder, step.step)).length;
  return <section className="od-card od-o1 od-fulfillment" aria-label="Курьер и аптеки">
    <div className="od-card-head"><h2>Курьер и аптеки</h2><span className="od-muted od-small">только просмотр</span></div>

    <div className="od-ff-block">
      <h3>Сборка в аптеках</h3>
      {assembly.length === 0 ? <p className="od-muted od-small">Собирать нечего.</p>
        : <ul className="od-ff-list">{assembly.map((line) => <li key={line.pharmacyId}>
          <span className={`od-ff-chip od-ff-${line.state}`}>{line.text}</span></li>)}</ul>}
    </div>

    <div className="od-ff-block">
      <h3>Ответы аптек</h3>
      <p className={`od-ff-amount${fulfillment.confirmed_total == null ? ' od-ff-amount-wait' : ''}`}>
        {confirmedAmountText(fulfillment)}</p>
      {items.length > 0 && <ul className="od-ff-items">{items.map((item) => {
        const label = courierItemAnswerLabel({ pharmacy_id: item.pharmacy_id, answers: item.answers });
        const tone = courierItemAnswerTone({ pharmacy_id: item.pharmacy_id, answers: item.answers }) ?? 'wait';
        const name = item.medicine_name || itemNames[item.order_item_id] || `Позиция ${item.order_item_id}`;
        return <li key={item.order_item_id}>
          <span className="od-ff-name">{name}</span>
          <span className="od-ff-pharmacy">{PHARMACY_LABELS[item.pharmacy_id ?? 1] ?? `Аптека ${item.pharmacy_id}`}</span>
          {label && <span className={`od-ff-chip od-ff-tone-${tone}`}>{label}</span>}
        </li>;
      })}</ul>}
    </div>

    <div className="od-ff-block">
      <h3>Чек-лист курьера <span className="od-muted">· {done} из {CHECKLIST_STEPS.length}</span></h3>
      <ol className="od-ff-checklist">{CHECKLIST_STEPS.map((step) => {
        const stepDone = isStepDone(checklistOrder, step.step);
        return <li key={step.step} className={stepDone ? 'done' : ''}>
          <span className="od-ff-check" aria-hidden="true">{stepDone ? '✓' : step.step}</span>
          <span>{step.title}<span className="sr-only">{stepDone ? ' — выполнено' : ' — не выполнено'}</span></span>
        </li>;
      })}</ol>
    </div>
  </section>;
}
