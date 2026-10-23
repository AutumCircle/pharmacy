'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CartItem } from '@/context/CartContext';
import type { CreateOrderRequest, CreateOrderResponse, PublicOrder } from '@/lib/api-v1/types';
import MedicineThumb from '@/components/MedicineThumb';
import {
  CHECKOUT_PHONE_LOCAL_LENGTH,
  applyCheckoutPhoneEdit,
  formatCheckoutPhoneInput,
  isCompleteCheckoutPhone,
  normalizeCheckoutPhoneInput,
} from '@/lib/checkout-phone';
import {
  CHECKOUT_PAYMENT_OPTIONS,
  type CheckoutPaymentMethod,
  type DeliveryAddress,
  formatSom,
  minimumOrderShortfall,
  parseSavedAddresses,
} from '@/lib/checkout-order';

const PENDING_ORDER_KEY = 'vatan_pending_order_v1';
const IN_PROGRESS_RETRIES = 3;
const IN_PROGRESS_DELAY_MS = 1500;

function orderFingerprint(value: string): string {
  // This fingerprint only matches a pending retry with the same payload. It is
  // not used for authentication, so it must also work on local HTTP origins
  // where mobile browsers do not expose crypto.subtle.
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

function createIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The same payload keeps its key across retries and reloads of this tab, so the server answers with the
 * order it already made instead of a second one. */
function idempotencyKeyFor(requestHash: string): string {
  let key = createIdempotencyKey();
  try {
    const pending = JSON.parse(sessionStorage.getItem(PENDING_ORDER_KEY) || 'null') as { requestHash?: string; idempotencyKey?: string } | null;
    if (pending?.requestHash === requestHash && pending.idempotencyKey) key = pending.idempotencyKey;
    sessionStorage.setItem(PENDING_ORDER_KEY, JSON.stringify({ requestHash, idempotencyKey: key }));
  } catch {
    // Private mode without storage: one key per attempt; the server still blocks a repeat within 10 minutes.
  }
  return key;
}

const ERROR_MESSAGES: Record<string, string> = {
  ORDER_ITEMS_UNAVAILABLE: 'Некоторые лекарства закончились. Вернитесь в корзину и уберите их.',
  MEDICINE_NOT_FOUND: 'Некоторые лекарства больше не найдены в каталоге. Вернитесь в корзину.',
  MINIMUM_ORDER_NOT_REACHED: 'После проверки актуальных цен сумма заказа меньше 50 с.',
  IDEMPOTENCY_CONFLICT: 'Данные заказа изменились. Нажмите «Оформить заказ» ещё раз.',
  IDEMPOTENCY_IN_PROGRESS: 'Заказ ещё обрабатывается. Подождите несколько секунд и проверьте «Мои заказы».',
  RATE_LIMITED: 'Слишком много попыток оформить заказ. Подождите несколько минут и попробуйте снова — корзина и данные сохранены.',
};

type FieldErrors = Partial<Record<'name' | 'address' | 'phone', string>>;
const NEW_ADDRESS = -1;

type Props = {
  items: CartItem[];
  totalPrice: number;
  totalItems: number;
  onBack: () => void;
  onSuccess: (order: PublicOrder, phoneDigits: string, address: DeliveryAddress, customerName: string) => void;
};

export default function CheckoutView({ items, totalPrice, totalItems, onBack, onSuccess }: Props) {
  const [name, setName] = useState('');
  const [phoneDigits, setPhoneDigits] = useState('');
  const [savedAddresses, setSavedAddresses] = useState<DeliveryAddress[]>([]);
  const [addressChoice, setAddressChoice] = useState(NEW_ADDRESS);
  const [newAddress, setNewAddress] = useState<DeliveryAddress>({ address: '', landmark: '' });
  const [payment, setPayment] = useState<CheckoutPaymentMethod>('cash_on_delivery');
  const [comment, setComment] = useState('');
  const [commentOpen, setCommentOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const phoneRef = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      let legacyAddress = '';
      try {
        const saved = JSON.parse(localStorage.getItem('vatan_customer') || 'null') as { name?: string; phone?: string; address?: string } | null;
        if (saved) {
          setName(typeof saved.name === 'string' ? saved.name : '');
          setPhoneDigits(normalizeCheckoutPhoneInput(typeof saved.phone === 'string' ? saved.phone : ''));
          legacyAddress = typeof saved.address === 'string' ? saved.address : '';
        }
      } catch {
        // A broken entry is ignored; the customer types the details again.
      }
      let addresses: DeliveryAddress[] = [];
      try {
        addresses = parseSavedAddresses(localStorage.getItem('vatan_addresses'));
      } catch {
        addresses = [];
      }
      if (!addresses.length && legacyAddress) addresses = parseSavedAddresses(JSON.stringify([legacyAddress]));
      setSavedAddresses(addresses);
      setAddressChoice(addresses.length ? 0 : NEW_ADDRESS);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useLayoutEffect(() => {
    const input = phoneRef.current;
    if (pendingCaret.current === null || !input || document.activeElement !== input) return;
    input.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  });

  const handlePhone = (event: React.ChangeEvent<HTMLInputElement>) => {
    const native = event.nativeEvent as InputEvent;
    const result = applyCheckoutPhoneEdit({
      previousDigits: phoneDigits,
      value: event.target.value,
      selectionStart: event.target.selectionStart,
      inputType: native?.inputType ?? '',
    });
    pendingCaret.current = result.caret;
    setPhoneDigits(result.digits);
    if (fieldErrors.phone) setFieldErrors((current) => ({ ...current, phone: undefined }));
  };

  const deliveryAddress = (): DeliveryAddress => (
    addressChoice === NEW_ADDRESS || !savedAddresses[addressChoice]
      ? { address: newAddress.address.trim(), landmark: newAddress.landmark.trim() }
      : savedAddresses[addressChoice]
  );

  // The message appears right above the «Оформить заказ» button, which stays on screen (pinned on a phone,
  // in the sticky summary on a computer), so the page does not jump.
  const showError = (message: string) => setFormError(message);

  const validate = (): FieldErrors => {
    const errors: FieldErrors = {};
    if (name.trim().length < 2) errors.name = 'Введите имя — хотя бы 2 буквы.';
    if (!isCompleteCheckoutPhone(phoneDigits)) errors.phone = `Введите все ${CHECKOUT_PHONE_LOCAL_LENGTH} цифр номера.`;
    if (deliveryAddress().address.length < 5) errors.address = 'Укажите улицу и дом — хотя бы 5 символов.';
    return errors;
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // A second tap, Enter or a double click while the first request runs does nothing.
    if (submittingRef.current) return;
    const errors = validate();
    setFieldErrors(errors);
    const firstInvalid = (['address', 'name', 'phone'] as const).find((field) => errors[field]);
    if (firstInvalid) {
      setFormError(null);
      const id = firstInvalid === 'address' ? 'checkout-new-address' : `checkout-${firstInvalid}`;
      if (firstInvalid === 'address' && addressChoice !== NEW_ADDRESS) setAddressChoice(NEW_ADDRESS);
      window.requestAnimationFrame(() => {
        const element = document.getElementById(id);
        element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        element?.focus({ preventScroll: true });
      });
      return;
    }
    if (minimumOrderShortfall(totalPrice) > 0) {
      showError('Минимальная сумма заказа — 50 с. Вернитесь в корзину и добавьте товары.');
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setFormError(null);
    const address = deliveryAddress();
    const order: CreateOrderRequest = {
      customer_name: name.trim(),
      phone: phoneDigits,
      address: address.address,
      landmark: address.landmark || null,
      payment_method: payment,
      comment: comment.trim() || null,
      items: items.map((item) => ({ medicine_id: item.medicine_id, quantity: item.quantity })),
    };
    const body = JSON.stringify(order);
    const idempotencyKey = idempotencyKeyFor(orderFingerprint(body));
    try {
      localStorage.setItem('vatan_customer', JSON.stringify({ name: order.customer_name, phone: phoneDigits }));
    } catch {
      // Remembering the customer is a convenience only.
    }

    try {
      for (let attempt = 0; ; attempt += 1) {
        const response = await fetch('/api/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
          body,
        });
        if (response.ok) {
          const payload = await response.json() as CreateOrderResponse;
          try {
            sessionStorage.removeItem(PENDING_ORDER_KEY);
          } catch {
            // Nothing to clean up without storage.
          }
          onSuccess(payload.data, phoneDigits, address, order.customer_name);
          return;
        }
        const payload = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
        const code = payload?.error?.code || '';
        // The first request with this key is still running on the server: ask again with the same key.
        if (code === 'IDEMPOTENCY_IN_PROGRESS' && attempt < IN_PROGRESS_RETRIES) {
          await new Promise((resolve) => window.setTimeout(resolve, IN_PROGRESS_DELAY_MS));
          continue;
        }
        showError(ERROR_MESSAGES[code] || payload?.error?.message || 'Не удалось оформить заказ. Повторите попытку.');
        break;
      }
    } catch {
      showError('Нет связи с сервером. Проверьте интернет и нажмите «Оформить заказ» ещё раз — второй заказ не создастся.');
    }
    submittingRef.current = false;
    setSubmitting(false);
  };

  const total = formatSom(totalPrice);
  const count = Number.isInteger(totalItems) ? totalItems : totalItems.toFixed(1);
  const phoneCount = phoneDigits.length;
  const phoneDone = phoneCount === CHECKOUT_PHONE_LOCAL_LENGTH;

  const itemsList = (
    <ul className="checkout-items">
      {items.map((item) => (
        <li key={item.medicine_id}>
          <MedicineThumb url={item.image_url} name={item.medicine_name} />
          <span className="checkout-item-text">
            <span className="checkout-item-name">{item.medicine_name}</span>
            <span className="checkout-item-qty">{item.quantity} × {formatSom(item.selling_unit_price)}</span>
          </span>
          <strong>{formatSom(item.selling_unit_price * item.quantity)}</strong>
        </li>
      ))}
    </ul>
  );

  const submitButton = (
    <button type="submit" className="checkout-submit-button" disabled={submitting} aria-busy={submitting}>
      {submitting ? (<><span className="checkout-spinner" aria-hidden="true" />Отправляем заказ…</>) : `Оформить заказ · ${total}`}
    </button>
  );

  return (
    <form className="checkout-page" onSubmit={submit} noValidate>
      <div className="checkout-head">
        <button type="button" className="checkout-back" onClick={onBack} disabled={submitting} aria-label="Назад в корзину">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <h1>Оформление заказа</h1>
      </div>

      <fieldset className="checkout-grid" disabled={submitting}>
        <div className="checkout-main">
          <section className="checkout-card checkout-items-phone" aria-labelledby="checkout-items-phone">
            <div className="checkout-card-head">
              <h2 id="checkout-items-phone">Ваш заказ</h2>
              <button type="button" className="checkout-link" onClick={onBack}>Изменить</button>
            </div>
            {itemsList}
          </section>

          <section className="checkout-card" aria-labelledby="checkout-address-title">
            <h2 id="checkout-address-title">Куда доставить</h2>
            <div className="checkout-address-options">
              {savedAddresses.map((entry, index) => (
                <label key={`${entry.address}-${entry.landmark}`} className={`checkout-option${addressChoice === index ? ' is-selected' : ''}`}>
                  <input type="radio" name="delivery_address" checked={addressChoice === index} onChange={() => setAddressChoice(index)} />
                  <span className="checkout-option-text">
                    <span className="checkout-option-title">{entry.address}</span>
                    <span className="checkout-option-hint">{entry.landmark ? `Ориентир: ${entry.landmark}` : 'Без ориентира'}</span>
                  </span>
                </label>
              ))}
              {savedAddresses.length > 0 && (
                <label className={`checkout-option${addressChoice === NEW_ADDRESS ? ' is-selected' : ''}`}>
                  <input type="radio" name="delivery_address" checked={addressChoice === NEW_ADDRESS} onChange={() => setAddressChoice(NEW_ADDRESS)} />
                  <span className="checkout-option-text">
                    <span className="checkout-option-title">Новый адрес</span>
                    <span className="checkout-option-hint">Адрес и ориентир — отдельно</span>
                  </span>
                </label>
              )}
            </div>
            {addressChoice === NEW_ADDRESS && (
              <div className="checkout-fields-two">
                <label className="checkout-field">
                  <span>Адрес — улица, дом, квартира</span>
                  <input id="checkout-new-address" type="text" name="address" autoComplete="street-address" maxLength={500}
                    placeholder="Например: ул. Рудаки 45, кв. 8" value={newAddress.address}
                    aria-invalid={Boolean(fieldErrors.address)} aria-describedby={fieldErrors.address ? 'checkout-address-error' : undefined}
                    onChange={(event) => {
                      setNewAddress((current) => ({ ...current, address: event.target.value }));
                      if (fieldErrors.address) setFieldErrors((current) => ({ ...current, address: undefined }));
                    }} />
                  {fieldErrors.address && <span id="checkout-address-error" className="checkout-field-error" role="alert">{fieldErrors.address}</span>}
                </label>
                <label className="checkout-field">
                  <span>Ориентир (необязательно)</span>
                  <input type="text" name="landmark" maxLength={300} autoComplete="off"
                    placeholder="Например: рядом с магазином «Ёвар»" value={newAddress.landmark}
                    onChange={(event) => setNewAddress((current) => ({ ...current, landmark: event.target.value }))} />
                </label>
              </div>
            )}
          </section>

          <section className="checkout-card" aria-labelledby="checkout-contacts-title">
            <h2 id="checkout-contacts-title">Контакты</h2>
            <div className="checkout-fields-two">
              <label className="checkout-field">
                <span>Имя</span>
                <input id="checkout-name" type="text" name="customer_name" autoComplete="name" maxLength={120} value={name}
                  aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? 'checkout-name-error' : undefined}
                  onChange={(event) => {
                    setName(event.target.value);
                    if (fieldErrors.name) setFieldErrors((current) => ({ ...current, name: undefined }));
                  }} />
                {fieldErrors.name && <span id="checkout-name-error" className="checkout-field-error" role="alert">{fieldErrors.name}</span>}
              </label>
              <label className="checkout-field">
                <span>Телефон</span>
                <span className={`checkout-phone${phoneDone ? ' is-complete' : ''}${fieldErrors.phone ? ' is-invalid' : ''}`}>
                  <span className="checkout-phone-prefix" aria-hidden="true">+992</span>
                  <input ref={phoneRef} id="checkout-phone" type="tel" name="phone" inputMode="numeric" autoComplete="tel-national"
                    aria-label="Номер телефона: код +992 и 9 цифр номера" placeholder="900 00 00 00"
                    value={formatCheckoutPhoneInput(phoneDigits)} onChange={handlePhone}
                    aria-invalid={Boolean(fieldErrors.phone)}
                    aria-describedby={`checkout-phone-count${fieldErrors.phone ? ' checkout-phone-error' : ''}`} />
                  <span id="checkout-phone-count" className="checkout-phone-count" aria-live="polite">
                    {phoneDone && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
                    )}
                    {phoneCount}/{CHECKOUT_PHONE_LOCAL_LENGTH}
                  </span>
                </span>
                {fieldErrors.phone && <span id="checkout-phone-error" className="checkout-field-error" role="alert">{fieldErrors.phone}</span>}
              </label>
            </div>
          </section>

          <section className="checkout-card" aria-labelledby="checkout-payment-title">
            <h2 id="checkout-payment-title">Оплата при получении</h2>
            <div className="checkout-payment-options">
              {CHECKOUT_PAYMENT_OPTIONS.map((option) => (
                <label key={option.value} className={`checkout-option${payment === option.value ? ' is-selected' : ''}`}>
                  <input type="radio" name="payment_method" value={option.value} checked={payment === option.value}
                    onChange={() => setPayment(option.value)} />
                  <span className="checkout-option-icon" aria-hidden="true">
                    {option.value === 'cash_on_delivery'
                      ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></svg>
                      : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="6" y="2" width="12" height="20" rx="2.5" /><path d="M10 18h4" /></svg>}
                  </span>
                  <span className="checkout-option-text">
                    <span className="checkout-option-title">{option.title}</span>
                    <span className="checkout-option-hint">{option.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>

          <section className="checkout-card checkout-comment">
            {commentOpen ? (
              <label className="checkout-field">
                <span>Комментарий к заказу</span>
                <textarea name="comment" rows={3} maxLength={500} value={comment} autoFocus onChange={(event) => setComment(event.target.value)} />
              </label>
            ) : (
              <button type="button" className="checkout-comment-toggle" onClick={() => setCommentOpen(true)} aria-expanded={false}>
                Комментарий к заказу
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              </button>
            )}
          </section>
        </div>

        <aside className="checkout-card checkout-summary" aria-labelledby="checkout-summary-title">
          <h2 id="checkout-summary-title">Ваш заказ</h2>
          <div className="checkout-summary-items">{itemsList}</div>
          <div className="checkout-summary-rows">
            <div><span>Товары, {count} шт.</span><strong>{total}</strong></div>
            <div><span>Доставка</span><span>оплачивается курьеру</span></div>
            <div className="checkout-summary-total"><span>Итого</span><strong>{total}</strong></div>
          </div>
          <div className="checkout-submit-desktop">
            {formError && <div className="checkout-error" role="alert">{formError}</div>}
            {submitButton}
          </div>
        </aside>
      </fieldset>

      <div className="checkout-submit-bar">
        {formError && <div className="checkout-error" role="alert">{formError}</div>}
        {submitButton}
        {submitting && <p className="checkout-submit-note" role="status">Не закрывайте страницу — это займёт пару секунд</p>}
      </div>
    </form>
  );
}
