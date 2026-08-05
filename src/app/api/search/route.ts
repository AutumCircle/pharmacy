import { NextResponse } from 'next/server';
import { searchMedicines } from '@/lib/api';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');

  if (!q) {
    return NextResponse.json({ matches: [] });
  }

  try {
    const res = await searchMedicines(q, 10);
    return NextResponse.json({ matches: res.matches || [] });
  } catch (error) {
    console.error('Search proxy error:', error);
    return NextResponse.json({ error: 'Failed to search' }, { status: 500 });
  }
}
