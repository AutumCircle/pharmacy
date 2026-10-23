import { Suspense } from 'react';
import TrackingClient from './TrackingClient';
import '../cart/cart.css';
import './tracking.css';

// «Мои заказы»: list of the customer's orders by phone and the order card (`?order=<order_id>`).
export default function TrackingPage() {
  return (
    <Suspense fallback={<div className="container orders-shell" aria-busy="true" />}>
      <TrackingClient />
    </Suspense>
  );
}
