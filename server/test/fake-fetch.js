// A fetch that answers from a table of URL prefixes, and records every request.
export function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const match = Object.keys(routes).filter(prefix => String(url).startsWith(prefix)).sort((a, b) => b.length - a.length)[0];
    if (!match) return new Response('not found', { status: 404 });
    const route = routes[match];
    const value = typeof route === 'function' ? await route(String(url), options) : route;
    if (value instanceof Response) return value;
    return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  fetch.calls = calls;
  return fetch;
}
