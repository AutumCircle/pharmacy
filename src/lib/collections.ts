/** Shared (browser + server) helpers for marketing collections, UTM capture and first-touch attribution.
 *
 * Nothing here is personal data: the visitor id is a random value and the source cookie only holds
 * a collection slug and UTM labels.
 */

export const VISITOR_COOKIE = 'vatan_vid';
export const SOURCE_COOKIE = 'vatan_src';
export const VISITOR_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const SOURCE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
export const COLLECTION_PATH_PREFIX = '/podborka/';

export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] as const;
export type UtmKey = (typeof UTM_KEYS)[number];
export type Utm = Record<UtmKey, string | null>;

export type CollectionEventType = 'view' | 'product_open' | 'add_to_cart';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VISITOR_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
// Preview crawlers and bots. Instagram/Facebook open the link themselves when it is sent in Direct.
const BOT_MARKERS = [
  'facebookexternalhit', 'meta-externalagent', 'meta-externalfetcher', 'facebot',
  'bot', 'crawler', 'spider', 'preview',
];

export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent || !userAgent.trim()) return true;
  const lowered = userAgent.toLowerCase();
  return BOT_MARKERS.some((marker) => lowered.includes(marker));
}

export function isValidSlug(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 80 && SLUG_PATTERN.test(value);
}

export function isValidVisitorId(value: unknown): value is string {
  return typeof value === 'string' && VISITOR_PATTERN.test(value);
}

export function cleanLabel(value: unknown, maximum = 100): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maximum);
  return cleaned || null;
}

export function emptyUtm(): Utm {
  return { utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null };
}

export function readUtm(search: string): Utm {
  const params = new URLSearchParams(search);
  const utm = emptyUtm();
  for (const key of UTM_KEYS) utm[key] = cleanLabel(params.get(key));
  return utm;
}

export function hasUtm(utm: Utm): boolean {
  return UTM_KEYS.some((key) => utm[key] !== null);
}

export function collectionSlugFromPath(pathname: string): string | null {
  if (!pathname.startsWith(COLLECTION_PATH_PREFIX)) return null;
  const slug = pathname.slice(COLLECTION_PATH_PREFIX.length).replace(/\/$/, '');
  return isValidSlug(slug) ? slug : null;
}

export interface SourceAttribution {
  collection: string | null;
  utm: Utm;
  savedAt: number;
}

export function serializeSource(source: SourceAttribution): string {
  return encodeURIComponent(JSON.stringify({
    c: source.collection,
    s: source.utm.utm_source,
    m: source.utm.utm_medium,
    n: source.utm.utm_campaign,
    t: source.utm.utm_content,
    ts: source.savedAt,
  }));
}

/** Returns null for a missing, malformed or expired (older than 7 days) source cookie. */
export function parseSource(raw: string | null | undefined, now = Date.now()): SourceAttribution | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    try {
      parsed = JSON.parse(decodeURIComponent(raw));
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const value = parsed as Record<string, unknown>;
  const savedAt = typeof value.ts === 'number' ? value.ts : NaN;
  if (!Number.isFinite(savedAt) || savedAt > now + 60_000 || now - savedAt > SOURCE_MAX_AGE_SECONDS * 1000) return null;
  const collection = isValidSlug(value.c) ? value.c : null;
  const utm: Utm = {
    utm_source: cleanLabel(value.s),
    utm_medium: cleanLabel(value.m),
    utm_campaign: cleanLabel(value.n),
    utm_content: cleanLabel(value.t),
  };
  if (!collection && !hasUtm(utm)) return null;
  return { collection, utm, savedAt };
}

/** The order attribution object accepted by the public Lambda, or null when there is nothing to store. */
export function attributionForOrder(source: SourceAttribution | null): Record<string, string> | null {
  if (!source) return null;
  const result: Record<string, string> = {};
  if (source.collection) result.source_collection = source.collection;
  for (const key of UTM_KEYS) {
    const value = source.utm[key];
    if (value) result[key] = value;
  }
  return Object.keys(result).length > 0 ? result : null;
}

/** Human readable order source for the admin, e.g. "Подборка oct-6 · instagram / dm". */
export function formatOrderSource(order: {
  source_collection?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
}): string | null {
  const channel = [order.utm_source, order.utm_medium].filter(Boolean).join(' / ');
  const extras = [order.utm_campaign, order.utm_content].filter(Boolean).join(' / ');
  const parts = order.source_collection
    ? [`Подборка ${order.source_collection}`, channel]
    : [channel ? `UTM: ${channel}` : extras ? 'UTM' : '', extras];
  const text = parts.filter(Boolean).join(' · ');
  return text || null;
}

// ---------------------------------------------------------------- browser-only cookie helpers

function readCookie(name: string): string | null {
  try {
    const entry = document.cookie.split('; ').find((part) => part.startsWith(`${name}=`));
    return entry ? entry.slice(name.length + 1) : null;
  } catch {
    return null;
  }
}

function writeCookie(name: string, value: string, maxAgeSeconds: number): void {
  try {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${name}=${value}; Max-Age=${maxAgeSeconds}; Path=/; SameSite=Lax${secure}`;
  } catch {
    // Cookies may be blocked; the site keeps working without statistics.
  }
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Anonymous random visitor id kept for 30 days (refreshed on every use). */
export function getVisitorId(): string | null {
  const existing = readCookie(VISITOR_COOKIE);
  const id = existing && isValidVisitorId(existing) ? existing : randomId();
  writeCookie(VISITOR_COOKIE, id, VISITOR_MAX_AGE_SECONDS);
  return isValidVisitorId(id) ? id : null;
}

/**
 * First-touch source: written only when no source younger than 7 days exists.
 * `collection` is set when the visitor opened an existing collection page.
 */
export function saveFirstTouchSource(collection: string | null, utm: Utm): void {
  if (!collection && !hasUtm(utm)) return;
  if (parseSource(readCookie(SOURCE_COOKIE))) return;
  writeCookie(SOURCE_COOKIE, serializeSource({ collection, utm, savedAt: Date.now() }), SOURCE_MAX_AGE_SECONDS);
}

export function sendCollectionEvent(slug: string, eventType: CollectionEventType, productId?: number): void {
  const visitorId = getVisitorId();
  if (!visitorId) return;
  const body = JSON.stringify({
    collection_slug: slug,
    event_type: eventType,
    ...(productId ? { product_id: productId } : {}),
    visitor_id: visitorId,
    referrer: document.referrer || null,
    ...readUtm(window.location.search),
  });
  try {
    void fetch('/api/collections/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Statistics must never break shopping.
  }
}
