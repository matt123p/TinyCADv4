export const procurementFields = [
  { id: 'manufacturer', column: 'Manufacturer', names: ['manufacturer', 'mfr'] },
  { id: 'mpn', column: 'MPN', names: ['mpn', 'manufacturer part number', 'manufacturer part no', 'manufacturer part #'] },
  { id: 'supplier', column: 'Supplier', names: ['supplier', 'distributor'] },
  { id: 'supplierPartNumber', column: 'Supplier part number', names: ['supplier part number', 'supplier sku', 'distributor part number'] },
  { id: 'voltageRating', column: 'Voltage rating', names: ['voltage rating', 'rated voltage'] },
  { id: 'powerRating', column: 'Power rating', names: ['power rating', 'rated power'] },
  { id: 'tolerance', column: 'Tolerance', names: ['tolerance'] },
] as const;

export type ComponentProcurement = Readonly<Partial<Record<(typeof procurementFields)[number]['id'], string>>>;

const procurementKeys = new Set<string>(procurementFields.map(({ id }) => id));

export function validProcurement(value: unknown): value is ComponentProcurement {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length > 0 && entries.every(([key, text]) =>
    procurementKeys.has(key) && typeof text === 'string' && !!text.trim() && text.length <= 1024 &&
    !/[\u0000-\u001f\u007f]/.test(text));
}
