/**
 * Feed column name helpers.
 *
 * Mappings store plain attribute names (id, title, price, image_link…). The
 * Google "g:" namespace prefix is an XML-output concern, added here at
 * generation time rather than baked into the mapping. Legacy mappings that
 * still carry a "g:" prefix are normalised so nothing double-prefixes.
 */

/** Attribute name without the Google "g:" namespace prefix. */
export function plainColumn(col: string): string {
  return col.replace(/^g:/i, '');
}

// RSS 2.0 native <item> elements — Google reads these unprefixed.
const RSS_NATIVE = new Set(['title', 'link', 'description']);

/** Tag name for a column inside a Google RSS 2.0 (XML) feed. */
export function googleXmlTag(col: string): string {
  const plain = plainColumn(col);
  return RSS_NATIVE.has(plain.toLowerCase()) ? plain : `g:${plain}`;
}
