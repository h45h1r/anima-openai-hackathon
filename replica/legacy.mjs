export function redactLegacyAuth(html) {
  return html.replace(/<input\b[^>]*>/gi, tag => {
    if (!/\bname=["'](?:csrf|csrfToken|_csrf)["']/i.test(tag)) return tag;
    return tag.replace(/\bvalue=["'][^"']*["']/i, 'value="[REDACTED]"');
  });
}

function text(html) {
  return html.replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" })[entity]).trim();
}

export function legacyRows(html) {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map(row => [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => text(cell[1])))
    .filter(cells => cells.length >= 3)
    .map(([id, title, content]) => ({ id, title, content }));
}
