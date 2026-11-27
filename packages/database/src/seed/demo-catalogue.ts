import type { CatalogueSpec, FlatSpec, ProductSpec } from '../factories/world.js';

// The catalogue of `seed:demo`: well-known industrial tests, written by hand, organised the way
// the master data is (discipline, group, product, parameter, with a method and a unit).
//
// This is generic knowledge about tests, not NABL data and not a copy of any laboratory's scope.
// The codes start with `DEMO_` and every node carries the attribute `demo: true`, so the demo
// master data stays recognisable without a "DEMO" in the names people search for.
// Standards are given only where the standard really covers the test; anything else is a plain
// method name with no standard code. Nothing here is invented: if you doubt a line, remove it.

// ---------------------------------------------------------------- units

/** Units of results. `MM` is the millimetre that `seed:reference` already has. */
const UNIT_LIST = [
  ['MG_PER_L', 'mg/L'],
  ['PH', 'pH units'],
  ['NTU', 'NTU'],
  ['US_PER_CM', 'µS/cm'],
  ['PERCENT', '%'],
  ['PERCENT_PASSING', '% passing'],
  ['N_PER_MM2', 'N/mm²'],
  ['MPA', 'MPa'],
  ['M2_PER_KG', 'm²/kg'],
  ['MIN', 'min'],
  ['KG_PER_M3', 'kg/m³'],
  ['KG_PER_M', 'kg/m'],
  ['HBW', 'HBW'],
  ['JOULE', 'J'],
  ['RATIO', 'ratio'],
  ['PASS_FAIL', 'Pass/Fail'],
  ['G_PER_10MIN', 'g/10 min'],
  ['G_PER_CM3', 'g/cm³'],
  ['OHM_PER_KM', 'Ω/km'],
  ['MOHM_KM', 'MΩ·km'],
  ['MOHM', 'MΩ'],
  ['KV', 'kV'],
  ['KELVIN', 'K'],
  ['LM', 'lm'],
  ['WATT', 'W'],
  ['LM_PER_W', 'lm/W'],
  ['RA', 'Ra'],
  ['M3_PER_MIN', 'm³/min'],
  ['M3_PER_MIN_PER_W', 'm³/min per W'],
  ['CFU_PER_ML', 'cfu/mL'],
  ['CFU_PER_G', 'cfu/g'],
  ['MPN_PER_100ML', 'MPN/100 mL'],
  ['PER_25G', 'per 25 g'],
  ['MG_PER_KG', 'mg/kg'],
  ['UG_PER_KG', 'µg/kg'],
  ['MG_KOH_PER_G', 'mg KOH/g'],
  ['MEQ_PER_KG', 'meq O₂/kg'],
  ['G_I2_PER_100G', 'g I₂/100 g'],
  ['BQ_PER_L', 'Bq/L'],
] as const;

type OwnUnit = (typeof UNIT_LIST)[number][0];
/** Units of the reference seed that the catalogue reuses (as result units and sample sizes). */
type ReferenceUnit = 'MM' | 'KG' | 'G' | 'L' | 'ML' | 'M' | 'PIECE';
type Unit = OwnUnit | ReferenceUnit;

const REFERENCE_UNITS: [ReferenceUnit, string][] = [
  ['MM', 'mm'],
  ['KG', 'kg'],
  ['G', 'g'],
  ['L', 'L'],
  ['ML', 'mL'],
  ['M', 'm'],
  ['PIECE', 'piece'],
];

function isReference(unit: Unit): unit is ReferenceUnit {
  return REFERENCE_UNITS.some(([code]) => code === unit);
}
const unitCode = (unit: Unit): string => (isReference(unit) ? unit : `DEMO_UNIT_${unit}`);

// ---------------------------------------------------------------- methods

interface Method {
  name: string;
  /** Present only where the standard really covers this test. */
  standard?: string;
}

