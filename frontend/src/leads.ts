export function parseLeads(text: string) {
  // Extract addresses from CSV fields, quoted display names, or one-address-per-line text.
  // Deduplicate case-insensitively and do not treat header labels as recipients.
  const matches = text.match(/[A-Z0-9.!#$%&'*+/=?^_\x60{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+/gi) ?? [];
  return [...new Set(matches.map(email => email.toLowerCase()))];
}
export function localDateTime(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
