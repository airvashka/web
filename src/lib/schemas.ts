/**
 * Schema.org JSON-LD generátory.
 *
 * Vrací plain objekt — Astro JsonLd komponenta to serializuje jako <script>.
 * Schémata podporují Google rich snippets: AutoDealer, Vehicle, Article, Organization, BreadcrumbList.
 */

const SITE_URL = 'https://sfr-motor.cz';

const COMPANY = {
  name: 'SFR Motor s.r.o.',
  legalName: 'SFR Motor s.r.o.',
  url: SITE_URL,
  logo: `${SITE_URL}/logo.svg`,
  email: 'info@sfr-motor.cz',
  telephone: '+420771235458',
  ico: '08263523',
  dic: 'CZ08263523',
  address: {
    streetAddress: 'Ďáblická 553/2',
    addressLocality: 'Praha 8',
    postalCode: '18200',
    addressCountry: 'CZ',
  },
  geo: { latitude: 50.1336, longitude: 14.4675 }, // Praha-Ďáblice approx
  openingHours: {
    sales: 'Mo-We,Fr 08:00-18:00, Th 08:00-20:00',
    service: 'Mo-Fr 08:00-17:00',
  },
  social: [
    'https://www.facebook.com/SFR-Motor-106817477406828/',
    'https://www.instagram.com/sfr_motor/',
    'https://www.youtube.com/@sfrmotor',
  ],
};

/**
 * AutoDealer / LocalBusiness — Organization na úrovni site.
 * Vkládá se na homepage + kontakt.
 */
export function autoDealerSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'AutoDealer',
    '@id': `${SITE_URL}/#dealer`,
    name: COMPANY.name,
    legalName: COMPANY.legalName,
    url: COMPANY.url,
    logo: COMPANY.logo,
    image: COMPANY.logo,
    email: COMPANY.email,
    telephone: COMPANY.telephone,
    description:
      'Autorizovaný dealer značek KGM, OMODA & JAECOO a FARIZON v Praze-Ďáblicích. Prodej nových i ojetých vozů, autorizovaný servis pro 5 značek, pneuservis, karosárna a lakovna.',
    address: {
      '@type': 'PostalAddress',
      ...COMPANY.address,
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: COMPANY.geo.latitude,
      longitude: COMPANY.geo.longitude,
    },
    sameAs: COMPANY.social,
    openingHoursSpecification: [
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Friday'],
        opens: '08:00',
        closes: '18:00',
      },
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: 'Thursday',
        opens: '08:00',
        closes: '20:00',
      },
    ],
    priceRange: '$$',
    paymentAccepted: 'Cash, Credit Card, Bank Transfer, Leasing',
    currenciesAccepted: 'CZK',
    areaServed: { '@type': 'Country', name: 'Czech Republic' },
    knowsAbout: ['KGM', 'OMODA', 'JAECOO', 'FARIZON', 'Servis vozů', 'Pneuservis', 'Karosárna'],
    identifier: [
      { '@type': 'PropertyValue', name: 'IČO', value: COMPANY.ico },
      { '@type': 'PropertyValue', name: 'DIČ', value: COMPANY.dic },
    ],
  };
}

/**
 * Vehicle — pro detail skladového vozu.
 */
interface VehicleInput {
  url: string;
  brand: string;       // "KGM" | "OMODA" | "JAECOO" | "FARIZON"
  model: string;       // "Tivoli" | "Korando" | ...
  trim?: string;       // "Style" | "Style+" | ...
  year?: number | null;
  vin?: string | null;
  km?: number | null;
  condition: 'new' | 'demo' | 'used';
  fuelType?: string;   // "Benzín" | "Diesel" | "Hybrid" | "PHEV" | "Elektro"
  transmission?: string | null;
  drivetrain?: string | null;
  color?: string | null;
  priceCzk?: number | null;
  listPriceCzk?: number | null;
  availability: 'in_stock' | 'on_the_way' | 'reserved' | 'sold';
  photoUrls: string[];
  description?: string;
}

const CONDITION_MAP = {
  new: 'https://schema.org/NewCondition',
  demo: 'https://schema.org/UsedCondition', // Předváděcí = lehce ojeté
  used: 'https://schema.org/UsedCondition',
};

