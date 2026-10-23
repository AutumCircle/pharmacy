import 'server-only';
import { requireAdminSession } from '@/lib/admin-auth';
import { validMirrorDetail, validMirrorProducts, validMirrorStatus } from '@/lib/pharmacy-mirror';
import { ApiV1Error } from './server';

async function read<T>(path: string, validate: (v: unknown) => v is T): Promise<T> {
  await requireAdminSession();
  const base = process.env.API_V1_BASE_URL;
  const token = process.env.ADMIN_API_BEARER_TOKEN;
  const key = process.env.API_KEY;
  if (!base || !token || !key) throw new Error('MIRROR_CONFIGURATION_ERROR');
  const url = new URL(base);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('MIRROR_CONFIGURATION_ERROR');
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`${base.replace(/\/$/, '')}/v1/admin/pharmacy-mirror/${path}`, {
        headers: { Accept: 'application/json', 'x-api-key': key, Authorization: `Bearer ${token}` },
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!response.ok)
        throw new ApiV1Error(
          response.status,
          'MIRROR_UPSTREAM_ERROR',
          'Не удалось прочитать зеркало',
        );
      const payload: unknown = await response.json();
      if (
        !payload ||
        typeof payload !== 'object' ||
        !('data' in payload) ||
        !validate(payload.data)
      )
        throw new ApiV1Error(502, 'MIRROR_CONTRACT_ERROR', 'Некорректный ответ зеркала');
      return payload.data;
    } catch (error) {
      if (
        attempt === 1 ||
        controller.signal.aborted ||
        (error instanceof ApiV1Error && error.status < 500)
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 150 + Math.random() * 200));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('MIRROR_UNAVAILABLE');
}
export function getMirrorStatus() {
  return read('status', validMirrorStatus);
}
export function searchMirrorProducts(q: string, mode: string, page: number) {
  return read(
    `products?${new URLSearchParams({ q, mode, page: String(page), limit: '25' })}`,
    validMirrorProducts,
  );
}
export function getMirrorProduct(
  id: string,
  stockPage: number,
  incomePage: number,
  stockView: 'nonzero' | 'all' = 'nonzero',
) {
  if (!/^[0-9]{1,18}$/.test(id)) throw new ApiV1Error(404, 'NOT_FOUND', 'Товар не найден');
  return read(
    `products/${id}?stock_page=${stockPage}&income_page=${incomePage}&stock_view=${stockView}`,
    validMirrorDetail,
  );
}