const METHOD_LIST = {
  // water and waste water: IS 3025, methods of sampling and test for water and waste water
  ph: { name: 'pH by electrometric method', standard: 'IS 3025 (Part 11)' },
  tds: { name: 'Filterable residue (total dissolved solids)', standard: 'IS 3025 (Part 16)' },
  tss: { name: 'Non-filterable residue (total suspended solids)', standard: 'IS 3025 (Part 17)' },
  turb: { name: 'Turbidity by nephelometry', standard: 'IS 3025 (Part 10)' },
  hard: { name: 'Total hardness by EDTA titration', standard: 'IS 3025 (Part 21)' },
  chlor: { name: 'Chloride by argentometric titration', standard: 'IS 3025 (Part 32)' },
  alk: { name: 'Alkalinity by titration', standard: 'IS 3025 (Part 23)' },
  sulph: { name: 'Sulphate by turbidimetry or gravimetry', standard: 'IS 3025 (Part 24)' },
  do: { name: 'Dissolved oxygen by iodometric method', standard: 'IS 3025 (Part 38)' },
  bod: { name: 'Biochemical oxygen demand, 3 days at 27 °C', standard: 'IS 3025 (Part 44)' },
  cod: { name: 'Chemical oxygen demand by dichromate reflux', standard: 'IS 3025 (Part 58)' },
  cl2: { name: 'Residual chlorine', standard: 'IS 3025 (Part 26)' },
  fluor: { name: 'Fluoride by SPADNS spectrophotometry or ion-selective electrode' },
  nitr: { name: 'Nitrate by UV spectrophotometry' },
  cond: { name: 'Electrical conductivity by conductivity meter' },
  og: { name: 'Oil and grease by partition-gravimetric method' },
  aas: { name: 'Atomic absorption spectrometry' },
  icp: { name: 'ICP-OES' },
  alpha: { name: 'Gross alpha counting' },
  coli: { name: 'Microbiological examination of water', standard: 'IS 1622' },
  // cement
  c_chem: { name: 'Chemical analysis of hydraulic cement', standard: 'IS 4032' },
  c_sieve: { name: 'Fineness of cement by dry sieving', standard: 'IS 4031 (Part 1)' },
  c_blaine: { name: 'Fineness of cement by Blaine air permeability', standard: 'IS 4031 (Part 2)' },
  c_sound: { name: 'Soundness of cement by Le Chatelier method', standard: 'IS 4031 (Part 3)' },
  c_cons: { name: 'Standard consistency of cement', standard: 'IS 4031 (Part 4)' },
  c_set: { name: 'Initial and final setting times of cement', standard: 'IS 4031 (Part 5)' },
  c_cs: { name: 'Compressive strength of hydraulic cement', standard: 'IS 4031 (Part 6)' },
  // metals
  oes: { name: 'Optical emission spectrometry' },
  ce: { name: 'Carbon equivalent, calculated from chemical analysis' },
  tens: { name: 'Tensile test of metallic materials at ambient temperature', standard: 'IS 1608' },
  ratio: { name: 'Ratio of ultimate to yield stress, from the tensile test', standard: 'IS 1608' },
  bend: { name: 'Bend test of metallic materials', standard: 'IS 1599' },
  rebend: { name: 'Re-bend test of reinforcement bars', standard: 'IS 1786' },
  mass: { name: 'Mass per metre of reinforcement bars', standard: 'IS 1786' },
  charpy: { name: 'Charpy V-notch impact test' },
  brinell: { name: 'Brinell hardness test of metallic materials', standard: 'IS 1500' },
  // aggregates, concrete and bricks
  a_grade: { name: 'Particle size distribution by sieve analysis', standard: 'IS 2386 (Part 1)' },
  a_flak: { name: 'Flakiness index of aggregate', standard: 'IS 2386 (Part 1)' },
  a_elong: { name: 'Elongation index of aggregate', standard: 'IS 2386 (Part 1)' },
  a_silt: { name: 'Clay, fine silt and fine dust in aggregate', standard: 'IS 2386 (Part 2)' },
  a_abs: { name: 'Water absorption of aggregate', standard: 'IS 2386 (Part 3)' },
  a_bulk: { name: 'Bulk density of aggregate', standard: 'IS 2386 (Part 3)' },
  a_bulking: { name: 'Bulking of fine aggregate', standard: 'IS 2386 (Part 3)' },
  a_impact: { name: 'Aggregate impact value', standard: 'IS 2386 (Part 4)' },
  a_crush: { name: 'Aggregate crushing value', standard: 'IS 2386 (Part 4)' },
  a_abrasion: { name: 'Los Angeles abrasion value of aggregate', standard: 'IS 2386 (Part 4)' },
  k_cs: { name: 'Compressive strength of concrete cubes', standard: 'IS 516' },
  k_split: { name: 'Splitting tensile strength of concrete', standard: 'IS 5816' },
  k_slump: { name: 'Slump of fresh concrete', standard: 'IS 1199' },
  b_cs: { name: 'Compressive strength of bricks', standard: 'IS 3495 (Part 1)' },
  b_abs: { name: 'Water absorption of bricks', standard: 'IS 3495 (Part 2)' },
  // oils and fats, food
  o_acid: { name: 'Acid value of oils and fats', standard: 'IS 548' },
  o_ffa: { name: 'Free fatty acids of oils and fats', standard: 'IS 548' },
  o_per: { name: 'Peroxide value of oils and fats', standard: 'IS 548' },
  o_iod: { name: 'Iodine value of oils and fats', standard: 'IS 548' },
  o_sap: { name: 'Saponification value of oils and fats', standard: 'IS 548' },
  gc: { name: 'Fatty acid composition by gas chromatography' },
  oven: { name: 'Moisture by oven drying' },
  kjel: { name: 'Protein by Kjeldahl nitrogen determination' },
  fat: { name: 'Fat by Röse-Gottlieb method' },
  acidity: { name: 'Titratable acidity by titration' },
  ash: { name: 'Total ash by incineration' },
  ash_ins: { name: 'Acid-insoluble ash by gravimetry' },
  hmf: { name: 'Hydroxymethylfurfural by HPLC' },
  sugars: { name: 'Reducing sugars by Lane-Eynon titration' },
  curcumin: { name: 'Curcumin by spectrophotometry' },
  afla: { name: 'Aflatoxin B1 by HPLC with fluorescence detection' },
  pest: { name: 'Multi-residue pesticide screen by GC-MS/MS and LC-MS/MS' },
  plate: { name: 'Aerobic plate count by pour plate method' },
  fcoli: { name: 'Coliform count by pour plate method' },
  yeast: { name: 'Yeast and mould count by pour plate method' },
  salm: { name: 'Detection of Salmonella' },
  staph: { name: 'Staphylococcus aureus count' },
  // polymers
  mfr: { name: 'Melt flow rate by extrusion plastometer', standard: 'IS 2530' },
  dens: { name: 'Density of plastics by immersion method', standard: 'ISO 1183-1' },
  cb: { name: 'Carbon black content by calcination and pyrolysis', standard: 'ISO 6964' },
  oit: { name: 'Oxidation induction time by DSC', standard: 'ISO 11357-6' },
  ten_pl: { name: 'Tensile properties of plastics', standard: 'ISO 527-2' },
  dim: { name: 'Dimensions by micrometer or vernier caliper' },
  // electrical
  cab: { name: 'Methods of test for cables', standard: 'IS 10810' },
  led: { name: 'Photometric and electrical tests of LED lamps', standard: 'IS 16102 (Part 2)' },
  fan: { name: 'Performance tests of ceiling fans', standard: 'IS 374' },
  sw: { name: 'Electrical tests of switches for household use', standard: 'IS 3854' },
} satisfies Record<string, Method>;

type MethodKey = keyof typeof METHOD_LIST;
const methodCode = (key: MethodKey): string => `DEMO_METHOD_${key.toUpperCase()}`;

// ---------------------------------------------------------------- parameters

/** Keys of the labs that the catalogue names (see `demo-labs.ts`). */
export type LabKey =
  | 'vasundhara-gurugram'
  | 'vasundhara-faridabad'
  | 'shivalik'
  | 'aravali'
  | 'narmada'
  | 'kaveri'
  | 'tapti'
  | 'mahi';

/** What the labs file needs to know about a parameter beyond the master data. */
export interface ParameterMeta {
  code: string;
  productCode: string;
  priceRupees: number;
  tatDays: number;
  /** Absent: offered like any other test. An empty list: no lab offers it. */
  only?: readonly LabKey[];
}

const parameterMeta: ParameterMeta[] = [];

const slug = (name: string): string =>
  name
    .replaceAll(/\(.*?\)/g, '')
    .trim()
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]+/g, '_')
    .replaceAll(/^_|_$/g, '');

/**
 * One parameter: name, result unit, method, price in rupees, turnaround in days, the range a lab
 * can report, what people type for it, and (rarely) the only labs that offer it.
 */
function p(
  productCode: string,
  name: string,
  unit: Unit,
  method: MethodKey | null,
  priceRupees: number,
  tatDays: number,
  range?: [number, number],
  aliases: string[] = [],
  only?: readonly LabKey[],
): ProductSpec['parameters'][number] {
  const code = `${productCode}_${slug(name)}`;
  parameterMeta.push({ code, productCode, priceRupees, tatDays, ...(only ? { only } : {}) });
  return {
    code,
    name,
    unitCode: unitCode(unit),
    ...(method ? { methodCode: methodCode(method) } : {}),
    ...(range ? { range: { min: range[0], max: range[1] } } : {}),
    ...(aliases.length > 0 ? { aliases } : {}),
  };
}

const sampleOf = (
  qty: number,
  unit: ReferenceUnit,
  packaging: string,
): NonNullable<ProductSpec['sample']> => ({ qty, unitCode: unit, packaging });

const WATER_SAMPLE = sampleOf(
  2,
  'L',
  'Clean polyethylene or glass bottle, rinsed with the sample and filled to the neck. Keep away from sunlight.',
);
const WATER_MICRO_SAMPLE = sampleOf(
  500,
  'ML',
  'Sterile bottle, filled to three quarters and kept cool. Deliver on the day of sampling.',
);
const FOOD_SAMPLE = (qty: number, unit: ReferenceUnit): NonNullable<ProductSpec['sample']> =>
  sampleOf(qty, unit, 'Original sealed pack or a clean, dry, airtight container. Keep cool.');
