import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ADMIN_SESSION_COOKIE, verifyAdminSession } from '@/lib/admin-session';
import { exportAdminAvailableMedicines } from '@/lib/api-v1/admin-server';
import { ApiV1Error } from '@/lib/api-v1/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const files = {
  xlsx: {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    filename: /^vatan-available-medicines-\d{4}-\d{2}-\d{2}\.xlsx$/,
    fallback: 'vatan-available-medicines.xlsx',
  },
  csv: {
    contentType: 'text/csv; charset=utf-8',
    filename: /^vatan-available-medicines-\d{4}-\d{2}-\d{2}\.csv$/,
    fallback: 'vatan-available-medicines.csv',
  },
} as const;

export async function GET(request: Request, context: { params: Promise<{ format: string }> }) {
  const { format } = await context.params;
  if (format !== 'xlsx' && format !== 'csv') return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || !(await verifyAdminSession(token, secret))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const type = files[format];
    const { data } = await exportAdminAvailableMedicines(format, new URL(request.url).origin);
    const file = Buffer.from(data.content_base64, 'base64');
    const isValid = file.length > 0 && data.content_type === type.contentType
      && (format === 'csv' || file.subarray(0, 2).toString('ascii') === 'PK');
    if (!isValid) return NextResponse.json({ error: 'Invalid export file' }, { status: 502 });
    return new Response(file, {
      headers: {
        'Content-Type': type.contentType,
        'Content-Disposition': `attachment; filename="${type.filename.test(data.filename) ? data.filename : type.fallback}"`,
        'Content-Length': String(file.length),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    const status = error instanceof ApiV1Error ? error.status : 500;
    return NextResponse.json({ error: error instanceof ApiV1Error ? error.message : 'Export failed' }, { status });
  }
}
