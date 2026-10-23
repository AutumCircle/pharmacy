'use client';

import Link from 'next/link';
import type { CartItem } from '@/context/CartContext';
import MedicineThumb from '@/components/MedicineThumb';
import { formatSom, minimumOrderShortfall } from '@/lib/checkout-order';

type Props = {
  items: CartItem[];
  totalItems: number;
  onCheckout: () => void;
  onRemove: (medicineId: number) => void;
  onQuantity: (medicineId: number, quantity: number) => void;
  onClear: () => void;
};

function quantityLabel(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace('.', ',');
}

function TrashIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

/** Cart: phone rows (round photo, total, outlined counter whose «−» turns into a bin at 1) and the
 * desktop rows kept as they are in production; one summary with the 50 с. minimum notice. */
export default function CartView({ items, totalItems, onCheckout, onRemove, onQuantity, onClear }: Props) {
  const available = items.filter((item) => item.in_stock);
  const unavailableCount = items.length - available.length;
  const availableTotal = available.reduce((sum, item) => sum + item.selling_unit_price * item.quantity, 0);
  const availableCount = available.reduce((sum, item) => sum + item.quantity, 0);
  const shortfall = minimumOrderShortfall(availableTotal);
  const canOrder = available.length > 0 && shortfall === 0;

  const clear = () => {
    if (window.confirm('Очистить корзину?')) onClear();
  };
  const action = canOrder ? (
    <button type="button" className="cart-primary-button" onClick={onCheckout}>
      <span>Оформить заказ</span><span className="cart-primary-sum">{formatSom(availableTotal)}</span>
    </button>
  ) : (
    <Link href="/catalog" className="cart-secondary-button">Добавить товары</Link>
  );

  return (
    <div className="cart-page">
      <div className="cart-page-head">
        <h1>Корзина <span>· {quantityLabel(totalItems)} шт.</span></h1>
        <button type="button" className="cart-clear" onClick={clear}>Очистить</button>
      </div>

      <div className="cart-grid">
        <div className="cart-items">
          {items.map((item) => {
            const lineTotal = item.selling_unit_price * item.quantity;
            const atOne = item.quantity <= 1;
            return (
              <article key={item.medicine_id} className={`cart-row${item.in_stock ? '' : ' is-unavailable'}`}>
                {/* Phone (variant E) */}
                <div className="cart-row-phone">
                  <MedicineThumb url={item.image_url} name={item.medicine_name} className="is-round" />
                  <div className="cart-row-info">
                    <a href={`/medicine/${item.medicine_id}`} className="cart-row-name">{item.medicine_name}</a>
                    {item.in_stock
                      ? <span className="cart-row-total">{formatSom(lineTotal)}</span>
                      : <span className="cart-badge-unavailable">Нет в наличии</span>}
                  </div>
                  {item.in_stock ? (
                    <div className="cart-stepper" role="group" aria-label={`Количество: ${item.medicine_name}`}>
                      {atOne ? (
                        <button type="button" aria-label="Удалить из корзины" onClick={() => onRemove(item.medicine_id)}>
                          <TrashIcon size={16} />
                        </button>
                      ) : (
                        <button type="button" aria-label="Меньше" onClick={() => onQuantity(item.medicine_id, item.quantity - 1)}>−</button>
                      )}
                      <span aria-live="polite">{quantityLabel(item.quantity)}</span>
                      <button type="button" aria-label="Больше" disabled={item.quantity >= 99}
                        onClick={() => onQuantity(item.medicine_id, item.quantity + 1)}>+</button>
                    </div>
                  ) : (
                    <button type="button" className="cart-remove-pill" onClick={() => onRemove(item.medicine_id)}>Убрать</button>
                  )}
                </div>

                {/* Desktop: the production row, unchanged */}
                <div className="cart-row-desktop">
                  <div className="cart-desktop-image"><MedicineThumb url={item.image_url} name={item.medicine_name} /></div>
                  <div className="cart-desktop-body">
                    <div>
                      <div className="cart-desktop-price">{item.selling_unit_price.toFixed(0)} с.</div>
                      <a href={`/medicine/${item.medicine_id}`} className="cart-desktop-name">{item.medicine_name}</a>
                      <div className={item.in_stock ? 'cart-desktop-stock' : 'cart-desktop-stock is-out'}>
                        {item.in_stock ? 'В наличии' : 'Нет в наличии — удалите из корзины'}
                      </div>
                    </div>
                    <div className="cart-desktop-actions">
                      <div className="cart-desktop-counter">
                        <button type="button" aria-label="Меньше" onClick={() => onQuantity(item.medicine_id, item.quantity - 1)}>−</button>
                        <span>{quantityLabel(item.quantity)}</span>
                        <button type="button" aria-label="Больше" disabled={!item.in_stock || item.quantity >= 99}
                          onClick={() => onQuantity(item.medicine_id, item.quantity + 1)}>+</button>
                      </div>
                      <button type="button" className="cart-desktop-remove" aria-label="Удалить из корзины" onClick={() => onRemove(item.medicine_id)}>
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
          <Link href="/catalog" className="cart-add-more">+ Добавить ещё товары</Link>
        </div>

        <aside className="cart-summary" aria-label="Итог">
          <div className="cart-summary-row"><span>Товары, {quantityLabel(availableCount)} шт.</span><strong>{formatSom(availableTotal)}</strong></div>
          <div className="cart-summary-row"><span>Доставка по Душанбе</span><span>оплачивается курьеру</span></div>
          <div className="cart-summary-total"><span>Итого</span><strong>{formatSom(availableTotal)}</strong></div>
          {shortfall > 0 && available.length > 0 && (
            <div className="cart-minimum" role="status">
              <strong>Минимальная сумма заказа — 50 с.</strong>
              <span>Добавьте товаров ещё на {formatSom(shortfall)}</span>
            </div>
          )}
          {unavailableCount > 0 && (
            <div className="cart-unavailable-note" role="status">
              {unavailableCount === 1 ? '1 товара нет в наличии' : `${unavailableCount} товаров нет в наличии`} — уберём при оформлении
            </div>
          )}
          <div className="cart-action-desktop">{action}</div>
          <Link href="/" className="cart-continue">Продолжить покупки</Link>
        </aside>
      </div>
      {/* Phone: pinned above the bottom menu while the list scrolls. */}
      <div className="cart-action-bar">{action}</div>
    </div>
  );
}
