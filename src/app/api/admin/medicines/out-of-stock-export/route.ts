import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ADMIN_SESSION_COOKIE, verifyAdminSession } from '@/lib/admin-session';
import { exportAdminOutOfStockMedicines } from '@/lib/api-v1/admin-server';
import { ApiV1Error } from '@/lib/api-v1/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const cookieStore = await cookies();
  const secret = process.env.ADMIN_SESSION_SECRET;
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  if (!secret || !(await verifyAdminSession(token, secret))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { data } = await exportAdminOutOfStockMedicines();
    const filename = /^vatan-out-of-stock-\d{4}-\d{2}-\d{2}\.xlsx$/.test(data.filename)
      ? data.filename
      : 'vatan-out-of-stock.xlsx';
    const file = Buffer.from(data.content_base64, 'base64');
    if (file.length === 0 || file.subarray(0, 2).toString('ascii') !== 'PK') {
      return NextResponse.json({ error: 'Invalid export file' }, { status: 502 });
    }
    return new Response(file, {
      status: 200,
      headers: {
        'Content-Type': data.content_type,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(file.length),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    const status = error instanceof ApiV1Error ? error.status : 500;
    const message = error instanceof ApiV1Error ? error.message : 'Export failed';
    return NextResponse.json({ error: message }, { status });
  }
}
