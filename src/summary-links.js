import os from "os";

// Hide addresses before shortening the visible summary, then restore complete
// Markdown links. Truncation must never cut a target in half.
export function formatSummaryLinks(raw, format = text => text) {
  const links = [];
  const keep = link => { const marker = String.fromCharCode(0xe000 + links.length); links.push(link); return marker; };
  const encode = c => c === "(" ? "%28" : c === ")" ? "%29" : encodeURIComponent(c);
  const target = address => {
    if (/^(?:https?|file):/i.test(address)) return address.replace(/[()\s]/g, encode);
    const path = address.replace(/^~(?=\/)/, os.homedir()).replace(/\\/g, "/");
    return (path.startsWith("/") ? "file://" : "file:///") + path.replace(/[()\s?#]/g, encode);
  };
  const address = value => /^(?:https?:\/\/|file:\/\/|[a-z]:[\\/]|~?\/)/i.test(value);
  const longPath = value => value.length >= 40 || /^(?:[a-z]:[\\/]|~\/|\/(?:Users|home|tmp|var|workspace|mnt|Volumes)\/)/i.test(value);
  let text = String(raw || "").replace(/\[([^\]\n]+)\]\((<[^>\n]+>|(?:[^()\n]|\([^()\n]*\))*)\)/g, (whole, label, href) => {
    const value = href.replace(/^<|>$/g, "");
    if (!address(value) || /\s+["']/.test(value)) return keep(whole);
    return keep(`[${address(label) && label.length >= 40 ? "🔗" : label}](${target(value)})`);
  });
  text = text.replace(/`([^`\n]+)`/g, (whole, value) => address(value) && longPath(value) ? keep(`[🔗](${target(value)})`) : whole);
  text = text.replace(/(?:https?|file):\/\/[^\s<>"`，。；！？）]+/gi, value => {
    let suffix = "";
    while (/[.,;!]$/.test(value) || (value.endsWith(")") && (value.match(/\)/g) || []).length > (value.match(/\(/g) || []).length)) {
      suffix = value.slice(-1) + suffix; value = value.slice(0, -1);
    }
    return keep(`[🔗](${target(value)})`) + suffix;
  });
  text = text.replace(/(^|[\s（(：:])((?:[a-z]:[\\/]|~\/|\/)[^\s<>`"，。；！？）),;:]+)/gi,
    (whole, prefix, value) => longPath(value) ? prefix + keep(`[🔗](${target(value)})`) : whole);
  return format(text).replace(/[\ue000-\uf8ff]/g, marker => links[marker.charCodeAt(0) - 0xe000] ?? marker);
}