const FOOD_MICRO_SAMPLE = sampleOf(
  250,
  'G',
  'Original sealed pack or a sterile container. Keep cool and deliver within 24 hours.',
);

const DW = 'DEMO_CHEM_DRINKING_WATER';
const GW = 'DEMO_CHEM_GROUND_WATER';
const PW = 'DEMO_CHEM_PACKAGED_WATER';
const EF = 'DEMO_CHEM_TREATED_EFFLUENT';
const COPC = 'DEMO_CHEM_OPC';
const CTMT = 'DEMO_CHEM_TMT';
const OIL = 'DEMO_CHEM_EDIBLE_OIL';
const MUS = 'DEMO_CHEM_MUSTARD_OIL';
const SMP = 'DEMO_CHEM_MILK_POWDER';
const HON = 'DEMO_CHEM_HONEY';
const TUR = 'DEMO_CHEM_TURMERIC';
const CHI = 'DEMO_CHEM_CHILLI';
const MTMT = 'DEMO_MECH_TMT';
const MPLATE = 'DEMO_MECH_STRUCT_STEEL';
const MOPC = 'DEMO_MECH_OPC';
const MPPC = 'DEMO_MECH_PPC';
const CAGG = 'DEMO_MECH_COARSE_AGG';
const FAGG = 'DEMO_MECH_FINE_AGG';
const CONC = 'DEMO_MECH_CONCRETE';
const BRK = 'DEMO_MECH_BRICKS';
const HDPE = 'DEMO_MECH_HDPE';
const BDW = 'DEMO_BIO_DRINKING_WATER';
const BPW = 'DEMO_BIO_PACKAGED_WATER';
const BSMP = 'DEMO_BIO_MILK_POWDER';
const BTUR = 'DEMO_BIO_TURMERIC';
const PVC = 'DEMO_ELEC_PVC_CABLE';
const XLPE = 'DEMO_ELEC_XLPE_CABLE';
const LED = 'DEMO_ELEC_LED_LAMP';
const FAN = 'DEMO_ELEC_CEILING_FAN';
const SWITCH = 'DEMO_ELEC_SWITCH';

/** Codes of the products, for the labs file. */
export const PRODUCT = {
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
} as const;

