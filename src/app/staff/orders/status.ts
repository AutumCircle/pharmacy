import type { CourierOrderStatus } from '@/lib/api-v1/staff-types';

export const statusLabels: Record<CourierOrderStatus, string> = {
  pending: 'Новый', confirmed: 'Собирается', delivering: 'В пути',
  delivered: 'Доставлен', cancelled: 'Отменён',
};

export const statusFlow: CourierOrderStatus[] = ['pending', 'confirmed', 'delivering', 'delivered'];

export const nextStep: Partial<Record<CourierOrderStatus, { status: CourierOrderStatus; label: string }>> = {
  pending: { status: 'confirmed', label: 'Принять заказ' },
  confirmed: { status: 'delivering', label: 'Выехал к клиенту' },
  delivering: { status: 'delivered', label: 'Заказ доставлен' },
};
