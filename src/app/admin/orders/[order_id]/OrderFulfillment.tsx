import type { AdminOrderFulfillment } from '@/lib/api-v1/admin-types';
import type { OrderStatus } from '@/lib/api-v1/types';
import { CHECKLIST_STEPS, isStepDone } from '@/lib/courier-checklist';
import { courierAssemblyLines } from '@/lib/pharmacy-assembly';

/**
 * Job 013, re-ordered in job 016: read-only courier checklist and the pharmacies' «Сборка сделана»
 * marks of a website order, right under the client card. The pharmacies' per-item answers and the
 * confirmed sum moved to the items table (OrderItems). No buttons or inputs: the courier and the
 * pharmacies change these in /staff. Hidden for staff-created orders (`fulfillment: null`) and for an
 * older Lambda without the field.
 */
export default function OrderFulfillment({ fulfillment, status }: {
  fulfillment: AdminOrderFulfillment; status: OrderStatus;
}) {
  const checklistOrder = {
    status, website_order: true, own_order: false,
    checklist_steps: Array.isArray(fulfillment.checklist_steps) ? fulfillment.checklist_steps : [],
    pharmacy_answers_complete: fulfillment.pharmacy_answers_complete === true,
  };
  const assembly = courierAssemblyLines({ assembly: fulfillment.assembly });
  const done = CHECKLIST_STEPS.filter((step) => isStepDone(checklistOrder, step.step)).length;
  return <section className="od-card od-o2 od-fulfillment" aria-label="Курьер и аптеки">
    <div className="od-card-head"><h2>Курьер и аптеки</h2><span className="od-muted od-small">только просмотр</span></div>

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

    <div className="od-ff-block">
      <h3>Сборка в аптеках</h3>
      {assembly.length === 0 ? <p className="od-muted od-small">Собирать нечего.</p>
        : <ul className="od-ff-list od-ff-inline">{assembly.map((line) => <li key={line.pharmacyId}>
          <span className={`od-ff-chip od-ff-${line.state}`}>{line.text}</span></li>)}</ul>}
    </div>
  </section>;
}