const chemistry: CatalogueSpec = {
  code: 'DEMO_CHEMICAL',
  name: 'Chemical',
  groups: [
    {
      code: 'DEMO_CHEMICAL_WATER',
      name: 'Water and waste water',
      products: [
        {
          code: DW,
          name: 'Drinking water',
          aliases: ['potable water', 'tap water', 'IS 10500'],
          sample: WATER_SAMPLE,
          parameters: [
            p(DW, 'pH value', 'PH', 'ph', 350, 2, [1, 14]),
            p(
              DW,
              'Total dissolved solids (TDS)',
              'MG_PER_L',
              'tds',
              400,
              2,
              [10, 10000],
              ['TDS', 'dissolved solids', 'filterable residue'],
            ),
            p(
              DW,
              'Total hardness (as CaCO3)',
              'MG_PER_L',
              'hard',
              450,
              2,
              [5, 2000],
              ['hardness', 'total hardness'],
            ),
            p(DW, 'Chloride (as Cl)', 'MG_PER_L', 'chlor', 350, 2, [5, 5000], ['chlorides']),
            p(DW, 'Turbidity', 'NTU', 'turb', 300, 2, [0.1, 500]),
            p(
              DW,
              'Total alkalinity (as CaCO3)',
              'MG_PER_L',
              'alk',
              400,
              2,
              [5, 1500],
              ['alkalinity'],
            ),
            p(DW, 'Sulphate (as SO4)', 'MG_PER_L', 'sulph', 500, 3, [2, 1000], ['sulfate']),
            p(DW, 'Fluoride (as F)', 'MG_PER_L', 'fluor', 600, 3, [0.1, 10], ['fluorides']),
            p(DW, 'Nitrate (as NO3)', 'MG_PER_L', 'nitr', 700, 3, [0.5, 100], ['nitrates']),
            p(
              DW,
              'Residual free chlorine',
              'MG_PER_L',
              'cl2',
              350,
              1,
              [0.05, 10],
              ['free chlorine', 'residual chlorine'],
            ),
            p(DW, 'Iron (as Fe)', 'MG_PER_L', 'aas', 600, 3, [0.05, 20]),
            p(
              DW,
              'Arsenic (as As)',
              'MG_PER_L',
              'icp',
              1800,
              6,
              [0.001, 0.5],
              ['arsenic'],
              ['kaveri', 'vasundhara-faridabad'],
            ),
            p(
              DW,
              'Gross alpha activity',
              'BQ_PER_L',
              'alpha',
              3500,
              10,
              [0.01, 10],
              ['alpha activity', 'radioactivity', 'radioactive materials'],
              [],
            ),
          ],
        },
        {
          code: GW,
          name: 'Ground water',
          aliases: ['borewell water', 'bore well water', 'well water'],
          sample: WATER_SAMPLE,
          parameters: [
            p(GW, 'pH value', 'PH', 'ph', 350, 2, [1, 14]),
            p(
              GW,
              'Total dissolved solids (TDS)',
              'MG_PER_L',
              'tds',
              400,
              2,
              [10, 10000],
              ['TDS', 'dissolved solids'],
            ),
            p(
              GW,
              'Total hardness (as CaCO3)',
              'MG_PER_L',
              'hard',
              450,
              2,
              [5, 2000],
              ['hardness', 'total hardness'],
            ),
            p(GW, 'Chloride (as Cl)', 'MG_PER_L', 'chlor', 350, 2, [5, 5000], ['chlorides']),
            p(GW, 'Fluoride (as F)', 'MG_PER_L', 'fluor', 600, 3, [0.1, 10], ['fluorides']),
            p(GW, 'Nitrate (as NO3)', 'MG_PER_L', 'nitr', 700, 3, [0.5, 100], ['nitrates']),
          ],
        },
        {
          code: PW,
          name: 'Packaged drinking water',
          aliases: ['bottled water', 'mineral water', 'packaged water', 'IS 14543'],
          sample: WATER_SAMPLE,
          parameters: [
            p(PW, 'pH value', 'PH', 'ph', 350, 2, [1, 14]),
            p(
              PW,
              'Total dissolved solids (TDS)',
              'MG_PER_L',
              'tds',
              400,
              2,
              [10, 10000],
              ['TDS', 'dissolved solids'],
            ),
            p(
              PW,
              'Total hardness (as CaCO3)',
              'MG_PER_L',
              'hard',
              450,
              2,
              [5, 2000],
              ['hardness', 'total hardness'],
            ),
            p(PW, 'Chloride (as Cl)', 'MG_PER_L', 'chlor', 350, 2, [5, 5000], ['chlorides']),
            p(PW, 'Sulphate (as SO4)', 'MG_PER_L', 'sulph', 500, 3, [2, 1000], ['sulfate']),
          ],
        },
        {
          code: EF,
          name: 'Treated waste water (effluent)',
          aliases: ['effluent', 'ETP water', 'STP water', 'sewage', 'waste water'],
          sample: WATER_SAMPLE,
          parameters: [
            p(EF, 'pH value', 'PH', 'ph', 350, 2, [1, 14]),
            p(
              EF,
              'Total suspended solids (TSS)',
              'MG_PER_L',
              'tss',
              450,
              2,
              [5, 5000],
              ['TSS', 'suspended solids', 'non-filterable residue'],
            ),
            p(
              EF,
              'Biochemical oxygen demand (BOD, 3 days at 27 °C)',
              'MG_PER_L',
              'bod',
              800,
              5,
              [2, 1000],
              ['BOD', 'biochemical oxygen demand'],
            ),
            p(
              EF,
              'Chemical oxygen demand (COD)',
              'MG_PER_L',
              'cod',
              750,
              3,
              [10, 5000],
              ['COD', 'chemical oxygen demand'],
            ),
            p(EF, 'Oil and grease', 'MG_PER_L', 'og', 900, 3, [1, 500], ['oil & grease']),
          ],
        },
      ],
    },
    {
      code: 'DEMO_CHEMICAL_CONSTRUCTION',
      name: 'Construction materials',
      products: [
        {
          code: COPC,
          name: 'Ordinary Portland cement (OPC)',
          aliases: ['OPC', 'cement', 'Portland cement', 'IS 269'],
          sample: sampleOf(
            5,
            'KG',
            'Airtight polythene bag inside a sealed container. Protect from moisture.',
          ),
          parameters: [
            p(COPC, 'Loss on ignition', 'PERCENT', 'c_chem', 600, 3, [0, 10], ['LOI']),
            p(
              COPC,
              'Insoluble residue',
              'PERCENT',
              'c_chem',
              650,
              3,
              [0, 5],
              ['acid insoluble residue'],
            ),
            p(
              COPC,
              'Magnesia (MgO)',
              'PERCENT',
              'c_chem',
              700,
              4,
              [0, 10],
              ['MgO', 'magnesium oxide'],
            ),
            p(
              COPC,
              'Sulphuric anhydride (SO3)',
              'PERCENT',
              'c_chem',
              700,
              4,
              [0, 5],
              ['SO3', 'sulphur trioxide'],
            ),
          ],
        },
      ],
    },
    {
      code: 'DEMO_CHEMICAL_METALS',
      name: 'Metals and alloys',
      products: [
        {
          code: CTMT,
          name: 'TMT reinforcement bars',
          aliases: [
            'TMT',
            'TMT bars',
            'thermo-mechanically treated bars',
            'rebar',
            'reinforcement bar',
            'IS 1786',
            'Fe 500',
          ],
          sample: sampleOf(
            3,
            'PIECE',
            'Three bar pieces, each about 1 m long, marked with the heat number.',
          ),
          parameters: [
            p(CTMT, 'Carbon (C)', 'PERCENT', 'oes', 450, 3, [0.01, 1], ['carbon content']),
            p(
              CTMT,
              'Sulphur (S)',
              'PERCENT',
              'oes',
              450,
              3,
              [0.001, 0.2],
              ['sulphur content', 'sulfur'],
            ),
            p(
              CTMT,
              'Phosphorus (P)',
              'PERCENT',
              'oes',
              450,
              3,
              [0.001, 0.2],
              ['phosphorus content'],
            ),
            p(
              CTMT,
              'Carbon equivalent (CE)',
              'PERCENT',
              'ce',
              500,
              3,
              [0.1, 0.8],
              ['carbon equivalent'],
            ),
          ],
        },
      ],
    },
    {
      code: 'DEMO_CHEMICAL_FOOD',
      name: 'Food and agricultural products',
      products: [
        {
          code: OIL,
          name: 'Refined edible oil',
          aliases: ['edible oil', 'cooking oil', 'vegetable oil', 'refined oil'],
          sample: sampleOf(500, 'ML', 'Dry, clean glass bottle, filled completely and sealed.'),
          parameters: [
            p(OIL, 'Acid value', 'MG_KOH_PER_G', 'o_acid', 400, 3, [0.05, 20], ['acid value']),
            p(
              OIL,
              'Free fatty acids (as oleic acid)',
              'PERCENT',
              'o_ffa',
              400,
              3,
              [0.02, 10],
              ['FFA', 'free fatty acids'],
            ),
            p(OIL, 'Peroxide value', 'MEQ_PER_KG', 'o_per', 450, 3, [0.1, 50], ['peroxide value']),
            p(OIL, 'Iodine value', 'G_I2_PER_100G', 'o_iod', 500, 4, [10, 200], ['iodine value']),
            p(
              OIL,
              'Saponification value',
              'MG_KOH_PER_G',
              'o_sap',
              450,
              4,
              [150, 300],
              ['saponification value'],
            ),
            p(
              OIL,
              'Moisture and volatile matter',
              'PERCENT',
              'oven',
              300,
              2,
              [0.01, 5],
              ['moisture'],
            ),
          ],
        },
        {
          code: MUS,
          name: 'Mustard oil',
          aliases: ['sarson oil', 'edible oil'],
          sample: sampleOf(500, 'ML', 'Dry, clean glass bottle, filled completely and sealed.'),
          parameters: [
            p(MUS, 'Acid value', 'MG_KOH_PER_G', 'o_acid', 400, 3, [0.05, 20], ['acid value']),
            p(MUS, 'Iodine value', 'G_I2_PER_100G', 'o_iod', 500, 4, [10, 200], ['iodine value']),
            p(
              MUS,
              'Saponification value',
              'MG_KOH_PER_G',
              'o_sap',
              450,
              4,
              [150, 300],
              ['saponification value'],
            ),
            p(MUS, 'Peroxide value', 'MEQ_PER_KG', 'o_per', 450, 3, [0.1, 50], ['peroxide value']),
            p(
              MUS,
              'Erucic acid',
              'PERCENT',
              'gc',
              1800,
              6,
              [0.1, 60],
              ['erucic'],
              ['tapti', 'aravali'],
            ),
          ],
        },
        {
          code: SMP,
          name: 'Skimmed milk powder',
          aliases: ['SMP', 'milk powder', 'dairy powder', 'IS 13334'],
          sample: FOOD_SAMPLE(250, 'G'),
          parameters: [
            p(SMP, 'Moisture', 'PERCENT', 'oven', 300, 2, [0.1, 10], ['moisture content']),
            p(SMP, 'Milk fat', 'PERCENT', 'fat', 500, 3, [0.1, 40], ['fat content', 'fat']),
            p(
              SMP,
              'Total protein (N × 6.38)',
              'PERCENT',
              'kjel',
              600,
              3,
              [1, 60],
              ['protein', 'Kjeldahl'],
            ),
            p(
              SMP,
              'Titratable acidity (as lactic acid)',
              'PERCENT',
              'acidity',
              350,
              2,
              [0.05, 3],
              ['acidity'],
            ),
            p(SMP, 'Total ash', 'PERCENT', 'ash', 400, 3, [0.1, 15], ['ash content', 'ash']),
          ],
        },
        {
          code: HON,
          name: 'Honey',
          aliases: ['extracted honey', 'IS 4941'],
          sample: FOOD_SAMPLE(250, 'G'),
          parameters: [
            p(HON, 'Moisture', 'PERCENT', 'oven', 300, 2, [5, 30], ['moisture content']),
            p(HON, 'Hydroxymethylfurfural (HMF)', 'MG_PER_KG', 'hmf', 1200, 4, [1, 500], ['HMF']),
            p(
              HON,
              'Total reducing sugars',
              'PERCENT',
              'sugars',
              700,
              3,
              [10, 90],
              ['reducing sugars'],
            ),
          ],
        },
        {
          code: TUR,
          name: 'Turmeric powder',
          aliases: ['haldi', 'ground turmeric', 'IS 3576'],
          sample: FOOD_SAMPLE(250, 'G'),
          parameters: [
            p(TUR, 'Moisture', 'PERCENT', 'oven', 300, 2, [1, 20], ['moisture content']),
            p(TUR, 'Total ash', 'PERCENT', 'ash', 400, 3, [0.5, 15], ['ash content', 'ash']),
            p(
              TUR,
              'Acid-insoluble ash',
              'PERCENT',
              'ash_ins',
              450,
              3,
              [0.05, 5],
              ['acid insoluble ash'],
            ),
            p(TUR, 'Curcumin content', 'PERCENT', 'curcumin', 900, 4, [0.1, 10], ['curcumin']),
          ],
        },
        {
          code: CHI,
          name: 'Red chilli powder',
          aliases: ['chilli powder', 'chili powder', 'lal mirch'],
          sample: FOOD_SAMPLE(250, 'G'),
          parameters: [
            p(CHI, 'Moisture', 'PERCENT', 'oven', 300, 2, [1, 20], ['moisture content']),
            p(CHI, 'Total ash', 'PERCENT', 'ash', 400, 3, [0.5, 15], ['ash content', 'ash']),
            p(
              CHI,
              'Acid-insoluble ash',
              'PERCENT',
              'ash_ins',
              450,
              3,
              [0.05, 5],
              ['acid insoluble ash'],
            ),
            p(
              CHI,
              'Aflatoxin B1',
              'UG_PER_KG',
              'afla',
              2500,
              7,
              [0.5, 100],
              ['aflatoxin', 'mycotoxin'],
              ['aravali'],
            ),
            p(
              CHI,
              'Pesticide residues (multi-residue screen)',
              'MG_PER_KG',
              'pest',
              6500,
              10,
              [0.01, 5],
              ['pesticide residue', 'pesticides'],
              ['tapti', 'aravali'],
            ),
          ],
        },
      ],
    },
  ],
};

