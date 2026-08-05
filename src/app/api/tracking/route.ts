import { NextResponse } from 'next/server';
import { fetchAdminData } from '../../../lib/api';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const phone = searchParams.get('phone');

  if (!phone) {
    return NextResponse.json({ error: 'Phone is required' }, { status: 400 });
  }

  try {
    const data = await fetchAdminData('list_orders');
    const orders = data?.orders || [];
    
    // Filter orders by phone number (removing any non-digits for comparison)
    const cleanSearchPhone = phone.replace(/\D/g, '');
    const userOrders = orders.filter((o: any) => {
      const orderPhone = (o.phone || '').replace(/\D/g, '');
      return orderPhone === cleanSearchPhone || orderPhone.endsWith(cleanSearchPhone) || cleanSearchPhone.endsWith(orderPhone);
    });

    // Sort by most recent first
    userOrders.sort((a: any, b: any) => {
      return new Date(b.created_at || b.date).getTime() - new Date(a.created_at || a.date).getTime();
    });

    return NextResponse.json({ orders: userOrders });
  } catch (error) {
    console.error('Tracking API error:', error);
    return NextResponse.json({ orders: [] });
  }
}
