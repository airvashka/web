/**
 * Features kategorizace + grouped helper.
 *
 * Podporuje DVĚ datové struktury:
 *
 *   1) NOVÁ (explicitní groups) — preferovaná:
 *        [
 *          { category: 'pohon', items: ['FWD', 'Start-Stop', ...] },
 *          { category: 'bezpecnost', items: ['Airbagy', 'ESP', ...] },
 *        ]
 *
 *   2) STARÁ (flat string array) — fallback, použije keyword matching:
 *        ['FWD', 'Start-Stop', 'Airbagy', 'ESP', ...]
 *
 * Pro UI vždy volej getGroupedFeatures() — vrátí jednotnou strukturu.
 */

export type FeatureCategory =
  | 'pohon'
  | 'podvozek'
  | 'bezpecnost'
  | 'asistent'
  | 'komfort'
  | 'multimedia'
  | 'exterier'
  | 'ostatni';

export const CATEGORY_LABELS: Record<FeatureCategory, string> = {
  pohon: 'Pohon',
  podvozek: 'Zavěšení kol, řízení, brzdy',
  bezpecnost: 'Bezpečnost',
  asistent: 'Asistenční systémy',
  komfort: 'Interiér / komfort',
  multimedia: 'Multimedia',
  exterier: 'Exteriér',
  ostatni: 'Ostatní',
};

export const CATEGORY_ICONS: Record<FeatureCategory, string> = {
  pohon: '⚙️',
  podvozek: '🛞',
  bezpecnost: '🛡️',
  asistent: '🎯',
  komfort: '🪑',
  multimedia: '📱',
  exterier: '🚗',
  ostatni: '✨',
};

export const CATEGORY_ORDER: FeatureCategory[] = [
  'pohon',
  'podvozek',
  'bezpecnost',
  'asistent',
  'komfort',
  'multimedia',
  'exterier',
  'ostatni',
];

// Keyword → category mapping (case-insensitive, partial match)
// Používá se JEN pro legacy flat array (fallback) a pro auto-migraci.
const KEYWORDS: Record<FeatureCategory, string[]> = {
  pohon: [
    'tgdi', 'gdi', 'turbo', 'hybrid', 'phev', 'elektromotor', 'baterie', 'manuální',
    'manuál', 'automatick', 'dct', 'dht', 'cvt', 'awd', 'fwd', '4wd', 'pohon',
    'kw', 'nm', 'moment', 'výkon', 'spotřeb', 'dojezd', 'kwh',
    'redukční', 'převodovk', 'start-stop', 'start stop',
  ],
  podvozek: [
    'mcpherson', 'multi-link', 'multilink', 'zavěšení', 'sloupek řízení',
    'posilovač řízení', 'abs', 'ebd', 'esp', 'trakce', 'ftcs', 'brzdový asistent',
    'arp', 'aebs', 'hsa', 'asistent rozjezdu', 'asistent sjezdu', 'hdc', 'ess',
    'fcw', 'kontrola trakce', 'stabilizač', 'brzd', 'parkovací brzda',
  ],
  bezpecnost: [
    'airbag', 'isofix', 'ecall', 'imobilizér', 'alarm', 'kotvy', 'pojistka',
    'záznam', 'edr', 'emergency call', 'předepínač', 'bezpečnostních pásů',
    'opěrky', 'opěrka', 'dětsk',
  ],
  asistent: [
    'tempomat', 'asistent', 'bsd', 'lca', 'rcta', 'detekce', 'kamera', 'parkovac',
    'aeb', 'acc', 'autohold', 'auto hold', 'autopilot', 'safety', 'lane', 'pruh',
    'slep', 'sjíždění', 'vystoupení', 'únavy', 'pozornosti', 'nouzov', 'collision',
    '360', '540', 'senzor', 'předjíždění', 'ldws', 'lkas', 'tsr', 'isa', 'fvsa',
    'sda', 'daa', 'rozpoznání', 'dopravních značek', 'hba',
  ],
  komfort: [
    'klima', 'klimatizace', 'vyhřívan', 'ventilov', 'bezklíčov', 'nabíjení',
    'masáž', 'svítidlo', 'sluneční clon', 'střešní okno', 'panoramatick',
    'el. víko', 'elektrické víko', 'elektrické ovládání oken', 'tažné',
    'klíč', 'start-stop button', 'startován',
    'volant', 'sedadl', 'sedák', 'sedačky', 'kožen', 'textil', 'syntetick',
    'eco-kůže', 'eko-kůže', 'koberce', 'ambient', 'osvětlení interiéru',
    'loketní', 'čalouněn', 'palubn', 'imitace', 'multifunkčn',
    'zrcátko', 'stmívání', 'lcd', 'přístrojová deska', 'řadící páky',
    'centrální zamykání', 'zámku', 'zámek', 'osvětlení zámku',
    'stěrač', 'dešťový', 'světelný senzor', 'okna', 'kliky',
    'zavazadlov', 'kryt', 'síť', 'podlaha', 'zásuvka',
  ],
  multimedia: [
    'displej', 'reproduktor', 'sony', 'usb', 'bluetooth', 'wireless', 'carplay',
    'android auto', 'rádio', 'dab', 'hlasov', 'multimédi', 'audio', 'navigac',
    'hud', 'head-up', 'head up', 'audiosystému', 'gsm anténa', 'ipod',
  ],
  exterier: [
    'alu', 'kola', 'ráfk', 'pneumatik', 'led světl', 'led denní', 'led směr',
    'mlhové', 'mlhovky', 'projekční', 'projektorové', 'světlomety', 'střešní ližin',
    'střešní nosič', 'spoiler', 'výfuk', 'follow me home', 'privacy', 'tónován',
    'metalick', 'barva karoserie', 'logo', 'tpms', 'monitorování tlaku',
    'dveř zavazadlového', 'smart', 'směrovkami',
  ],
  ostatni: [],
};

