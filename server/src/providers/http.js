export class ProviderError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export async function getJSON(fetch, url, label, headers = {}) {
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'Huddle/1.0', ...headers }, signal: AbortSignal.timeout(15000) });
  if (res.status === 401 || res.status === 403) throw new ProviderError(`${label} refused the request (${res.status}). Check the account's sign-in.`, res.status);
  if (!res.ok) throw new ProviderError(`${label} returned ${res.status}.`, res.status);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
