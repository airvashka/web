/**
 * Hlavní TypeScript typy pro celý web.
 * Mapuje se 1:1 na Directus collections (viz directus-schema/).
 */

export type Status = 'draft' | 'published' | 'archived';

export interface Brand {
  id: string;
  slug: string;          // 'kgm' | 'omoda-jaecoo' | 'farizon'
  name: string;
  description?: string;
  logo_url?: string;
  primary_color?: string;
  hero_image?: string;
  previous_names?: string[];  // např. ["SsangYong"]
  status: Status;
  sort?: number;
}

export interface SubBrand {
  id: string;
  brand_id: string;
  slug: string;          // 'omoda' | 'jaecoo'
  name: string;
  logo_url?: string;
  primary_color?: string;
  description?: string;
}

export type FuelType = 'petrol' | 'diesel' | 'hybrid' | 'phev' | 'ev';
export type Transmission = 'manual' | 'automatic' | 'cvt' | 'dct' | 'dht';
export type Drivetrain = 'fwd' | 'rwd' | 'awd' | '4wd';
export type BodyType = 'suv' | 'hatchback' | 'sedan' | 'pickup' | 'van' | 'mpv';

export interface Model {
  id: string;
  brand_id: string;
  sub_brand_id?: string;
  slug: string;          // 'korando' | 'torres-evx' | 'omoda-9-shs'
  name: string;
  tagline?: string;      // "Inspirace pro každý den"
  description?: string;  // rich text / markdown
  body_type?: BodyType;
  hero_image?: string;
  gallery?: string[];
  price_from?: number;
  related_model_ids?: string[];
  status: Status;
  sort?: number;
}

export interface ModelYear {
  id: string;
  model_id: string;
  year: number;
  technical_data?: Record<string, string | number>;
  color_options?: ColorOption[];
  price_list_pdf_url?: string;
  brochure_pdf_url?: string;
  status: Status;
}

export interface ColorOption {
  code: string;          // 'WAA', 'LAK', 'BAS'
  name: string;          // 'GRAND bílá'
  hex?: string;
  preview_image_url?: string;
  price_extra?: number;
}

export interface TrimLevel {
  id: string;
  model_year_id: string;
  slug: string;          // 'style', 'style-plus', 'premium-plus'
  name: string;          // 'Style+', 'Premium+'
  description?: string;
  list_price?: number;
  promo_price?: number;
  features?: string[];   // standardní výbava
  status: Status;
  sort?: number;
}

export interface OptionPackage {
  id: string;
  model_year_id: string;
  slug: string;          // 'black-paket', 'tech-paket'
  name: string;          // 'BLACK paket', 'TECH paket'
  description?: string;
  features?: string[];
  pricing_per_trim?: Record<string, number | 'standard' | 'not_available'>;
  prerequisites?: string[];  // IDs of OptionPackages required
  conflicts?: string[];      // IDs of OptionPackages that cannot coexist
}

export type VehicleCondition = 'new' | 'demo' | 'used';
export type VehicleAvailability = 'in_stock' | 'on_the_way' | 'reserved' | 'sold';

export interface StockVehicle {
  id: string;
  vin?: string;
  brand_id: string;
  model_id: string;
  model_year_id: string;
  trim_level_id?: string;
  trim_level_snapshot?: Record<string, unknown>;  // snapshot v okamžiku přidání

  option_packages?: string[];                      // FK na OptionPackages
  option_packages_snapshot?: Record<string, unknown>[];

  extra_features?: string[];                        // volný text mimo packety

  color_code?: string;
  interior_code?: string;

  list_price?: number;     // ceníková
  promo_price?: number;    // akční
  lowest_price_30d?: number;  // auto z price_history
  monthly_payment_from?: number;

  condition: VehicleCondition;
  availability: VehicleAvailability;
  km?: number;
  first_registration?: string;  // ISO date

  branch_id?: string;
  photos?: string[];       // file IDs
  gallery_360_url?: string;

  description?: string;
  highlighted?: boolean;

  status: Status;
  listed_at?: string;
  sold_at?: string;
}

export interface Lead {
  id: string;
  form_type: 'contact' | 'test_drive' | 'service' | 'stock_inquiry' | 'newsletter' | 'callback';
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  message?: string;

  source_model_id?: string;
  source_vehicle_id?: string;
  source_page?: string;

  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;

  status: 'new' | 'contacted' | 'quoted' | 'won' | 'lost';
  assignee_id?: string;

  created_at: string;
  contacted_at?: string;
}

export interface Branch {
  id: string;
  slug: string;
  name: string;
  address: string;
  city: string;
  postal_code: string;
  phone?: string;
  email?: string;
  google_maps_url?: string;
  opening_hours?: Record<string, string>;
}

export interface Employee {
  id: string;
  full_name: string;
  role: string;        // 'Prodejce KGM', 'Servisní technik'
  department: 'sales' | 'service' | 'parts' | 'management';
  email?: string;
  phone?: string;
  photo_url?: string;
  business_card_pdf_url?: string;
  branch_id?: string;
}