const AVAILABILITY_MAP = {
  in_stock: 'https://schema.org/InStock',
  on_the_way: 'https://schema.org/PreOrder',
  reserved: 'https://schema.org/SoldOut',
  sold: 'https://schema.org/SoldOut',
};

export function vehicleSchema(v: VehicleInput) {
  const name = [v.brand, v.model, v.trim].filter(Boolean).join(' ');

  const schema: Record<string, any> = {
    '@context': 'https://schema.org',
    '@type': 'Vehicle',
    '@id': v.url + '#vehicle',
    url: v.url,
    name,
    brand: { '@type': 'Brand', name: v.brand },
    model: v.model,
    vehicleModelDate: v.year ? String(v.year) : undefined,
    vehicleIdentificationNumber: v.vin ?? undefined,
    mileageFromOdometer:
      v.km != null
        ? { '@type': 'QuantitativeValue', value: v.km, unitCode: 'KMT' }
        : undefined,
    itemCondition: CONDITION_MAP[v.condition],
    fuelType: v.fuelType,
    vehicleTransmission: v.transmission ?? undefined,
    driveWheelConfiguration: v.drivetrain ?? undefined,
    color: v.color ?? undefined,
    description: v.description,
    image: v.photoUrls.length > 0 ? v.photoUrls : undefined,
    offers: v.priceCzk
      ? {
          '@type': 'Offer',
          url: v.url,
          priceCurrency: 'CZK',
          price: v.priceCzk,
          availability: AVAILABILITY_MAP[v.availability],
          itemCondition: CONDITION_MAP[v.condition],
          seller: { '@id': `${SITE_URL}/#dealer` },
        }
      : undefined,
  };

  // Strip undefined to keep JSON clean
  Object.keys(schema).forEach((k) => schema[k] === undefined && delete schema[k]);
  return schema;
}

/**
 * Product schema (alternativní pohled na vehicle — pro Google Shopping).
 */
export function vehicleProductSchema(v: VehicleInput) {
  const name = [v.brand, v.model, v.trim].filter(Boolean).join(' ');
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    brand: { '@type': 'Brand', name: v.brand },
    description: v.description,
    image: v.photoUrls.length > 0 ? v.photoUrls : undefined,
    sku: v.vin ?? undefined,
    offers: v.priceCzk
      ? {
          '@type': 'Offer',
          url: v.url,
          priceCurrency: 'CZK',
          price: v.priceCzk,
          availability: AVAILABILITY_MAP[v.availability],
          itemCondition: CONDITION_MAP[v.condition],
        }
      : undefined,
  };
}

/**
 * Article schema pro magazín.
 */
interface ArticleInput {
  url: string;
  title: string;
  description?: string;
  image?: string | null;
  datePublished: string;
  dateModified?: string;
  authorName?: string;
}
export function articleSchema(a: ArticleInput) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: a.title,
    description: a.description,
    image: a.image ? [a.image] : undefined,
    datePublished: a.datePublished,
    dateModified: a.dateModified ?? a.datePublished,
    author: { '@type': 'Person', name: a.authorName ?? 'SFR Motor' },
    publisher: {
      '@type': 'Organization',
      name: COMPANY.name,
      logo: { '@type': 'ImageObject', url: COMPANY.logo },
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': a.url },
  };
}

/**
 * Product schema pro model (s "od X Kč" ceny).
 */
interface ModelInput {
  url: string;
  brand: string;
  name: string;
  description?: string;
  image?: string | null;
  priceFromCzk?: number | null;
}
export function modelSchema(m: ModelInput) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: `${m.brand} ${m.name}`,
    brand: { '@type': 'Brand', name: m.brand },
    description: m.description,
    image: m.image ? [m.image] : undefined,
    offers: m.priceFromCzk
      ? {
          '@type': 'AggregateOffer',
          url: m.url,
          priceCurrency: 'CZK',
          lowPrice: m.priceFromCzk,
          seller: { '@id': `${SITE_URL}/#dealer` },
        }
      : undefined,
  };
}

/**
 * WebSite schema (sitelinks search box).
 */
export function websiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    url: SITE_URL,
    name: 'SFR Motor',
    publisher: { '@id': `${SITE_URL}/#dealer` },
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${SITE_URL}/sklad?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
    inLanguage: 'cs-CZ',
  };
}
