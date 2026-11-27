import { DEMO_CATALOGUE, DEMO_PARAMETER_META, type LabKey, PRODUCT } from './demo-catalogue.js';

// The laboratories of `seed:demo`: invented names (every one says "DEMO"), where they are, and
// what each one offers. A lab offers a coherent set of tests: a building-materials laboratory
// does cement, steel and aggregates, never milk powder.

export type CityName = 'Delhi' | 'Gurugram' | 'Noida' | 'Faridabad' | 'Ghaziabad';

/** Real place names, real pincode ranges, so a city never contradicts its state or pincode. */
export const CITIES: Record<
  CityName,
  {
    stateCode: 'DL' | 'HR' | 'UP';
    district: string;
    pincodes: [number, number];
    lat: number;
    lon: number;
  }
> = {
  Delhi: {
    stateCode: 'DL',
    district: 'New Delhi',
    pincodes: [110_001, 110_096],
    lat: 28.61,
    lon: 77.21,
  },
  Gurugram: {
    stateCode: 'HR',
    district: 'Gurugram',
    pincodes: [122_001, 122_018],
    lat: 28.46,
    lon: 77.03,
  },
  Noida: {
    stateCode: 'UP',
    district: 'Gautam Buddha Nagar',
    pincodes: [201_301, 201_310],
    lat: 28.54,
    lon: 77.39,
  },
  Faridabad: {
    stateCode: 'HR',
    district: 'Faridabad',
    pincodes: [121_001, 121_010],
    lat: 28.41,
    lon: 77.31,
  },
  Ghaziabad: {
    stateCode: 'UP',
    district: 'Ghaziabad',
    pincodes: [201_001, 201_015],
    lat: 28.67,
    lon: 77.45,
  },
};

export const CITY_NAMES = Object.keys(CITIES) as CityName[];

// ---------------------------------------------------------------- the named labs

const {
  DW,
  GW,
  PW,
  EF,
  COPC,
  CTMT,
  OIL,
  MUS,
  SMP,
  HON,
  TUR,
  CHI,
  MTMT,
  MPLATE,
  MOPC,
  MPPC,
  CAGG,
  FAGG,
  CONC,
  BRK,
  HDPE,
  BDW,
  BPW,
  BSMP,
  BTUR,
  PVC,
  XLPE,
  LED,
  FAN,
  SWITCH,
} = PRODUCT;

export interface NamedSite {
  key: LabKey;
  city: CityName;
  /** Products the site offers; the first one is what the demo bookings are about. */
  products: string[];
}

export interface NamedLab {
  /** Four digits. Also the certificate and site code suffix. Lab 0001 is the idempotency marker. */
  tag: string;
  name: string;
  onboarded: boolean;
  makers: number;
  checkers: number;
  sites: NamedSite[];
}

/**
 * The first three labs are onboarded (four bookable sites). The next four are listed but
 * unclaimed, with names that suit what they offer: two of them are for the claim story.
 */
export const NAMED_LABS: readonly NamedLab[] = [
  {
    tag: '0001',
    name: 'Vasundhara Testing Laboratories (DEMO)',
    onboarded: true,
    makers: 2,
    checkers: 2,
    sites: [
      {
        key: 'vasundhara-gurugram',
        city: 'Gurugram',
        products: [MOPC, MPPC, MTMT, MPLATE, CAGG, FAGG, CONC, BRK, COPC, CTMT],
      },
      {
        key: 'vasundhara-faridabad',
        city: 'Faridabad',
        products: [DW, GW, PW, EF, BDW, COPC, CTMT],
      },
    ],
  },
  {
    tag: '0002',
    name: 'Shivalik Polymer Testing Centre (DEMO)',
    onboarded: true,
    makers: 2,
    checkers: 1,
    sites: [{ key: 'shivalik', city: 'Noida', products: [HDPE, PVC, XLPE] }],
  },
  {
    tag: '0003',
    name: 'Aravali Food and Water Laboratory (DEMO)',
    onboarded: true,
    makers: 1,
    checkers: 1,
    sites: [
      {
        key: 'aravali',
        city: 'Ghaziabad',
        products: [DW, PW, BDW, BPW, OIL, MUS, SMP, HON, TUR, CHI, BSMP, BTUR],
      },
    ],
  },
  {
    tag: '0004',
    name: 'Narmada Analytical Services (DEMO)',
    onboarded: false,
    makers: 0,
    checkers: 0,
    sites: [{ key: 'narmada', city: 'Delhi', products: [HDPE, PVC, LED, SWITCH] }],
  },
  {
    tag: '0005',
    name: 'Kaveri Environmental Testing Laboratory (DEMO)',
    onboarded: false,
    makers: 0,
    checkers: 0,
    sites: [{ key: 'kaveri', city: 'Gurugram', products: [DW, GW, PW, EF, BDW, BPW] }],
  },
  {
    tag: '0006',
    name: 'Tapti Food Analysis Laboratory (DEMO)',
    onboarded: false,
    makers: 0,
    checkers: 0,
    sites: [
      { key: 'tapti', city: 'Ghaziabad', products: [OIL, MUS, SMP, HON, TUR, CHI, BSMP, BTUR] },
    ],
  },
  {
    tag: '0007',
    name: 'Mahi Electrical Testing Laboratory (DEMO)',
    onboarded: false,
    makers: 0,
    checkers: 0,
    sites: [{ key: 'mahi', city: 'Noida', products: [PVC, XLPE, LED, FAN, SWITCH] }],
  },
];

