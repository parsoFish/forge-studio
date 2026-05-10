export type SlugifyOptions = {
  separator?: string;
  maxLength?: number;
};

export function slugify(input: string, options: SlugifyOptions = {}): string {
  const sep = options.separator ?? '-';
  const normalised = input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, sep)
    .replace(new RegExp(`^${sep}+|${sep}+$`, 'g'), '');
  if (typeof options.maxLength === 'number' && options.maxLength > 0) {
    return normalised
      .slice(0, options.maxLength)
      .replace(new RegExp(`${sep}+$`, 'g'), '');
  }
  return normalised;
}
