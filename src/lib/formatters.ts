export function formatVendorCountry(value: string | null | undefined): string {
  const normalized = value?.trim() ?? '';

  // The legacy DBF uses a leading asterisk for an unknown country and
  // comma-only values for an unknown manufacturer. Keep the raw value in RDS,
  // but never present these source-system markers as real catalogue data.
  if (!normalized || normalized.startsWith('*') || /^,+$/.test(normalized)) {
    return 'Не указано';
  }

  return normalized;
}
