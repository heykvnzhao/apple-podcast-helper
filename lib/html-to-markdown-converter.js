const namedEntities = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  copy: "©",
  reg: "®",
  tm: "™",
};

function decodeHtmlEntities(text) {
  if (!text || typeof text !== "string") {
    return "";
  }

  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === "#") {
      const isHex = entity[1] === "x" || entity[1] === "X";
      const codePoint = isHex
        ? parseInt(entity.slice(2), 16)
        : parseInt(entity.slice(1), 10);
      if (!Number.isNaN(codePoint)) {
        return String.fromCodePoint(codePoint);
      }
      return match;
    }

    const key = entity.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(namedEntities, key)) {
      return namedEntities[key];
    }
    return match;
  });
}

function convertHtmlToMarkdown(html) {
  if (!html || typeof html !== "string") {
    return "";
  }

  let text = html.replace(/\r\n/g, "\n");

  text = text.replace(
    /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (match, href, inner) => {
      const innerMarkdown = convertHtmlToMarkdown(inner).trim() || href.trim();
      return `[${innerMarkdown}](${href.trim()})`;
    }
  );

  text = text.replace(
    /<(strong|b)>([\s\S]*?)<\/\1>/gi,
    (match, _tag, inner) => `**${convertHtmlToMarkdown(inner).trim()}**`
  );
  text = text.replace(
    /<(em|i)>([\s\S]*?)<\/\1>/gi,
    (match, _tag, inner) => `*${convertHtmlToMarkdown(inner).trim()}*`
  );
  text = text.replace(
    /<(u)>([\s\S]*?)<\/\1>/gi,
    (match, _tag, inner) => `_${convertHtmlToMarkdown(inner).trim()}_`
  );
  text = text.replace(
    /<(code)>([\s\S]*?)<\/\1>/gi,
    (match, _tag, inner) => `\`${convertHtmlToMarkdown(inner).trim()}\``
  );

  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (match, inner) => {
    const listItem = convertHtmlToMarkdown(inner).trim();
    return listItem ? `- ${listItem}\n` : "";
  });
  text = text.replace(/<\/(ul|ol)>/gi, "\n");
  text = text.replace(/<(ul|ol)[^>]*>/gi, "\n");

  text = text.replace(/<\s*br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n\n");
  text = text.replace(/<p[^>]*>/gi, "");

  text = text.replace(
    /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi,
    (match, level, inner) => {
      const hashes = "#".repeat(Math.max(1, Math.min(6, parseInt(level, 10))));
      return `\n${hashes} ${convertHtmlToMarkdown(inner).trim()}\n`;
    }
  );

  text = text.replace(
    /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi,
    (match, inner) => {
      const quote = convertHtmlToMarkdown(inner).trim();
      if (!quote) {
        return "";
      }
      return quote
        .split(/\r?\n/)
        .map((line) => `> ${line}`)
        .join("\n");
    }
  );

  text = text.replace(/<table[\s\S]*?<\/table>/gi, (match) =>
    convertHtmlToMarkdown(match.replace(/<\/?(table|tbody|thead|tfoot)>/gi, ""))
  );
  text = text.replace(
    /<tr[^>]*>([\s\S]*?)<\/tr>/gi,
    (match, inner) => convertHtmlToMarkdown(inner) + "\n"
  );
  text = text.replace(
    /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi,
    (match, inner) => `${convertHtmlToMarkdown(inner).trim()}\t`
  );

  text = text.replace(/<\/?.*?>/g, "");
  text = decodeHtmlEntities(text);
  text = text.replace(/\u00a0/g, " ");
  text = text.replace(/[ \t]+\n/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

export { convertHtmlToMarkdown, decodeHtmlEntities };

export default {
  decodeHtmlEntities,
  convertHtmlToMarkdown,
};