const mechanical: CatalogueSpec = {
  code: 'DEMO_MECHANICAL',
  name: 'Mechanical',
  groups: [
    {
      code: 'DEMO_MECHANICAL_METALS',
      name: 'Metals and alloys',
      products: [
        {
          code: MTMT,
          name: 'TMT reinforcement bars',
          aliases: [
            'TMT',
            'TMT bars',
            'thermo-mechanically treated bars',
            'rebar',
            'reinforcement bar',
            'IS 1786',
            'Fe 500',
          ],
          sample: sampleOf(
            3,
            'PIECE',
            'Three bar pieces, each about 1 m long, marked with the heat number.',
          ),
          parameters: [
            p(
              MTMT,
              'Tensile strength (UTS)',
              'N_PER_MM2',
              'tens',
              700,
              2,
              [200, 1200],
              ['UTS', 'ultimate tensile strength', 'tensile test'],
            ),
            p(
              MTMT,
              'Yield stress (0.2% proof stress)',
              'N_PER_MM2',
              'tens',
              700,
              2,
              [150, 1000],
              ['yield strength', 'proof stress', 'yield point'],
            ),
            p(MTMT, 'Percentage elongation', 'PERCENT', 'tens', 500, 2, [1, 40], ['elongation']),
            p(MTMT, 'UTS/YS ratio', 'RATIO', 'ratio', 300, 2, [1, 1.5], ['tensile to yield ratio']),
            p(MTMT, 'Bend test', 'PASS_FAIL', 'bend', 400, 2, undefined, ['bend test']),
            p(MTMT, 'Re-bend test', 'PASS_FAIL', 'rebend', 400, 2, undefined, ['rebend test']),
            p(
              MTMT,
              'Mass per metre',
              'KG_PER_M',
              'mass',
              300,
              2,
              [0.1, 20],
              ['weight per metre', 'unit weight'],
            ),
          ],
        },
        {
          code: MPLATE,
          name: 'Structural steel plates',
          aliases: ['mild steel plate', 'MS plate', 'structural steel', 'IS 2062', 'E250'],
          sample: sampleOf(2, 'PIECE', 'Cut coupons marked with the heat number.'),
          parameters: [
            p(
              MPLATE,
              'Tensile strength (UTS)',
              'N_PER_MM2',
              'tens',
              700,
              2,
              [200, 1200],
              ['UTS', 'ultimate tensile strength', 'tensile test'],
            ),
            p(
              MPLATE,
              'Yield stress (0.2% proof stress)',
              'N_PER_MM2',
              'tens',
              700,
              2,
              [150, 1000],
              ['yield strength', 'proof stress', 'yield point'],
            ),
            p(MPLATE, 'Percentage elongation', 'PERCENT', 'tens', 500, 2, [1, 40], ['elongation']),
            p(MPLATE, 'Bend test', 'PASS_FAIL', 'bend', 400, 2, undefined, ['bend test']),
            p(
              MPLATE,
              'Impact energy (Charpy V-notch)',
              'JOULE',
              'charpy',
              1200,
              4,
              [2, 300],
              ['Charpy', 'impact test'],
            ),
            p(
              MPLATE,
              'Brinell hardness',
              'HBW',
              'brinell',
              600,
              3,
              [50, 650],
              ['hardness', 'Brinell'],
            ),
          ],
        },
      ],
    },
    {
      code: 'DEMO_MECHANICAL_CONSTRUCTION',
      name: 'Construction materials',
      products: [
        {
          code: MOPC,
          name: 'Ordinary Portland cement (OPC)',
          aliases: ['OPC', 'cement', 'Portland cement', 'IS 269'],
          sample: sampleOf(
            5,
            'KG',
            'Airtight polythene bag inside a sealed container. Protect from moisture.',
          ),
          parameters: [
            p(
              MOPC,
              'Compressive strength (3, 7 and 28 days)',
              'MPA',
              'c_cs',
              1500,
              7,
              [5, 80],
              ['cement strength', 'cube strength', 'compressive strength'],
            ),
            p(
              MOPC,
              'Fineness by Blaine air permeability',
              'M2_PER_KG',
              'c_blaine',
              600,
              2,
              [100, 600],
              ['Blaine', 'fineness'],
            ),
            p(
              MOPC,
              'Fineness by 90 micron sieve residue',
              'PERCENT',
              'c_sieve',
              400,
              2,
              [0, 20],
              ['fineness by sieving'],
            ),
            p(
              MOPC,
              'Standard consistency',
              'PERCENT',
              'c_cons',
              350,
              1,
              [20, 40],
              ['normal consistency'],
            ),
            p(
              MOPC,
              'Initial and final setting time',
              'MIN',
              'c_set',
              500,
              1,
              [30, 600],
              ['setting time'],
            ),
            p(
              MOPC,
              'Soundness (Le Chatelier expansion)',
              'MM',
              'c_sound',
              500,
              2,
              [0, 20],
              ['soundness', 'Le Chatelier'],
            ),
          ],
        },
        {
          code: MPPC,
          name: 'Portland pozzolana cement (PPC)',
          aliases: ['PPC', 'pozzolana cement', 'cement', 'IS 1489'],
          sample: sampleOf(
            5,
            'KG',
            'Airtight polythene bag inside a sealed container. Protect from moisture.',
          ),
          parameters: [
            p(
              MPPC,
              'Compressive strength (3, 7 and 28 days)',
              'MPA',
              'c_cs',
              1500,
              7,
              [5, 80],
              ['cement strength', 'cube strength', 'compressive strength'],
            ),
            p(
              MPPC,
              'Standard consistency',
              'PERCENT',
              'c_cons',
              350,
              1,
              [20, 40],
              ['normal consistency'],
            ),
            p(
              MPPC,
              'Initial and final setting time',
              'MIN',
              'c_set',
              500,
              1,
              [30, 600],
              ['setting time'],
            ),
            p(
              MPPC,
              'Soundness (Le Chatelier expansion)',
              'MM',
              'c_sound',
              500,
              2,
              [0, 20],
              ['soundness', 'Le Chatelier'],
            ),
          ],
        },
        {
          code: CAGG,
          name: 'Coarse aggregate',
          aliases: ['stone aggregate', 'coarse aggregates', 'gravel', 'IS 383'],
          sample: sampleOf(
            25,
            'KG',
            'Clean, strong bag, sealed. Mark the source and nominal size.',
          ),
          parameters: [
            p(
              CAGG,
              'Sieve analysis (grading)',
              'PERCENT_PASSING',
              'a_grade',
              450,
              2,
              [0, 100],
              ['sieve analysis', 'grading', 'gradation'],
            ),
            p(CAGG, 'Flakiness index', 'PERCENT', 'a_flak', 400, 2, [0, 100], ['flakiness']),
            p(CAGG, 'Elongation index', 'PERCENT', 'a_elong', 400, 2, [0, 100]),
            p(
              CAGG,
              'Aggregate impact value',
              'PERCENT',
              'a_impact',
              600,
              2,
              [0, 60],
              ['impact value', 'AIV'],
            ),
            p(
              CAGG,
              'Aggregate crushing value',
              'PERCENT',
              'a_crush',
              700,
              3,
              [0, 60],
              ['crushing value', 'ACV'],
            ),
            p(
              CAGG,
              'Los Angeles abrasion value',
              'PERCENT',
              'a_abrasion',
              900,
              3,
              [0, 60],
              ['abrasion', 'LA abrasion'],
            ),
            p(CAGG, 'Water absorption', 'PERCENT', 'a_abs', 350, 2, [0, 10], ['absorption']),
            p(CAGG, 'Bulk density', 'KG_PER_M3', 'a_bulk', 300, 1, [800, 2000], ['unit weight']),
          ],
        },
        {
          code: FAGG,
          name: 'Fine aggregate (sand)',
          aliases: [
            'sand',
            'river sand',
            'M-sand',
            'manufactured sand',
            'fine aggregates',
            'IS 383',
          ],
          sample: sampleOf(10, 'KG', 'Clean, strong bag, sealed. Mark the source.'),
          parameters: [
            p(
              FAGG,
              'Sieve analysis (grading zone)',
              'PERCENT_PASSING',
              'a_grade',
              450,
              2,
              [0, 100],
              ['sieve analysis', 'grading', 'gradation'],
            ),
            p(
              FAGG,
              'Silt content (material finer than 75 micron)',
              'PERCENT',
              'a_silt',
              400,
              2,
              [0, 30],
              ['silt', 'clay and silt'],
            ),
            p(FAGG, 'Bulking of sand', 'PERCENT', 'a_bulking', 350, 2, [0, 50], ['bulking']),
            p(FAGG, 'Water absorption', 'PERCENT', 'a_abs', 350, 2, [0, 10], ['absorption']),
          ],
        },
        {
          code: CONC,
          name: 'Concrete',
          aliases: ['concrete cubes', 'cement concrete', 'ready mix concrete', 'RMC', 'IS 456'],
          sample: sampleOf(
            3,
            'PIECE',
            'Three 150 mm cubes, cured, marked with the date of casting and grade.',
          ),
          parameters: [
            p(
              CONC,
              'Compressive strength of concrete cubes',
              'MPA',
              'k_cs',
              400,
              2,
              [5, 100],
              ['cube test', 'cube strength', 'concrete strength', 'compressive strength'],
            ),
            p(
              CONC,
              'Splitting tensile strength',
              'MPA',
              'k_split',
              900,
              3,
              [0.5, 10],
              ['split tensile strength'],
            ),
            p(CONC, 'Slump', 'MM', 'k_slump', 300, 1, [0, 250], ['workability', 'slump test']),
          ],
        },
        {
          code: BRK,
          name: 'Burnt clay bricks',
          aliases: ['bricks', 'clay bricks', 'IS 1077'],
          sample: sampleOf(10, 'PIECE', 'Ten whole bricks, marked with the kiln and batch.'),
          parameters: [
            p(
              BRK,
              'Compressive strength',
              'N_PER_MM2',
              'b_cs',
              600,
              3,
              [1, 60],
              ['brick strength', 'crushing strength'],
            ),
            p(BRK, 'Water absorption', 'PERCENT', 'b_abs', 450, 3, [0, 30], ['absorption']),
          ],
        },
      ],
    },
    {
      code: 'DEMO_MECHANICAL_POLYMERS',
      name: 'Polymers and plastics',
      products: [
        {
          code: HDPE,
          name: 'HDPE pipes and material',
          aliases: ['HDPE', 'HDPE pipe', 'polyethylene pipe', 'PE pipe', 'IS 4984'],
          sample: sampleOf(
            100,
            'G',
            'Granules or pipe offcuts in a sealed polythene bag. Keep away from moisture.',
          ),
          parameters: [
            p(
              HDPE,
              'Melt flow rate (MFR)',
              'G_PER_10MIN',
              'mfr',
              1200,
              5,
              [0.01, 100],
              ['MFR', 'MFI', 'melt flow index'],
            ),
            p(HDPE, 'Density', 'G_PER_CM3', 'dens', 800, 3, [0.8, 1.6], ['relative density']),
            p(HDPE, 'Carbon black content', 'PERCENT', 'cb', 1000, 5, [0.1, 10], ['carbon black']),
            p(
              HDPE,
              'Oxidation induction time (OIT)',
              'MIN',
              'oit',
              2500,
              7,
              [1, 200],
              ['OIT'],
              ['shivalik', 'narmada'],
            ),
            p(
              HDPE,
              'Tensile strength at yield',
              'MPA',
              'ten_pl',
              900,
              4,
              [1, 100],
              ['tensile strength'],
            ),
            p(HDPE, 'Elongation at break', 'PERCENT', 'ten_pl', 900, 4, [10, 1000], ['elongation']),
            p(HDPE, 'Outside diameter', 'MM', 'dim', 250, 1, [10, 1000]),
          ],
        },
      ],
    },
  ],
};

