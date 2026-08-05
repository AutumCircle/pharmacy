/**
 * Formats an order ID into the pattern: {phone_last_4}-{padded_3_digit_id}
 * Example output: "7788-005"
 * 
 * @param phone The customer's phone number
 * @param sequenceId The database ID of the order
 */
export function formatOrderNumber(phone: string, sequenceId: string | number): string {
  // Extract last 4 digits of the phone number, fallback to '0000' if invalid
  const cleanPhone = (phone || '').replace(/\D/g, '');
  const last4 = cleanPhone.length >= 4 ? cleanPhone.slice(-4) : '0000';
  
  // Pad the sequence ID to 3 digits (e.g., 5 -> "005", 12 -> "012")
  const idStr = String(sequenceId || '0');
  const paddedId = idStr.padStart(3, '0');
  
  return `${last4}-${paddedId}`;
}

export function calculateSellingPrice(basePrice: string | number): number {
  const price = Number(basePrice) || 0;
  return Math.ceil(price * 1.05);
}

export function sanitizeText(text: string | null | undefined): string {
  if (!text) return '';
  let clean = text.trim();
  
  // Remove asterisks
  if (clean.startsWith('*')) {
    clean = clean.substring(1).trim();
  }
  
  // If the text is just commas or empty spaces (e.g. ",,,,,", ", , ,"), return empty string
  if (/^[, \s]+$/.test(clean)) {
    return '';
  }
  
  return clean;
}
