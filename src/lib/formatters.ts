export function formatVendorCountry(value: string | null | undefined): string {
  if (!value) return "—";
  if (value.startsWith('*')) return "Не указан";
  if (value === ",,,,,") return "Не указан";
  return value;
}
