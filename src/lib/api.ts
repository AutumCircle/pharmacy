/**
 * Pharmacy API Client
 * --------------------
 * Wrapper around the AWS Query Lambda endpoint.
 * All data fetching goes through API Gateway → Lambda → RDS.
 *
 * In production (EC2 in same VPC), this can be swapped for
 * direct Prisma queries without changing the component layer.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";
const API_KEY = process.env.API_KEY || "";

interface FetchOptions {
  action: string;
  [key: string]: unknown;
}

async function queryLambda<T>(params: FetchOptions, retries = 3): Promise<T> {
  const url = `${API_URL}/api/query`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "x-api-key": API_KEY,
          "Content-Type": "application/json",
          "Connection": "close", // Prevent socket hanging in Node.js
        },
        body: JSON.stringify(params),
        next: { revalidate: 30 }, // Cache for 30 seconds (ISR)
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (err: any) {
      if (attempt === retries) {
        throw err;
      }
      console.warn(`Fetch failed (attempt ${attempt}): ${err.message}. Retrying...`);
      // Wait for 1 second before retrying
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error("Unreachable");
}

// ─── Types ───────────────────────────────────────────────────

export interface Medicine {
  name: string;
  price: number;
  country: string | null;
  vendor: string | null;
  in_stock: boolean;
  updated_at: string;
}

export interface MedicineStats {
  total_medicines: number;
  in_stock: number;
  out_of_stock: number;
  min_price: number;
  max_price: number;
  avg_price: number;
  countries: number;
  last_updated: string;
}

// ─── API Functions ───────────────────────────────────────────

export async function getMedicines(params: {
  limit?: number;
  offset?: number;
  in_stock?: boolean;
  sort?: "name" | "price" | "updated";
}): Promise<{ medicines: Medicine[] }> {
  return queryLambda({
    action: "list",
    limit: params.limit ?? 20,
    offset: params.offset ?? 0,
    in_stock: params.in_stock,
    sort: params.sort ?? "name",
  });
}

export async function searchMedicines(
  name: string,
  limit: number = 20,
  in_stock?: boolean
): Promise<{ matches: Medicine[] }> {
  return queryLambda({
    action: "search",
    name,
    limit,
    ...(in_stock !== undefined && { in_stock }),
  });
}

export async function getDuplicates(): Promise<{ duplicates: { name: string; count: number }[] }> {
  return queryLambda({
    action: "duplicates",
  });
}

export async function getHistory(): Promise<{ history: any[] }> {
  return queryLambda({
    action: "history",
  });
}

export async function cleanupArchive(): Promise<{ message: string }> {
  // Using cache: 'no-store' directly isn't easily done since queryLambda applies revalidate: 30
  // but it's a mutation. We will add an option to bypass cache if needed, or just run it.
  const url = `${API_URL}/api/query`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "x-api-key": API_KEY,
      "Content-Type": "application/json",
      "Connection": "close",
    },
    body: JSON.stringify({ action: "cleanup_archive" }),
    cache: "no-store",
  });
  return response.json();
}

export async function getMedicineByName(
  name: string
): Promise<Medicine | { error: string }> {
  return queryLambda({
    action: "get",
    name,
  });
}

export async function getMedicineCount(
  in_stock?: boolean
): Promise<{ count: number }> {
  return queryLambda({
    action: "count",
    ...(in_stock !== undefined && { in_stock }),
  });
}

export async function getStats(): Promise<MedicineStats> {
  return queryLambda({
    action: "stats",
  });
}

// ─── ADMIN API FUNCTIONS ─────────────────────────────────────
const ADMIN_API_URL = 'https://2y9rv4j811.execute-api.eu-central-1.amazonaws.com/prod/api/query';

export async function fetchAdminData(action: string, payload: Record<string, any> = {}) {
  const apiKey = process.env.API_KEY || process.env.NEXT_PUBLIC_API_KEY || '';

  const response = await fetch(ADMIN_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'Connection': 'close',
    },
    body: JSON.stringify({
      action: action,
      ...payload
    }),
    cache: 'no-store' // Always fetch fresh data for admin
  });
  
  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }
  
  return response.json();
}