const biological: CatalogueSpec = {
  code: 'DEMO_BIOLOGICAL',
  name: 'Biological',
  groups: [
    {
      code: 'DEMO_BIOLOGICAL_WATER',
      name: 'Water microbiology',
      products: [
        {
          code: BDW,
          name: 'Drinking water',
          aliases: ['potable water', 'tap water', 'IS 10500'],
          sample: WATER_MICRO_SAMPLE,
          parameters: [
            p(
              BDW,
              'Total coliform',
              'MPN_PER_100ML',
              'coli',
              700,
              3,
              [0, 1600],
              ['coliforms', 'coliform count'],
            ),
            p(
              BDW,
              'Escherichia coli (E. coli)',
              'MPN_PER_100ML',
              'coli',
              700,
              3,
              [0, 1600],
              ['E. coli', 'ecoli', 'faecal coliform'],
            ),
            p(
              BDW,
              'Total plate count',
              'CFU_PER_ML',
              'coli',
              600,
              3,
              [0, 10000],
              ['standard plate count', 'SPC', 'TPC'],
            ),
          ],
        },
        {
          code: BPW,
          name: 'Packaged drinking water',
          aliases: ['bottled water', 'mineral water', 'packaged water', 'IS 14543'],
          sample: WATER_MICRO_SAMPLE,
          parameters: [
            p(
              BPW,
              'Total coliform',
              'MPN_PER_100ML',
              'coli',
              700,
              3,
              [0, 1600],
              ['coliforms', 'coliform count'],
            ),
            p(
              BPW,
              'Escherichia coli (E. coli)',
              'MPN_PER_100ML',
              'coli',
              700,
              3,
              [0, 1600],
              ['E. coli', 'ecoli', 'faecal coliform'],
            ),
            p(
              BPW,
              'Total plate count',
              'CFU_PER_ML',
              'coli',
              600,
              3,
              [0, 10000],
              ['standard plate count', 'SPC', 'TPC'],
            ),
          ],
        },
      ],
    },
    {
      code: 'DEMO_BIOLOGICAL_FOOD',
      name: 'Food microbiology',
      products: [
        {
          code: BSMP,
          name: 'Skimmed milk powder',
          aliases: ['SMP', 'milk powder', 'dairy powder', 'IS 13334'],
          sample: FOOD_MICRO_SAMPLE,
          parameters: [
            p(
              BSMP,
              'Total plate count',
              'CFU_PER_G',
              'plate',
              600,
              4,
              [0, 10000000],
              ['standard plate count', 'SPC', 'TPC'],
            ),
            p(
              BSMP,
              'Coliform count',
              'CFU_PER_G',
              'fcoli',
              600,
              3,
              [0, 100000],
              ['coliforms', 'total coliform'],
            ),
            p(
              BSMP,
              'Yeast and mould count',
              'CFU_PER_G',
              'yeast',
              650,
              5,
              [0, 100000],
              ['yeast and mold', 'yeast mould'],
            ),
            p(BSMP, 'Salmonella', 'PER_25G', 'salm', 900, 5, undefined, ['Salmonella detection']),
            p(
              BSMP,
              'Staphylococcus aureus',
              'CFU_PER_G',
              'staph',
              900,
              4,
              [0, 100000],
              ['S. aureus'],
            ),
          ],
        },
        {
          code: BTUR,
          name: 'Turmeric powder',
          aliases: ['haldi', 'ground turmeric', 'IS 3576'],
          sample: FOOD_MICRO_SAMPLE,
          parameters: [
            p(
              BTUR,
              'Total plate count',
              'CFU_PER_G',
              'plate',
              600,
              4,
              [0, 10000000],
              ['standard plate count', 'SPC', 'TPC'],
            ),
            p(
              BTUR,
              'Yeast and mould count',
              'CFU_PER_G',
              'yeast',
              650,
              5,
              [0, 100000],
              ['yeast and mold', 'yeast mould'],
            ),
            p(BTUR, 'Salmonella', 'PER_25G', 'salm', 900, 5, undefined, ['Salmonella detection']),
          ],
        },
      ],
    },
  ],
};

