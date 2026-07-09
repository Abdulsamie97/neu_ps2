export function dotId(prefix: string, index: number): string {
  return `${prefix}${index}`;
}

export function dotString(value: string): string {
  return JSON.stringify(value);
}

export function dotAttributes(attributes: Record<string, string | number | boolean | undefined>): string {
  const entries = Object.entries(attributes).filter((entry): entry is [string, string | number | boolean] => {
    return entry[1] !== undefined;
  });

  if (entries.length === 0) {
    return '';
  }

  const rendered = entries
    .map(([key, value]) => `${key}=${typeof value === 'string' ? dotString(value) : String(value)}`)
    .join(', ');
  return ` [${rendered}]`;
}

export function graphName(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, '_') || 'G';
}
