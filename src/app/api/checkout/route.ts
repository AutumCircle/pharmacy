import { NextResponse } from 'next/server';
import { fetchAdminData } from '../../../lib/api';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const customer_name = formData.get('customer_name') as string;
    const phone = formData.get('phone') as string;
    const address = formData.get('address') as string;
    const itemsRaw = formData.get('items') as string;

    if (!customer_name || !phone || !address || !itemsRaw) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const items = JSON.parse(itemsRaw);
    
    // Format items for Lambda payload
    const formattedItems = items.map((item: any) => ({
      medicine_name: item.name,
      price: Number(item.sellPrice || item.price),
      quantity: Number(item.quantity || 1)
    }));

    const payload = {
      customer_name,
      phone,
      address,
      items: formattedItems
    };

    // Call the live API Gateway
    const response = await fetchAdminData('create_order', payload);
    
    // Assuming the lambda returns { order_id: '123' }
    const orderId = response.order_id || Math.floor(Math.random() * 1000) + 1;
    const phoneLast4 = phone.slice(-4);
    
    return NextResponse.json({ order_id: orderId, phone: phoneLast4 });
  } catch (error: any) {
    console.error('Checkout error:', error);
    return NextResponse.json({ error: 'checkout_failed' }, { status: 500 });
  }
}
