/**
 * Technical data — helper na normalizaci.
 *
 * Podporuje DVĚ datové struktury:
 *
 *   1) NOVÁ (key-value repeater) — preferovaná:
 *        [
 *          { label: 'Motor', value: '1.5 GDI Turbo' },
 *          { label: 'Výkon (kW)', value: '120' },
 *          { label: 'Výkon (k)', value: '163' },
 *        ]
 *
 *   2) STARÁ (flat JSON object) — legacy:
 *        { "Motor": "1.5 GDI Turbo", "Výkon (kW)": "120" }
 *
 * Vrací: jednotnou Mapu (string → string|number) pro snadné lookup.
 *
 * Astro kód pak vždy volá `tdToMap(rawValue)` a dostane plochý objekt
 * — funguje to bez ohledu na shape v DB.
 */

export type TechnicalDataValue = string | number;
export type TechnicalDataMap = Record<string, TechnicalDataValue>;

interface TdRepeaterItem {
  label?: string | null;
  value?: TechnicalDataValue | null;
}

export function isRepeaterShape(td: unknown): td is TdRepeaterItem[] {
  return (
    Array.isArray(td) &&
    td.length > 0 &&
    typeof td[0] === 'object' &&
    td[0] !== null &&
    ('label' in (td[0] as any) || 'value' in (td[0] as any))
  );
}

/**
 * Sloučí technical_data z libovolné podporované struktury na flat objekt.
 * Tichá tolerance: prázdné/null hodnoty se přeskočí.
 */
export function tdToMap(td: unknown): TechnicalDataMap {
  if (!td) return {};

  if (isRepeaterShape(td)) {
    const out: TechnicalDataMap = {};
    for (const item of td) {
      if (!item?.label) continue;
      if (item.value === null || item.value === undefined || item.value === '') continue;
      out[String(item.label)] = item.value as TechnicalDataValue;
    }
    return out;
  }

  if (typeof td === 'object') {
    const out: TechnicalDataMap = {};
    for (const [k, v] of Object.entries(td as Record<string, unknown>)) {
      if (v === null || v === undefined || v === '') continue;
      out[k] = v as TechnicalDataValue;
    }
    return out;
  }

  return {};
}

/**
 * Lookup hodnoty pod jedním z více možných klíčů.
 * Užitečné pro Astro specs row: `pick(td, 'motor', 'Motor', 'Engine')`
 */
export function pick(td: TechnicalDataMap, ...keys: string[]): string | number | undefined {
  for (const k of keys) {
    if (td[k] !== undefined) return td[k];
  }
  return undefined;
}
