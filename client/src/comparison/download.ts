/** Makes a safe file name: lowercase letters, digits, and dashes only. */
export function slugify(value: string, fallback = 'report'): string {
  const slug = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '');
  return slug || fallback;
}

/** Saves text as a file in the user's browser. Nothing leaves the device. */
export function downloadTextFile(fileName: string, content: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: `${mimeType};charset=utf-8` }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // Revoke after the click has been handled so the download can start.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
