'use client';

import { Combobox, type ComboboxOption } from '@labconnect/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

interface Suggestion {
  kind: 'PARAMETER' | 'PRODUCT' | 'METHOD' | 'LAB_SITE';
  label: string;
  code: string | null;
  labSiteId: string | null;
}

interface Props {
  defaultValue: string;
  label: string;
  placeholder: string;
  listLabel: string;
  kindLabels: Record<Suggestion['kind'], string>;
}

/**
 * The search text with typeahead (board H1: tests, products, standards and labs). Suggestions come
 * through this app's `/api/suggest`, never straight from the browser to the API. Choosing a lab
 * opens its page; choosing anything else fills the box. The input is named `q`, so the form still
 * works without JavaScript.
 */
export function SearchBox({ defaultValue, label, placeholder, listLabel, kindLabels }: Props) {
  const router = useRouter();
  const [text, setText] = useState(defaultValue);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  useEffect(() => {
    if (text.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/suggest?q=${encodeURIComponent(text)}`, { signal: controller.signal })
        .then((response) => response.json() as Promise<{ suggestions: Suggestion[] }>)
        .then((body) => {
          setSuggestions(body.suggestions);
        })
        .catch(() => {
          setSuggestions([]);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text]);

  const options: ComboboxOption[] = suggestions.map((suggestion) => ({
    id: `${suggestion.kind}-${suggestion.code ?? suggestion.labSiteId ?? suggestion.label}`,
    label: suggestion.label,
    hint: kindLabels[suggestion.kind],
  }));

  return (
    <Combobox
      name="q"
      label={label}
      placeholder={placeholder}
      listLabel={listLabel}
      value={text}
      onValueChange={setText}
      options={options}
      maxLength={200}
      onOptionSelect={(option) => {
        const chosen = suggestions[options.indexOf(option)];
        if (chosen?.kind === 'LAB_SITE' && chosen.labSiteId !== null) {
          router.push(`/labs/${chosen.labSiteId}`);
        } else {
          setText(option.label);
        }
      }}
    />
  );
}
