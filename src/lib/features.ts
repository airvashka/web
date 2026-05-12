/**
 * Auto-kategorizace features stringů.
 *
 * Vstup: pole stringů ["Vyhřívaný volant", "BSD", "18\" ALU", ...]
 * Výstup: { komfort: ["Vyhřívaný volant"], asistent: ["BSD"], exterier: ["18\" ALU"] }
 *
 * Používá keyword matching — strings z trim_levels.features se rozloží do sekcí
 * podle obsažených klíčových slov.
 */

export type FeatureCategory = 'asistent' | 'bezpecnost' | 'komfort' | 'exterier' | 'interier' | 'infotainment' | 'pohon' | 'ostatni';

export const CATEGORY_LABELS: Record<FeatureCategory, string> = {
  asistent: 'Asistenční systémy',
  bezpecnost: 'Bezpečnost',
  komfort: 'Komfort',
  exterier: 'Exteriér',
  interier: 'Interiér',
  infotainment: 'Infotainment',
  pohon: 'Pohon',
  ostatni: 'Ostatní',
};

export const CATEGORY_ICONS: Record<FeatureCategory, string> = {
  asistent: '🎯',
  bezpecnost: '🛡️',
  komfort: '❄️',
  exterier: '🚗',
  interier: '🪑',
  infotainment: '📱',
  pohon: '⚙️',
  ostatni: '✨',
};

export const CATEGORY_ORDER: FeatureCategory[] = [
  'pohon',
  'asistent',
  'bezpecnost',
  'komfort',
  'infotainment',
  'interier',
  'exterier',
  'ostatni',
];

// Keyword → category mapping (case-insensitive, partial match)
const KEYWORDS: Record<FeatureCategory, string[]> = {
  asistent: [
    'tempomat', 'asistent', 'bsd', 'lca', 'rcta', 'detekce', 'kamera', 'parkovac',
    'aeb', 'acc', 'autohold', 'auto hold', 'autopilot', 'safety', 'lane', 'pruh',
    'slep', 'sjíždění', 'vystoupení', 'únavy', 'pozornosti', 'nouzov', 'collision',
    'auto-stmívání', 'stmívání', '360', '540', 'senzor', 'předjíždění',
  ],
  bezpecnost: [
    'airbag', 'isofix', 'ecall', 'ebd', 'abs', 'esp', 'aebs', 'imobilizér',
    'alarm', 'kotvy', 'pojistka', 'záznam', 'edr',
  ],
  komfort: [
    'klima', 'klimatizace', 'vyhřívan', 'ventilov', 'bezklíčov', 'nabíjení',
    'masáž', 'auto hold', 'svítidlo', 'sluneční clon', 'střešní okno', 'panoramatick',
    'el. víko', 'elektrické víko', 'elektrické ovládání oken', 'tažné', 'auto stmívání',
    'klíč', 'startován', 'el. parkovací brzda',
  ],
  exterier: [
    'alu', 'kola', 'ráfk', 'pneumatik', 'led světl', 'led denní', 'led směr',
    'mlhové', 'mlhovky', 'projekční', 'střešní ližin', 'střešní nosič',
    'spoiler', 'výfuk', 'zrcátk', 'lift', 'follow me home', 'privacy', 'tónován',
    'metalick', 'barva karoserie', 'logo',
  ],
  interier: [
    'volant', 'sedadl', 'sedák', 'sedačky', 'kožen', 'textil', 'syntetick',
    'eco-kůže', 'eko-kůže', 'koberce', 'ambient', 'osvětlení interiéru',
    'opěrk', 'paměť', 'loketní', 'čalouněn', 'palubn', 'imitace', 'multifunkčn',
  ],
  infotainment: [
    'displej', 'reproduktor', 'sony', 'usb', 'bluetooth', 'wireless', 'carplay',
    'android auto', 'rádio', 'dab', 'hlasov', 'multimédi', 'audio', 'navigac',
    'hud', 'head-up', 'head up', 'centráln',
  ],
  pohon: [
    'tgdi', 'gdi', 'turbo', 'hybrid', 'phev', 'elektromotor', 'baterie', 'manuální',
    'manuál', 'automatick', 'dct', 'dht', 'cvt', 'awd', 'fwd', '4wd', 'pohon',
    'kw', 'nm', 'moment', 'výkon', 'spotřeb', 'dojezd', 'nabíjen', 'kwh',
    'redukční', 'převodovk',
  ],
  ostatni: [],
};

/**
 * Kategorizuje pole stringů do skupin podle obsažených keywordů.
 * String, který nematchne žádnou kategorii, jde do 'ostatni'.
 */
export function categorizeFeatures(
  features: string[] | null | undefined
): Record<FeatureCategory, string[]> {
  const groups: Record<FeatureCategory, string[]> = {
    asistent: [], bezpecnost: [], komfort: [], exterier: [],
    interier: [], infotainment: [], pohon: [], ostatni: [],
  };

  if (!Array.isArray(features)) return groups;

  for (const f of features) {
    const lower = String(f).toLowerCase();
    let matched: FeatureCategory | null = null;

    // Iteruj přes kategorie a najdi první match
    for (const cat of CATEGORY_ORDER) {
      if (cat === 'ostatni') continue;
      const keywords = KEYWORDS[cat];
      if (keywords.some(kw => lower.includes(kw))) {
        matched = cat;
        break;
      }
    }

    groups[matched ?? 'ostatni'].push(String(f));
  }

  return groups;
}

/**
 * Vrátí jen ty kategorie, které mají alespoň 1 feature.
 * Užitečné pro JSX iteraci (přeskočí prázdné sekce).
 */
export function getNonEmptyCategories(
  features: string[] | null | undefined
): Array<{ key: FeatureCategory; label: string; icon: string; items: string[] }> {
  const grouped = categorizeFeatures(features);
  return CATEGORY_ORDER
    .filter(cat => grouped[cat].length > 0)
    .map(cat => ({
      key: cat,
      label: CATEGORY_LABELS[cat],
      icon: CATEGORY_ICONS[cat],
      items: grouped[cat],
    }));
}
