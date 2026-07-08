// Minimal HTML sanitizer for forum/missive message content.
// Forum messages from the scraper are raw `innerHTML`, so they could
// contain malicious markup. Rather than pulling in a full lib, allowlist
// a small set of tags and strip event handlers and dangerous URL schemes.
//
// Not bulletproof — this is for trusted-but-untrusted local content.
// If the threat model gets stricter, swap in DOMPurify.

const ALLOWED_TAGS = new Set([
  "br", "p", "b", "i", "em", "strong", "u", "s", "strike",
  "span", "div", "a", "img", "font", "ul", "ol", "li",
  "blockquote", "code", "pre", "h1", "h2", "h3", "h4", "h5", "h6",
]);

const ALLOWED_ATTRS = new Set(["href", "src", "alt", "title", "color", "style"]);

// Allow only http(s) and relative URLs in href/src; reject javascript:, data:, vbscript:
function safeUrl(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith("javascript:") || trimmed.startsWith("vbscript:") || trimmed.startsWith("data:")) {
    return "#";
  }
  return value;
}

// Very conservative style allowlist — colors, font weights, text-decoration only.
function safeStyle(value: string): string {
  return value
    .split(";")
    .map((decl) => decl.trim())
    .filter((decl) => /^(color|background-color|font-weight|font-style|text-decoration|text-align)\s*:\s*[^;{}()]+$/i.test(decl))
    .join("; ");
}

export function sanitizeForumHtml(html: string): string {
  if (!html) return "";

  // Strip any <script>, <iframe>, <object>, <embed>, <style>, <link> entirely.
  let out = html.replace(/<\s*(script|iframe|object|embed|style|link|meta)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "");
  out = out.replace(/<\s*(script|iframe|object|embed|style|link|meta)\b[^>]*\/?>/gi, "");

  // Walk every tag, drop disallowed ones (keep their inner text by removing only the tag wrapper),
  // and strip dangerous attributes from kept ones.
  out = out.replace(/<\s*\/?\s*([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (match, tagName, attrs) => {
    const lower = tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(lower)) return ""; // drop tag, keep inner text via the regex's structure
    const isClosing = match.startsWith("</") || match.match(/<\s*\//);
    if (isClosing) return `</${lower}>`;

    // Parse attributes
    const cleanAttrs: string[] = [];
    const attrRegex = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let m: RegExpExecArray | null;
    while ((m = attrRegex.exec(attrs)) !== null) {
      const name = m[1].toLowerCase();
      const value = m[3] ?? m[4] ?? m[5] ?? "";
      if (name.startsWith("on")) continue; // drop event handlers
      if (!ALLOWED_ATTRS.has(name)) continue;
      let safeValue = value;
      if (name === "href" || name === "src") safeValue = safeUrl(value);
      if (name === "style") safeValue = safeStyle(value);
      if (!safeValue) continue;
      cleanAttrs.push(`${name}="${safeValue.replace(/"/g, "&quot;")}"`);
    }
    const isSelfClosing = match.endsWith("/>") || lower === "br" || lower === "img";
    return `<${lower}${cleanAttrs.length ? " " + cleanAttrs.join(" ") : ""}${isSelfClosing ? " /" : ""}>`;
  });

  return out;
}