const CABLE_SAMPLE = sampleOf(
  5,
  'M',
  'A 5 m length of the cable with both ends sealed. Keep the reel label.',
);

const electrical: CatalogueSpec = {
  code: 'DEMO_ELECTRICAL',
  name: 'Electrical',
  groups: [
    {
      code: 'DEMO_ELECTRICAL_CABLES',
      name: 'Cables',
      products: [
        {
          code: PVC,
          name: 'PVC insulated copper cables',
          aliases: ['PVC cable', 'house wire', 'wires', 'cables', 'IS 694'],
          sample: CABLE_SAMPLE,
          parameters: [
            p(
              PVC,
              'Conductor resistance',
              'OHM_PER_KM',
              'cab',
              700,
              3,
              [0.5, 5000],
              ['resistance of conductor'],
            ),
            p(PVC, 'Insulation resistance', 'MOHM_KM', 'cab', 700, 3, [0.1, 10000]),
            p(PVC, 'High voltage test', 'KV', 'cab', 800, 3, [0.5, 25], ['voltage test']),
            p(
              PVC,
              'Insulation thickness',
              'MM',
              'cab',
              400,
              2,
              [0.2, 5],
              ['thickness of insulation'],
            ),
            p(PVC, 'Tensile strength of insulation', 'N_PER_MM2', 'cab', 900, 4, [1, 50]),
            p(
              PVC,
              'Elongation at break of insulation',
              'PERCENT',
              'cab',
              900,
              4,
              [10, 800],
              ['elongation'],
            ),
          ],
        },
        {
          code: XLPE,
          name: 'XLPE insulated power cables',
          aliases: ['XLPE cable', 'power cable', 'cables', 'IS 7098'],
          sample: CABLE_SAMPLE,
          parameters: [
            p(
              XLPE,
              'Conductor resistance',
              'OHM_PER_KM',
              'cab',
              700,
              3,
              [0.05, 5000],
              ['resistance of conductor'],
            ),
            p(XLPE, 'Insulation resistance', 'MOHM_KM', 'cab', 700, 3, [0.1, 100000]),
            p(XLPE, 'High voltage test', 'KV', 'cab', 1500, 4, [0.5, 100], ['voltage test']),
            p(XLPE, 'Tensile strength of insulation', 'N_PER_MM2', 'cab', 900, 4, [1, 50]),
            p(
              XLPE,
              'Elongation at break of insulation',
              'PERCENT',
              'cab',
              900,
              4,
              [10, 800],
              ['elongation'],
            ),
            p(
              XLPE,
              'Hot set test (elongation under load)',
              'PERCENT',
              'cab',
              1100,
              4,
              [0, 250],
              ['hot set'],
              ['shivalik', 'mahi'],
            ),
          ],
        },
      ],
    },
    {
      code: 'DEMO_ELECTRICAL_LIGHTING',
      name: 'Lighting',
      products: [
        {
          code: LED,
          name: 'LED lamps',
          aliases: ['LED bulb', 'LED lamp', 'self-ballasted LED lamp', 'bulb', 'IS 16102'],
          sample: sampleOf(
            3,
            'PIECE',
            'Three lamps of the same model and batch, in the original packing.',
          ),
          parameters: [
            p(LED, 'Luminous flux', 'LM', 'led', 800, 4, [10, 10000], ['lumen', 'lumens']),
            p(
              LED,
              'Power consumption',
              'WATT',
              'led',
              500,
              3,
              [0.5, 200],
              ['wattage', 'power input'],
            ),
            p(
              LED,
              'Luminous efficacy',
              'LM_PER_W',
              'led',
              600,
              4,
              [10, 200],
              ['efficacy', 'lumens per watt'],
            ),
            p(
              LED,
              'Correlated colour temperature (CCT)',
              'KELVIN',
              'led',
              700,
              4,
              [2000, 10000],
              ['CCT', 'colour temperature'],
            ),
            p(LED, 'Colour rendering index (CRI)', 'RA', 'led', 700, 4, [0, 100], ['CRI']),
          ],
        },
      ],
    },
    {
      code: 'DEMO_ELECTRICAL_APPLIANCES',
      name: 'Appliances and accessories',
      products: [
        {
          code: FAN,
          name: 'Ceiling fans',
          aliases: ['fan', 'ceiling fan', 'electric fan', 'IS 374'],
          sample: sampleOf(
            1,
            'PIECE',
            'One complete fan in the original packing, with its regulator.',
          ),
          parameters: [
            p(FAN, 'Air delivery', 'M3_PER_MIN', 'fan', 1500, 5, [10, 500], ['air delivery']),
            p(FAN, 'Power input', 'WATT', 'fan', 600, 3, [10, 200], ['wattage']),
            p(
              FAN,
              'Service value (air delivery per watt)',
              'M3_PER_MIN_PER_W',
              'fan',
              1500,
              5,
              [0.5, 10],
              ['service value'],
            ),
          ],
        },
        {
          code: SWITCH,
          name: 'Domestic switches',
          aliases: ['switch', 'modular switch', 'electrical switch', 'IS 3854'],
          sample: sampleOf(
            3,
            'PIECE',
            'Three switches of the same model and batch, in the original packing.',
          ),
          parameters: [
            p(SWITCH, 'Insulation resistance', 'MOHM', 'sw', 600, 3, [1, 10000]),
            p(SWITCH, 'Electric strength', 'KV', 'sw', 700, 3, [0.5, 10], ['dielectric strength']),
            p(SWITCH, 'Temperature rise', 'KELVIN', 'sw', 1200, 4, [1, 100]),
          ],
        },
      ],
    },
  ],
};

