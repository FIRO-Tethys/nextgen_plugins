/**
 * chatboxMcpStorage.js
 *
 * Persists user-configured MCP servers to localStorage.
 * Each server: { url: string, name: string, enabled: boolean }
 */

const STORAGE_KEY = "chatbox_mcp_servers";

export function getMcpServers() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveMcpServers(servers) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(servers));
  } catch {
    // localStorage full or unavailable — silently fail
  }
}

export function addMcpServer({ url, name }) {
  const servers = getMcpServers();
  const normalized = url.trim().replace(/\/+$/, "");
  if (!normalized) return servers;

  // Deduplicate by URL
  if (servers.some((s) => s.url.replace(/\/+$/, "") === normalized)) {
    return servers;
  }

  const updated = [
    ...servers,
    { url: normalized, name: (name || "").trim() || normalized, enabled: true },
  ];
  saveMcpServers(updated);
  return updated;
}

export function removeMcpServer(url) {
  const servers = getMcpServers();
  const normalized = url.trim().replace(/\/+$/, "");
  const updated = servers.filter(
    (s) => s.url.replace(/\/+$/, "") !== normalized,
  );
  saveMcpServers(updated);
  return updated;
}

export function toggleMcpServer(url) {
  const servers = getMcpServers();
  const normalized = url.trim().replace(/\/+$/, "");
  const updated = servers.map((s) =>
    s.url.replace(/\/+$/, "") === normalized
      ? { ...s, enabled: !s.enabled }
      : s,
  );
  saveMcpServers(updated);
  return updated;
}
