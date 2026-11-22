// Non-intrusive GitHub Releases update checker for Agent Deck.

export const RELEASES_API_URL = "https://api.github.com/repos/MatsuriMW/obsidian-agent-deck/releases/latest";
export const RELEASES_PAGE_URL = "https://github.com/MatsuriMW/obsidian-agent-deck/releases/latest";
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function normalizeVersion(raw) {
  const clean = String(raw || "").trim().replace(/^v/i, "").split(/[-+]/)[0];
  if (!clean) return "";
  return clean;
}

export function compareVersions(a, b) {
  const pa = normalizeVersion(a).split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = normalizeVersion(b).split(".").map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

export function isNewerVersion(latest, current) {
  if (!normalizeVersion(latest) || !normalizeVersion(current)) return false;
  return compareVersions(latest, current) > 0;
}

export function shouldAutoCheckUpdate(settings, now = Date.now()) {
  if (settings?.updateCheck === false) return false;
  const last = Number(settings?.updateCheckLastAt || 0);
  return !last || (now - last >= UPDATE_CHECK_INTERVAL_MS);
}

export function shouldPromptUpdate(latest, current, settings, { manual = false } = {}) {
  if (!isNewerVersion(latest, current)) return false;
  if (!manual && settings?.updateSkippedVersion && compareVersions(latest, settings.updateSkippedVersion) === 0) {
    return false;
  }
  return true;
}

export async function checkLatestRelease({ currentVersion, fetchJson, url = RELEASES_API_URL } = {}) {
  if (typeof fetchJson !== "function") {
    throw new Error("fetchJson is required");
  }
  const data = await fetchJson(url);
  if (!data || typeof data !== "object") {
    throw new Error("Invalid release payload");
  }
  const latestVersion = normalizeVersion(data.tag_name || data.name || "");
  if (!latestVersion) {
    throw new Error("Missing release version");
  }
  const releaseUrl = String(data.html_url || "").trim() || RELEASES_PAGE_URL;
  const notes = String(data.body || "").trim().slice(0, 600);
  return {
    currentVersion: normalizeVersion(currentVersion),
    latestVersion,
    hasUpdate: isNewerVersion(latestVersion, currentVersion),
    url: releaseUrl,
    notes,
    publishedAt: String(data.published_at || ""),
  };
}
