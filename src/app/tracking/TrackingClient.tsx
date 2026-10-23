'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { PublicOrder } from '@/lib/api-v1/types';
import { PublicReadError, trackOrdersClient } from '@/lib/api-v1/client-reads';
import { parseTrackingPhone } from '@/lib/tracking-phone';
import { formatOrderDate, formatOrderDateTime, parseOrderTime } from '@/lib/order-time';
import {
  ORDER_STAGE_HINTS, ORDER_STAGE_LABELS, TRACKING_STEPS, isFinishedStage, orderStage, trackingStepIndex,
} from '@/lib/order-stage';
import { formatTajikPhone, loadSiteContactSettings } from '@/lib/contact-settings';
import { CHECKOUT_PHONE_LOCAL_LENGTH, applyCheckoutPhoneEdit, formatCheckoutPhoneInput } from '@/lib/checkout-phone';
import { formatSom, paymentMethodLabel } from '@/lib/checkout-order';
import MedicineThumb from '@/components/MedicineThumb';

// One lookup a minute stays well inside the per-IP tracking limit (5 a minute) and the scrape guard.
const REFRESH_MS = 60_000;

function newestFirst(orders: PublicOrder[]): PublicOrder[] {
  return [...orders].sort((left, right) => {
    const difference = parseOrderTime(right.created_at).getTime() - parseOrderTime(left.created_at).getTime();
    return difference || right.order_id.localeCompare(left.order_id);
  });
}

function quantityLabel(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value).replace('.', ',');
}

function BoxIcon({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7l9-4 9 4v10l-9 4-9-4z" /><path d="M3 7l9 4 9-4M12 11v10" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" />
    </svg>
  );
}

function PhoneEntry({ onSubmit, error, loading }: { onSubmit: (digits: string) => void; error: string; loading: boolean }) {
  const [digits, setDigits] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (caret.current === null || document.activeElement !== inputRef.current) return;
    inputRef.current?.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });
  const done = digits.length === CHECKOUT_PHONE_LOCAL_LENGTH;
  return (
    <div className="orders-entry">
      <span className="orders-entry-icon"><BoxIcon size={36} /></span>
      <div>
        <h2>Где мой заказ?</h2>
        <p>Введите номер, который указали при оформлении</p>
      </div>
      <form className="orders-entry-form" onSubmit={(event) => { event.preventDefault(); onSubmit(digits); }}>
        <label className="checkout-field">
          <span>Телефон</span>
          <span className={`checkout-phone${done ? ' is-complete' : ''}`}>
            <span className="checkout-phone-prefix" aria-hidden="true">+992</span>
            <input ref={inputRef} type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="900 00 00 00"
              aria-label="Номер телефона: код +992 и 9 цифр номера" value={formatCheckoutPhoneInput(digits)}
              aria-invalid={Boolean(error)} aria-describedby={error ? 'orders-phone-error' : undefined}
              onChange={(event) => {
                const result = applyCheckoutPhoneEdit({ previousDigits: digits, value: event.target.value,
                  selectionStart: event.target.selectionStart, inputType: (event.nativeEvent as InputEvent)?.inputType ?? '' });
                caret.current = result.caret;
                setDigits(result.digits);
              }} />
            <span className="checkout-phone-count" aria-live="polite">{digits.length}/{CHECKOUT_PHONE_LOCAL_LENGTH}</span>
          </span>
        </label>
        {error && <span id="orders-phone-error" className="checkout-field-error" role="alert">{error}</span>}
        <button type="submit" className="checkout-submit-button" disabled={loading || !done}>
          {loading ? <><span className="checkout-spinner" aria-hidden="true" />Ищем заказы…</> : 'Показать заказы'}
        </button>
      </form>
    </div>
  );
}

function OrderListItem({ order, current }: { order: PublicOrder; current: boolean }) {
  const stage = orderStage(order);
  const step = trackingStepIndex(order);
  const finished = isFinishedStage(stage);
  return (
    <Link href={`/tracking?order=${encodeURIComponent(order.order_id)}`} scroll={false}
      className={`orders-card${finished ? ' is-finished' : ''}${current ? ' is-current' : ''}`} aria-current={current ? 'page' : undefined}>
      <span className="orders-card-top">
        <span className="orders-card-title">
          <strong>№ {order.order_reference}</strong>
          <span>{formatOrderDate(order.created_at)}</span>
        </span>
        <span className={`orders-pill is-${stage}`}>{ORDER_STAGE_LABELS[stage]}</span>
      </span>
      {!finished && (
        <span className="orders-bars" aria-hidden="true">
          {TRACKING_STEPS.map((id, index) => <span key={id} className={index <= step ? 'is-on' : undefined} />)}
        </span>
      )}
      <span className="orders-card-bottom">
        <span className="orders-thumbs">
          {order.items.slice(0, 3).map((item, index) => (
            <MedicineThumb key={`${item.medicine_id ?? 'legacy'}-${index}`} url={item.image_url} name={item.medicine_name} />
          ))}
          {order.items.length > 3 && <span className="orders-more">+{order.items.length - 3}</span>}
        </span>
        <strong className="orders-card-total">{formatSom(order.order_total)}</strong>
      </span>
    </Link>
  );
}

