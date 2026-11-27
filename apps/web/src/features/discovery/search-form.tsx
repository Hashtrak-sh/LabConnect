import { Field, fieldProps, Input, Select } from '@labconnect/ui';
import { t } from '@/lib/i18n';
import { LocationPicker } from './LocationPicker';
import { SearchBox } from './SearchBox';
import { RADII, type SearchForm } from './search-params';

export interface Discipline {
  code: string;
  name: string;
}

/** The text box with typeahead (H1, B1). */
export function SearchText({ form }: { form: SearchForm }) {
  return (
    <SearchBox
      defaultValue={form.q}
      label={t('search.textLabel')}
      placeholder={t('search.textPlaceholder')}
      listLabel={t('search.suggestionsLabel')}
      kindLabels={{
        PARAMETER: t('search.kindParameter'),
        PRODUCT: t('search.kindProduct'),
        METHOD: t('search.kindMethod'),
        LAB_SITE: t('search.kindLab'),
      }}
    />
  );
}

/**
 * "Where is your sample?" (H1): device location, a PIN code field shown but not yet usable (no
 * pincode data, OQ-153), and the radius, which needs a location.
 */
export function SearchWhere({ form, located }: { form: SearchForm; located: boolean }) {
  const pincodeHelp = t('search.pincodeSoon');
  const radiusHelp = located ? undefined : t('search.radiusNeedsLocation');
  return (
    <>
      <LocationPicker
        located={located}
        labels={{
          use: t('search.useLocation'),
          set: t('search.locationSet'),
          clear: t('search.clearLocation'),
          denied: t('search.locationDenied'),
        }}
      />
      <Field id="search-pincode" label={t('search.pincodeLabel')} help={pincodeHelp}>
        <Input
          {...fieldProps('search-pincode', { help: pincodeHelp })}
          inputMode="numeric"
          disabled
        />
      </Field>
      <Field id="search-radius" label={t('search.radiusLabel')} help={radiusHelp}>
        <Select
          {...fieldProps('search-radius', { help: radiusHelp })}
          name="radius"
          defaultValue={form.radius}
        >
          <option value="">{t('search.anyDistance')}</option>
          {RADII.map((km) => (
            <option key={km} value={String(km)}>
              {t('search.radiusKm', { km })}
            </option>
          ))}
        </Select>
      </Field>
    </>
  );
}

/**
 * The filters (B1 filter row, H2 filter sheet). Only what `searchLabs` can filter on: no "Has a
 * slot this week" (DP2-06) and no "Bookable only". `idPrefix` keeps ids unique when the filters
 * appear twice on a page (inline and in the sheet).
 */
export function SearchFilters({
  form,
  disciplines,
  idPrefix,
}: {
  form: SearchForm;
  disciplines: readonly Discipline[];
  idPrefix: string;
}) {
  const id = (name: string): string => `${idPrefix}-${name}`;
  return (
    <>
      <Field id={id('discipline')} label={t('search.disciplineLabel')}>
        <Select {...fieldProps(id('discipline'))} name="discipline" defaultValue={form.discipline}>
          <option value="">{t('search.anyDiscipline')}</option>
          {disciplines.map((node) => (
            <option key={node.code} value={node.code}>
              {node.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field id={id('category')} label={t('search.categoryLabel')}>
        <Select {...fieldProps(id('category'))} name="category" defaultValue={form.category}>
          <option value="">{t('search.anyCategory')}</option>
          <option value="TESTING">{t('search.categoryTesting')}</option>
          <option value="CALIBRATION">{t('search.categoryCalibration')}</option>
        </Select>
      </Field>
      <Field id={id('tat')} label={t('search.tatLabel')}>
        <Input {...fieldProps(id('tat'))} name="tat" inputMode="numeric" defaultValue={form.tat} />
      </Field>
      <Field id={id('price')} label={t('search.priceLabel')}>
        <Input
          {...fieldProps(id('price'))}
          name="maxPrice"
          inputMode="decimal"
          defaultValue={form.maxPrice}
        />
      </Field>
    </>
  );
}