/** The site name: the organisation's name and the city. Both say DEMO. */
export function siteNameOf(labName: string, city: CityName): string {
  return `${labName}, ${city}`;
}

/** The certificate number of site number `siteIndex` (from 0) of lab `tag`, as `createLab` makes it. */
export const certificateNoOf = (tag: string, siteIndex = 0): string =>
  `DEMO-TC-${tag}-${String(siteIndex + 1)}`;

// ---------------------------------------------------------------- the other labs

/** What a lab of this kind offers, in the order people ask for it: popular tests come first. */
export const PROFILES = {
  building: {
    weight: 0.3,
    products: [MOPC, MTMT, CAGG, FAGG, CONC, MPPC, BRK, MPLATE, COPC, CTMT],
    kinds: [
      'Materials Testing Laboratory',
      'Construction Materials Laboratories',
      'Civil Testing Centre',
      'Quality Testing Laboratory',
    ],
  },
  water: {
    weight: 0.22,
    products: [DW, GW, PW, EF, BDW, BPW],
    kinds: [
      'Environmental Testing Laboratory',
      'Water Analysis Laboratories',
      'Analytical Services',
      'Water and Environment Laboratory',
    ],
  },
  food: {
    weight: 0.15,
    products: [OIL, SMP, TUR, HON, MUS, CHI, BSMP, BTUR, BPW, PW],
    kinds: [
      'Food Testing Laboratory',
      'Food Analysis Centre',
      'Food and Agri Laboratories',
      'Food Quality Laboratory',
    ],
  },
  electrical: {
    weight: 0.13,
    products: [PVC, LED, FAN, SWITCH, XLPE, HDPE],
    kinds: [
      'Electrical Testing Laboratory',
      'Cable and Polymer Testing Centre',
      'Electro-Technical Laboratories',
    ],
  },
  chemical: {
    weight: 0.12,
    products: [DW, EF, COPC, CTMT, OIL, GW, SMP, HON, TUR],
    kinds: [
      'Analytical Laboratories',
      'Chemical Testing Laboratory',
      'Analytical Research Laboratory',
    ],
  },
  mechanical: {
    weight: 0.08,
    products: [MTMT, MPLATE, MOPC, CAGG, CONC, HDPE, FAGG, BRK, MPPC],
    kinds: [
      'Metals and Materials Laboratory',
      'Mechanical Testing Laboratory',
      'Testing and Inspection Laboratory',
    ],
  },
} as const;

export type ProfileName = keyof typeof PROFILES;
export const PROFILE_NAMES = Object.keys(PROFILES) as ProfileName[];

/**
 * Invented names made of the names of rivers, hills and regions of India, of trees and of
 * birds. None is the name of a company, a laboratory or a person as far as we can tell; every
 * name that is built from them carries "(DEMO)" in any case. The words of the named labs
 * (Vasundhara, Shivalik, Aravali, Narmada, Kaveri, Tapti, Mahi) are not used again.
 */