function OrderDetail({ order, contactPhone, onBack }: { order: PublicOrder; contactPhone: string | null; onBack: () => void }) {
  const stage = orderStage(order);
  const step = trackingStepIndex(order);
  const finished = stage === 'delivered';
  return (
    <article className="order-card" aria-labelledby="order-card-title">
      <div className="order-card-head">
        <button type="button" className="checkout-back order-card-back" onClick={onBack} aria-label="Назад к списку заказов">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div>
          <h2 id="order-card-title">Заказ № {order.order_reference}</h2>
          <span>Оформлен {formatOrderDateTime(order.created_at)}</span>
        </div>
      </div>

      <section className="order-card-status" aria-live="polite">
        <div className="order-card-hero">
          <span className={`order-card-hero-icon is-${stage}`}><BoxIcon /></span>
          <span>
            <strong className={`order-card-stage is-${stage}`}>{ORDER_STAGE_LABELS[stage]}</strong>
            <span>{ORDER_STAGE_HINTS[stage]}</span>
          </span>
        </div>
        {step >= 0 && (
          <ol className="order-steps" aria-label="Этапы заказа">
            {TRACKING_STEPS.map((id, index) => {
              const done = index < step || (finished && index === step);
              const currentStep = index === step && !finished;
              return (
                <li key={id} className={`${done ? 'is-done' : ''}${currentStep ? ' is-current' : ''}`} aria-current={currentStep ? 'step' : undefined}>
                  <span className="order-step-dot" aria-hidden="true">
                    {done && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
                  </span>
                  <span className="order-step-label">{ORDER_STAGE_LABELS[id]}</span>
                </li>
              );
            })}
          </ol>
        )}
        {!isFinishedStage(stage) && (
          <span className="order-card-live"><span aria-hidden="true" />Статус обновляется сам</span>
        )}
      </section>

      {contactPhone && (
        <section className="order-card-help" aria-label="Вопрос по заказу">
          <span>
            <strong>Вопрос по заказу?</strong>
            <span>{formatTajikPhone(contactPhone)}</span>
          </span>
          <a href={`tel:${contactPhone}`} className="order-card-call"><PhoneIcon />Позвонить</a>
        </section>
      )}

      <section className="order-card-items" aria-labelledby="order-card-items-title">
        <h3 id="order-card-items-title">Состав заказа</h3>
        <ul>
          {order.items.map((item, index) => (
            <li key={`${item.medicine_id ?? 'legacy'}-${index}`}>
              <MedicineThumb url={item.image_url} name={item.medicine_name} />
              <span className="order-item-text">
                {item.medicine_id == null
                  ? <span>{item.medicine_name}</span>
                  : <a href={`/medicine/${item.medicine_id}`}>{item.medicine_name}</a>}
                <span className="order-item-qty">{quantityLabel(Number(item.quantity))} шт.</span>
              </span>
              <strong>{formatSom(item.line_total)}</strong>
            </li>
          ))}
        </ul>
        <div className="order-card-total"><span>Итого</span><strong>{formatSom(order.order_total)}</strong></div>
      </section>

      <dl className="order-card-details">
        <div><dt>Оплата</dt><dd>{paymentMethodLabel(order.payment_method)}</dd></div>
        <div><dt>Доставка</dt><dd>оплачивается курьеру</dd></div>
      </dl>
    </article>
  );
}

export default function TrackingClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get('order');
  const [phone, setPhone] = useState<{ normalized: string; display: string } | null>(null);
  const [ready, setReady] = useState(false);
  const [orders, setOrders] = useState<PublicOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [contactPhone, setContactPhone] = useState<string | null>(null);
  const lastFetch = useRef(0);

  const fetchOrders = useCallback(async (normalized: string, force: boolean, quiet = false) => {
    if (!quiet) setLoading(true);
    lastFetch.current = Date.now();
    try {
      const data = await trackOrdersClient(normalized, force);
      setOrders(newestFirst(data.data || []));
      setError('');
      setLoaded(true);
    } catch (fetchError) {
      // A failed background refresh keeps the orders already shown.
      if (quiet) return;
      setOrders([]);
      setLoaded(true);
      setError(fetchError instanceof PublicReadError && fetchError.status === 429 && fetchError.serverMessage
        ? fetchError.serverMessage : 'Не удалось загрузить заказы. Проверьте интернет и попробуйте ещё раз.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSiteContactSettings().then((settings) => setContactPhone(settings.delivery_contact_phone)).catch(() => undefined);
    const timer = window.setTimeout(() => {
      let saved: string | null = null;
      try {
        saved = localStorage.getItem('userPhone');
      } catch {
        saved = null;
      }
      const parsed = saved ? parseTrackingPhone(saved) : null;
      if (parsed?.valid && parsed.normalized) {
        setPhone({ normalized: parsed.normalized, display: `+992 ${formatCheckoutPhoneInput(parsed.localDigits)}` });
        void fetchOrders(parsed.normalized, false);
      } else if (saved) {
        try {
          localStorage.removeItem('userPhone');
        } catch {
          // Nothing to remove without storage.
        }
      }
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchOrders]);

  // Quiet refresh once a minute while the page is visible, and at once when the tab comes back.
  useEffect(() => {
    if (!phone) return undefined;
    const refresh = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastFetch.current >= REFRESH_MS - 1000) {
        void fetchOrders(phone.normalized, true, true);
      }
    };
    const interval = window.setInterval(refresh, REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [phone, fetchOrders]);

  const submitPhone = (digits: string) => {
    const parsed = parseTrackingPhone(digits);
    if (!parsed.valid || !parsed.normalized) {
      setError(parsed.error || 'Введите все 9 цифр номера.');
      return;
    }
    try {
      localStorage.setItem('userPhone', parsed.localDigits);
    } catch {
      // The number is only remembered as a convenience.
    }
    setPhone({ normalized: parsed.normalized, display: `+992 ${formatCheckoutPhoneInput(parsed.localDigits)}` });
    void fetchOrders(parsed.normalized, true);
  };

  const changePhone = () => {
    try {
      localStorage.removeItem('userPhone');
    } catch {
      // Nothing to remove without storage.
    }
    setPhone(null);
    setOrders([]);
    setLoaded(false);
    setError('');
    router.replace('/tracking', { scroll: false });
  };

  const selected = selectedId ? orders.find((order) => order.order_id === selectedId) ?? null : null;
  const desktopSelected = selected ?? orders[0] ?? null;
  const active = orders.filter((order) => !isFinishedStage(orderStage(order)));
  const finished = orders.filter((order) => isFinishedStage(orderStage(order)));
  const backToList = () => router.push('/tracking', { scroll: false });

  useEffect(() => {
    if (selected) window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [selected?.order_id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) return <div className="container orders-shell" aria-busy="true" />;

  return (
    <div className={`container orders-shell${selected ? ' has-selection' : ''}`}>
      <div className="orders-head">
        <h1>Мои заказы</h1>
        {phone && (
          <span className="orders-phone">
            {phone.display}
            <button type="button" onClick={changePhone}>Сменить номер</button>
          </span>
        )}
      </div>

      {!phone ? (
        <PhoneEntry onSubmit={submitPhone} error={error} loading={loading} />
      ) : loading && !loaded ? (
        <p className="orders-message" role="status">Загружаем заказы…</p>
      ) : error ? (
        <div className="orders-message" role="alert">
          <p>{error}</p>
          <button type="button" className="cart-secondary-button" onClick={() => void fetchOrders(phone.normalized, true)}>Попробовать ещё раз</button>
        </div>
      ) : orders.length === 0 ? (
        <div className="orders-message">
          <p>По номеру {phone.display} заказов пока нет.</p>
          <Link href="/" className="cart-primary-button is-inline">Перейти к покупкам</Link>
        </div>
      ) : (
        <div className="orders-layout">
          <nav className="orders-list" aria-label="Список заказов">
            {selectedId && !selected && (
              <p className="orders-message is-inline" role="status">Этот заказ не найден для номера {phone.display}.</p>
            )}
            {active.length > 0 && <h2 className="orders-group-title">Сейчас в работе</h2>}
            {active.map((order) => <OrderListItem key={order.order_id} order={order} current={order.order_id === desktopSelected?.order_id} />)}
            {finished.length > 0 && <h2 className="orders-group-title">Завершённые</h2>}
            {finished.map((order) => <OrderListItem key={order.order_id} order={order} current={order.order_id === desktopSelected?.order_id} />)}
          </nav>
          <div className="orders-detail">
            {desktopSelected && <OrderDetail order={desktopSelected} contactPhone={contactPhone} onBack={backToList} />}
          </div>
        </div>
      )}
    </div>
  );
}
