import messages from '../../messages/en.json';

type Messages = typeof messages;
type Leaf<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaf<T[K], `${P}${K}.`>;
}[keyof T & string];

/** A key of `messages/en.json`, as `section.key`. */
export type MessageKey = Leaf<Messages>;

/**
 * The English text for `key`, with `{name}` placeholders filled from `values`. All user-facing
 * text comes from `messages/en.json`, never from components (CODING_STANDARDS), so a Hindi file
 * can be added later without touching the screens.
 */
export function t(key: MessageKey, values: Record<string, string | number> = {}): string {
  let node: unknown = messages;
  for (const part of key.split('.')) node = (node as Record<string, unknown>)[part];
  const text = typeof node === 'string' ? node : key;
  return text.replaceAll(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}