/**
 * Detekce shape: nová struktura (groups) vs legacy (flat array).
 */
export function isGroupedFeatures(features: any): features is Array<{ category: string; items: string[] }> {
  return (
    Array.isArray(features) &&
    features.length > 0 &&
    typeof features[0] === 'object' &&
    features[0] !== null &&
    'category' in features[0]
  );
}

/**
 * Kategorizuje pole stringů do skupin podle keywordů (jen pro legacy).
 */
export function categorizeFeatures(
  features: string[] | null | undefined,
): Record<FeatureCategory, string[]> {
  const groups: Record<FeatureCategory, string[]> = {
    pohon: [], podvozek: [], bezpecnost: [], asistent: [],
    komfort: [], multimedia: [], exterier: [], ostatni: [],
  };

  if (!Array.isArray(features)) return groups;

  for (const f of features) {
    const lower = String(f).toLowerCase();
    let matched: FeatureCategory | null = null;

    for (const cat of CATEGORY_ORDER) {
      if (cat === 'ostatni') continue;
      const keywords = KEYWORDS[cat];
      if (keywords.some((kw) => lower.includes(kw))) {
        matched = cat;
        break;
      }
    }

    groups[matched ?? 'ostatni'].push(String(f));
  }

  return groups;
}

export interface FeatureGroup {
  key: FeatureCategory | string;
  label: string;
  icon: string;
  items: string[];
}

/**
 * Vrátí features jako sjednocenou strukturu skupin, ať jsou v DB v jakémkoli shape.
 *
 * - Pokud jsou groups (nový formát) → vrátí je s labely
 * - Pokud je flat array (legacy) → keyword-categorize a vrátí
 */
export function getGroupedFeatures(features: any): FeatureGroup[] {
  // Nová struktura
  if (isGroupedFeatures(features)) {
    return features
      .map((g: any) => {
        const key = String(g.category ?? 'ostatni');
        const items = Array.isArray(g.items) ? g.items.filter(Boolean) : [];
        return {
          key,
          label: CATEGORY_LABELS[key as FeatureCategory] ?? key,
          icon: CATEGORY_ICONS[key as FeatureCategory] ?? '✨',
          items,
        };
      })
      .filter((g) => g.items.length > 0)
      // Sort podle CATEGORY_ORDER
      .sort((a, b) => {
        const ai = CATEGORY_ORDER.indexOf(a.key as FeatureCategory);
        const bi = CATEGORY_ORDER.indexOf(b.key as FeatureCategory);
        return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
      });
  }

  // Legacy flat array — keyword categorize
  return getNonEmptyCategories(features);
}

/**
 * Vrátí jen ty kategorie, které mají alespoň 1 feature. (Legacy flat array → groups)
 */
export function getNonEmptyCategories(
  features: string[] | null | undefined,
): FeatureGroup[] {
  const grouped = categorizeFeatures(features);
  return CATEGORY_ORDER.filter((cat) => grouped[cat].length > 0).map((cat) => ({
    key: cat,
    label: CATEGORY_LABELS[cat],
    icon: CATEGORY_ICONS[cat],
    items: grouped[cat],
  }));
}

/**
 * Spočítá celkový počet features napříč groups (pro counter labely).
 */
export function countFeatures(features: any): number {
  const groups = getGroupedFeatures(features);
  return groups.reduce((sum, g) => sum + g.items.length, 0);
}