export const NAME_WORDS: readonly string[] = [
  'Godavari',
  'Mahanadi',
  'Sutlej',
  'Beas',
  'Chenab',
  'Gomti',
  'Ghaghra',
  'Betwa',
  'Chambal',
  'Periyar',
  'Tungabhadra',
  'Pennar',
  'Sabarmati',
  'Luni',
  'Sarayu',
  'Kosi',
  'Gandak',
  'Teesta',
  'Indravati',
  'Wainganga',
  'Manjira',
  'Bhima',
  'Hemavati',
  'Netravati',
  'Sharavati',
  'Mandovi',
  'Zuari',
  'Tamraparni',
  'Vaigai',
  'Vindhya',
  'Satpura',
  'Nilgiri',
  'Sahyadri',
  'Himadri',
  'Dhauladhar',
  'Pirpanjal',
  'Kumaon',
  'Garhwal',
  'Malwa',
  'Doab',
  'Terai',
  'Konkan',
  'Deccan',
  'Bundelkhand',
  'Mewar',
  'Marwar',
  'Rohilkhand',
  'Awadh',
  'Braj',
  'Hadoti',
  'Shekhawati',
  'Mahakoshal',
  'Malabar',
  'Kutch',
  'Saurashtra',
  'Vidarbha',
  'Marathwada',
  'Rayalaseema',
  'Coromandel',
  'Bastar',
  'Baghelkhand',
  'Mithila',
  'Magadh',
  'Kalinga',
  'Utkal',
  'Kamrup',
  'Deodar',
  'Chinar',
  'Palash',
  'Amaltas',
  'Gulmohar',
  'Kachnar',
  'Mahua',
  'Sheesham',
  'Jamun',
  'Bael',
  'Saptaparni',
  'Sarus',
  'Koel',
  'Chakor',
  'Sarang',
  'Tilori',
  'Purvanchal',
  'Uttarayan',
  'Dakshin',
  'Paschim',
  'Subansiri',
  'Barak',
  'Dibang',
  'Pinjore',
  'Ranthambore',
  'Kanha',
  'Pench',
  'Tadoba',
  'Nagarhole',
  'Bandipur',
  'Silent Valley',
  'Wayanad',
  'Coorg',
  'Kodagu',
];

// ---------------------------------------------------------------- prices of the bookable sites

/** How a bookable site prices and times a test relative to the catalogue's reference price. */
export const SITE_TERMS: Record<string, { priceFactor: number; tatShift: number }> = {
  'vasundhara-gurugram': { priceFactor: 1, tatShift: 0 },
  'vasundhara-faridabad': { priceFactor: 1.08, tatShift: 1 },
  shivalik: { priceFactor: 0.95, tatShift: -1 },
  aravali: { priceFactor: 1.12, tatShift: 1 },
};

function hash(text: string): number {
  let value = 17;
  for (const char of text) value = (Math.imul(value, 31) + (char.codePointAt(0) ?? 0)) | 0;
  return Math.abs(value);
}

/** Price in paise and turnaround in days of a test at a bookable site. Whole rupees, a multiple of 10. */
export function termsFor(
  siteKey: LabKey,
  parameterCode: string,
): { pricePaise: bigint; tatDays: number } {
  const meta = DEMO_PARAMETER_META.get(parameterCode);
  const terms = SITE_TERMS[siteKey];
  if (!meta || !terms) throw new Error(`No price terms for ${siteKey} and ${parameterCode}.`);
  const jitter = 1 + ((hash(`${siteKey}|${parameterCode}`) % 11) - 5) * 0.02;
  const rupees = Math.max(
    200,
    Math.round((meta.priceRupees * terms.priceFactor * jitter) / 10) * 10,
  );
  return { pricePaise: BigInt(rupees) * 100n, tatDays: Math.max(1, meta.tatDays + terms.tatShift) };
}

/** Parameter codes of a product, in catalogue order. */
export function parameterCodesOf(productCode: string): string[] {
  for (const discipline of DEMO_CATALOGUE) {
    for (const group of discipline.groups) {
      const product = group.products.find((candidate) => candidate.code === productCode);
      if (product) return product.parameters.map((parameter) => parameter.code);
    }
  }
  throw new Error(`Unknown product ${productCode}.`);
}

/** Whether a lab may offer a parameter at all: it has no exclusive list, or the lab is on it. */
export function offeredBy(parameterCode: string, key: LabKey | null): boolean {
  const only = DEMO_PARAMETER_META.get(parameterCode)?.only;
  if (only === undefined) return true;
  return key !== null && only.includes(key);
}
