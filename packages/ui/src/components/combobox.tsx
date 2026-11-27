'use client';

import {
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  useId,
  useState,
} from 'react';
import { cn } from '../lib/cn.js';

export interface ComboboxOption {
  /** Unique within the list. */
  id: string;
  label: string;
  /** A short kind or detail shown at the end of the row (for example "Test" or "Lab"). */
  hint?: string;
}

export interface ComboboxProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'onSelect' | 'role'
> {
  label: ReactNode;
  /** The text in the box. */
  value: string;
  onValueChange: (value: string) => void;
  /** Suggestions for the current text; the caller fetches them. */
  options: readonly ComboboxOption[];
  onOptionSelect: (option: ComboboxOption) => void;
  /** Accessible name of the list, from the app's messages. */
  listLabel: string;
}

/**
 * A text box with suggestions (COMPONENT_SPECIFICATION "Combobox"; H1 typeahead), following the
 * WAI-ARIA 1.2 combobox pattern: `role="combobox"` on the input, `aria-activedescendant` for the
 * highlighted option, ArrowUp/ArrowDown to move, Enter to choose, Escape to close. Enter with no
 * highlighted option is left alone, so the surrounding form submits as usual.
 */
export function Combobox({
  label,
  value,
  onValueChange,
  options,
  onOptionSelect,
  listLabel,
  className,
  id: idProp,
  ...inputProps
}: ComboboxProps) {
  const generated = useId();
  const id = idProp ?? generated;
  const listId = `${id}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const showList = open && options.length > 0;
  const activeOption = showList && active >= 0 ? options[active] : undefined;

  const choose = (option: ComboboxOption): void => {
    setOpen(false);
    setActive(-1);
    onOptionSelect(option);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((current) => (options.length === 0 ? -1 : (current + 1) % options.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) =>
        options.length === 0 ? -1 : (current - 1 + options.length) % options.length,
      );
    } else if (event.key === 'Enter' && activeOption !== undefined) {
      event.preventDefault();
      choose(activeOption);
    } else if (event.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    }
  };

  return (
    <div className={cn('relative flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-text">
        {label}
      </label>
      <input
        {...inputProps}
        id={id}
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={
          activeOption === undefined ? undefined : `${listId}-${activeOption.id}`
        }
        value={value}
        onChange={(event) => {
          onValueChange(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          setOpen(false);
          setActive(-1);
        }}
        className="min-h-11 w-full rounded-md border border-border-strong bg-surface-raised px-3 text-base text-text placeholder:text-border-strong"
      />
      <ul
        id={listId}
        role="listbox"
        aria-label={listLabel}
        hidden={!showList}
        className="absolute inset-x-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-md border border-border bg-surface-raised py-1 shadow-overlay"
      >
        {options.map((option, index) => (
          <li
            key={option.id}
            id={`${listId}-${option.id}`}
            role="option"
            aria-selected={index === active}
            // mousedown, not click: it fires before the input's blur closes the list.
            onMouseDown={(event) => {
              event.preventDefault();
              choose(option);
            }}
            className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 text-base text-text aria-selected:bg-brand-tint aria-selected:text-brand-on-tint"
          >
            <span>{option.label}</span>
            {option.hint !== undefined && (
              <span className="text-sm text-text-muted">{option.hint}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
