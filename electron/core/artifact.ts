// Text-artifact extraction for the direct-API / hosted execution profile.
// Engines without file tools return their deliverable inside the model's text.
// We accept, in order of preference:
//   1. <artifact ...>…</artifact>         (explicit, what our prompt asks for)
//   2. a fenced ```html … ``` code block
//   3. a raw <!doctype html> … </html> document
// and split off any surrounding prose so the chat can show a summary.

export interface ExtractedArtifact {
  /** The file body to write (HTML). */
  content: string;
  /** Suggested extension based on the artifact type, default '.html'. */
  extension: '.html' | '.svg';
  /** Prose that appeared before/after the artifact, joined — used as summary. */
  prose: string;
}

const TYPE_EXT: Record<string, '.html' | '.svg'> = {
  html: '.html',
  'text/html': '.html',
  svg: '.svg',
  'image/svg+xml': '.svg',
};

export function extractArtifact(text: string): ExtractedArtifact | null {
  return fromArtifactTag(text) ?? fromFence(text) ?? fromRawHtml(text);
}

function fromArtifactTag(text: string): ExtractedArtifact | null {
  const open = text.search(/<artifact\b/i);
  if (open === -1) return null;
  const tagEnd = text.indexOf('>', open);
  if (tagEnd === -1) return null;
  const close = text.toLowerCase().indexOf('</artifact>', tagEnd);
  const content = (close === -1 ? text.slice(tagEnd + 1) : text.slice(tagEnd + 1, close)).trim();
  if (!content) return null;

  const attrs = text.slice(open, tagEnd);
  const typeMatch = attrs.match(/type\s*=\s*"([^"]+)"/i);
  const extension = (typeMatch && TYPE_EXT[typeMatch[1].toLowerCase()]) || '.html';

  const before = text.slice(0, open);
  const after = close === -1 ? '' : text.slice(close + '</artifact>'.length);
  return { content: stripFence(content), extension, prose: joinProse(before, after) };
}

function fromFence(text: string): ExtractedArtifact | null {
  // First fenced block whose language is html/svg (or unlabeled but looks like HTML).
  const re = /```([\w+-]*)\r?\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const lang = (m[1] || '').toLowerCase();
    const body = m[2].trim();
    const looksHtml = /<(!doctype|html|section|main|div|svg)\b/i.test(body);
    if (lang === 'html' || lang === 'svg' || (lang === '' && looksHtml)) {
      const before = text.slice(0, m.index);
      const after = text.slice(m.index + m[0].length);
      return {
        content: body,
        extension: lang === 'svg' || /^<svg\b/i.test(body) ? '.svg' : '.html',
        prose: joinProse(before, after),
      };
    }
  }
  return null;
}

function fromRawHtml(text: string): ExtractedArtifact | null {
  const start = text.search(/<!doctype html>|<html\b/i);
  if (start === -1) return null;
  const endMatch = text.slice(start).match(/<\/html\s*>/i);
  const end = endMatch ? start + endMatch.index! + endMatch[0].length : text.length;
  const content = text.slice(start, end).trim();
  if (!content) return null;
  return { content, extension: '.html', prose: joinProse(text.slice(0, start), text.slice(end)) };
}

/** A model sometimes wraps artifact content in its own ```html fence. */
function stripFence(content: string): string {
  const m = content.match(/^```[\w+-]*\r?\n([\s\S]*?)```$/);
  return m ? m[1].trim() : content;
}

function joinProse(before: string, after: string): string {
  return [before, after]
    .map((s) => s.replace(/```[\w+-]*\r?\n?|```/g, '').trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

/**
 * Given the streamed text so far, return the length of the leading prose that
 * is safe to show live in chat — i.e. everything before an `<artifact` (or a
 * code fence) begins, holding back a short tail so we never emit a partial
 * opening tag. Returns null once code/artifact output has started.
 */
export function safeVisiblePrefixEnd(full: string): number | null {
  const artifactAt = full.search(/<artifact\b/i);
  const fenceAt = full.indexOf('```');
  const htmlAt = full.search(/<!doctype html>|<html\b/i);
  const marks = [artifactAt, fenceAt, htmlAt].filter((n) => n >= 0);
  if (marks.length) return Math.min(...marks);
  // No boundary yet: hold back the last 10 chars in case a tag is mid-arrival.
  return Math.max(0, full.length - 10);
}