/** The four disciplines, each with its groups, products, parameters, methods and units. */
export const DEMO_CATALOGUE: CatalogueSpec[] = [chemistry, mechanical, biological, electrical];

/** The METHOD and UNIT values that the catalogue's parameters refer to, and no others. */
export function demoFlat(): FlatSpec {
  const usedMethods = new Set<string>();
  const usedUnits = new Set<string>();
  for (const discipline of DEMO_CATALOGUE) {
    for (const group of discipline.groups) {
      for (const product of group.products) {
        if (product.sample) usedUnits.add(product.sample.unitCode);
        for (const parameter of product.parameters) {
          if (parameter.methodCode) usedMethods.add(parameter.methodCode);
          if (parameter.unitCode) usedUnits.add(parameter.unitCode);
        }
      }
    }
  }
  const methods = (Object.entries(METHOD_LIST) as [MethodKey, Method][])
    .filter(([key]) => usedMethods.has(methodCode(key)))
    .map(([key, method]) => ({
      code: methodCode(key),
      name: method.name,
      ...(method.standard ? { standardCode: method.standard } : {}),
    }));
  const own = UNIT_LIST.map(([key, name]) => ({ code: unitCode(key), name }));
  const reused = REFERENCE_UNITS.map(([code, name]) => ({ code, name, reuse: code }));
  const units = [...own, ...reused].filter((unit) => usedUnits.has(unit.code));
  return { methods, units };
}

/** Price, turnaround and exclusivity of every parameter, by code. */
export const DEMO_PARAMETER_META: ReadonlyMap<string, ParameterMeta> = new Map(
  parameterMeta.map((meta) => [meta.code, meta]),
);

// ---------------------------------------------------------------- synonyms

/**
 * What the search expands before it looks (`search_synonym`): abbreviations and other words
 * people type. The parameters' aliases are searched as they are; these are for phrases that
 * should find several names at once.
 */
export const DEMO_SYNONYMS: readonly { term: string; expandsTo: readonly string[] }[] = [
  { term: 'TS', expandsTo: ['tensile strength'] },
  { term: 'UTS', expandsTo: ['tensile strength'] },
  { term: 'YS', expandsTo: ['yield stress'] },
  { term: 'TDS', expandsTo: ['total dissolved solids'] },
  { term: 'TSS', expandsTo: ['total suspended solids'] },
  { term: 'BOD', expandsTo: ['biochemical oxygen demand'] },
  { term: 'COD', expandsTo: ['chemical oxygen demand'] },
  { term: 'LOI', expandsTo: ['loss on ignition'] },
  { term: 'OPC', expandsTo: ['ordinary portland cement'] },
  { term: 'PPC', expandsTo: ['portland pozzolana cement'] },
  { term: 'MFR', expandsTo: ['melt flow rate'] },
  { term: 'OIT', expandsTo: ['oxidation induction time'] },
  { term: 'FFA', expandsTo: ['free fatty acids'] },
  { term: 'SPC', expandsTo: ['total plate count'] },
  { term: 'TPC', expandsTo: ['total plate count'] },
  { term: 'IS 1786', expandsTo: ['tmt bars'] },
  { term: 'IS 269', expandsTo: ['ordinary portland cement'] },
  { term: 'rebar', expandsTo: ['tmt bars'] },
  { term: 'cube test', expandsTo: ['compressive strength'] },
  { term: 'borewell', expandsTo: ['ground water'] },
];
