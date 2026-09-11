/** Environment-owned HTTPS operation URLs; never caller-supplied destinations or redirects. */
import { isIP } from 'node:net';

export function fixedEndpoint(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('fixed HTTPS endpoint required');
  let url;
  try { url = new URL(value); } catch { throw new Error('fixed HTTPS endpoint required'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || isIP(url.hostname) || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(url.hostname) || /\.(?:localhost|local|internal|localdomain)$/.test(url.hostname)) throw new Error('fixed HTTPS endpoint required');
  return url;
}
