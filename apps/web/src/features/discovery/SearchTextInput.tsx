'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useState } from 'react';

interface Suggestion {
  kind: 'PARAMETER' | 'PRODUCT' | 'METHOD' | 'LAB_SITE';
  label: string;
  code: string | null;
  labSiteId: string | null;
}

interface Props {
  name: string;
  label: string;
  placeholder: string;
  defaultValue: string;
  listLabel: string;
  kindLabels: Record<Suggestion['kind'], string>;
}

/**
 * The search text box with typeahead (I1-CUS-08): suggestions after two characters, a short pause
 * after typing. Choosing a lab opens its page; choosing anything else fills the box.
 */
export function SearchTextInput({
  name,
  label,
  placeholder,
  defaultValue,
  listLabel,
  kindLabels,
}: Props) {
  const router = useRouter();
  const id = useId();
  const [text, setText] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  useEffect(() => {
    if (!open || text.trim().length < 2) {
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
  }, [text, open]);

  const choose = (suggestion: Suggestion): void => {
    setOpen(false);
    if (suggestion.kind === 'LAB_SITE' && suggestion.labSiteId !== null) {
      router.push(`/labs/${suggestion.labSiteId}`);
    } else {
      setText(suggestion.label);
    }
  };

  return (
    <div className="suggest">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={name}
        value={text}
        placeholder={placeholder}
        autoComplete="off"
        aria-autocomplete="list"
        aria-controls={`${id}-list`}
        aria-expanded={open && suggestions.length > 0}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
        onBlur={() => {
          setTimeout(() => {
            setOpen(false);
          }, 150);
        }}
      />
      {open && suggestions.length > 0 && (
        <ul id={`${id}-list`} className="suggest-list" aria-label={listLabel}>
          {suggestions.map((suggestion) => (
            <li
              key={`${suggestion.kind}-${suggestion.code ?? suggestion.labSiteId ?? suggestion.label}`}
            >
              <button
                type="button"
                onClick={() => {
                  choose(suggestion);
                }}
              >
                <span>{suggestion.label}</span>
                <span className="muted">{kindLabels[suggestion.kind]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
