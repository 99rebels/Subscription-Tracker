let cache;

export async function loadServices() {
  if (!cache) {
    const res = await fetch(chrome.runtime.getURL("data/services.json"));
    cache = await res.json();
  }
  return cache;
}

// "www.netflix.com" matches "netflix.com"; "notnetflix.com" does not.
export function hostMatches(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export async function findServiceByName(name) {
  const services = await loadServices();
  const lower = name.trim().toLowerCase();
  return services.find((s) => s.name.toLowerCase() === lower);
}

// "www.shop.example.co.uk" -> "example.co.uk" (good enough without a public-suffix list).
export function registrableDomain(hostname) {
  const parts = hostname.replace(/^www\./, "").split(".");
  const twoPartTld = parts.length > 2 && parts[parts.length - 2].length <= 3 && parts[parts.length - 1].length === 2;
  return parts.slice(twoPartTld ? -3 : -2).join(".");
}

export function guessName(domain) {
  const label = domain.split(".")[0];
  return label.charAt(0).toUpperCase() + label.slice(1);
}
