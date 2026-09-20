import { useCallback, useSyncExternalStore } from "react";

/**
 * Tiny hash router. Routes look like `#/asset/native?from=home`. It works
 * identically in the extension popup, the full-page dashboard and the web
 * demo, and keeps a history stack so BACK behaves like a native app.
 */
export interface Route {
  path: string;
  params: Record<string, string>;
}

export function parseHash(hash: string = typeof window !== "undefined" ? window.location.hash : ""): Route {
  const raw = hash.replace(/^#/, "") || "/";
  const [pathPart = "/", query = ""] = raw.split("?");
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(query)) params[k] = v;
  return { path: pathPart.startsWith("/") ? pathPart : `/${pathPart}`, params };
}

export function buildHash(path: string, params?: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== "") qs.set(k, v);
  const q = qs.toString();
  return `#${path}${q ? `?${q}` : ""}`;
}

const listeners = new Set<() => void>();
let stack: string[] = [];

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onHash = () => cb();
  window.addEventListener("hashchange", onHash);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("hashchange", onHash);
  };
}

function getSnapshotHash() {
  return typeof window !== "undefined" ? window.location.hash || "#/" : "#/";
}

export function navigate(path: string, params?: Record<string, string | undefined>, options: { replace?: boolean } = {}): void {
  const next = buildHash(path, params);
  const current = getSnapshotHash();
  if (next === current) return;
  if (options.replace) {
    stack[stack.length - 1] = next;
    window.location.replace(next);
  } else {
    stack.push(current);
    window.location.hash = next;
  }
  for (const l of listeners) l();
}

export function goBack(fallback = "/"): void {
  const prev = stack.pop();
  if (prev) {
    window.location.hash = prev;
  } else {
    window.location.hash = buildHash(fallback);
  }
  for (const l of listeners) l();
}

export function resetNavigation(path = "/"): void {
  stack = [];
  window.location.replace(buildHash(path));
  for (const l of listeners) l();
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, getSnapshotHash, () => "#/");
  return parseHash(hash);
}

export function useNavigate() {
  return useCallback((path: string, params?: Record<string, string | undefined>, options?: { replace?: boolean }) => navigate(path, params, options), []);
}

/** Top-level sections that own a tab in the shell. */
export const SECTIONS = ["/", "/markets", "/swap", "/bridge", "/activity", "/security", "/settings"] as const;

export function sectionOf(path: string): (typeof SECTIONS)[number] {
  if (path === "/") return "/";
  const first = `/${path.split("/")[1] ?? ""}`;
  if ((SECTIONS as readonly string[]).includes(first)) return first as (typeof SECTIONS)[number];
  // /asset, /send, /receive, /hidden and anything unknown belong to the Portfolio tab.
  return "/";
}
