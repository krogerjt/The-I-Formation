import { connect } from 'node:http2';
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Sends Live Activity pushes through Apple's push service (APNs) with a token-based .p8 key.
// Create the key at developer.apple.com > Certificates, Identifiers & Profiles > Keys, with
// "Apple Push Notifications service (APNs)" checked.

const HOSTS = { development: 'https://api.sandbox.push.apple.com', production: 'https://api.push.apple.com' };
const b64url = value => Buffer.from(value).toString('base64url');

export class APNs {
  constructor({ keyId, teamId, key, bundleId, environment = 'development', transport = null, now = Date.now }) {
    this.keyId = keyId; this.teamId = teamId; this.bundleId = bundleId; this.now = now;
    this.environment = environment === 'production' ? 'production' : 'development';
    this.key = key ? createPrivateKey(key) : null;
    this.transport = transport || http2Transport(HOSTS[this.environment]);
  }

  static fromEnv(env, options = {}) {
    let key = env.APNS_KEY ? env.APNS_KEY.replace(/\\n/g, '\n') : null;
    if (!key && env.APNS_KEY_PATH) key = readFileSync(env.APNS_KEY_PATH, 'utf8');
    return new APNs({ keyId: env.APNS_KEY_ID, teamId: env.APNS_TEAM_ID, key, bundleId: env.APNS_BUNDLE_ID || 'com.krogerjt.huddle', environment: env.APNS_ENV, ...options });
  }

  get configured() { return Boolean(this.key && this.keyId && this.teamId && this.bundleId); }

  // Apple wants a fresh signed token at least hourly and no more than every 20 minutes.
  jwt() {
    if (this.cachedJWT && this.now() - this.cachedJWT.at < 40 * 60 * 1000) return this.cachedJWT.value;
    const iat = Math.floor(this.now() / 1000);
    const body = `${b64url(JSON.stringify({ alg: 'ES256', kid: this.keyId }))}.${b64url(JSON.stringify({ iss: this.teamId, iat }))}`;
    const signature = sign('sha256', Buffer.from(body), { key: this.key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    this.cachedJWT = { at: this.now(), value: `${body}.${signature}` };
    return this.cachedJWT.value;
  }

  // Returns { ok, status, reason }. `gone` means the token is dead and should be forgotten.
  async send(deviceToken, payload, { priority = 10 } = {}) {
    if (!this.configured) return { ok: false, status: 0, reason: 'NotConfigured' };
    const headers = {
      authorization: `bearer ${this.jwt()}`,
      'apns-push-type': 'liveactivity',
      'apns-topic': `${this.bundleId}.push-type.liveactivity`,
      'apns-priority': String(priority),
      'content-type': 'application/json',
    };
    try {
      const { status, body } = await this.transport(`/3/device/${deviceToken}`, headers, JSON.stringify(payload));
      let reason = null;
      try { reason = body ? JSON.parse(body).reason : null; } catch {}
      return { ok: status === 200, status, reason, gone: status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered' };
    } catch (error) {
      return { ok: false, status: 0, reason: error.message };
    }
  }
}

// One HTTP/2 connection, reopened when Apple closes it.
function http2Transport(host) {
  let session = null;
  return (path, headers, body) => new Promise((resolve, reject) => {
    if (!session || session.closed || session.destroyed) {
      session = connect(host);
      session.on('error', () => { session = null; });
      session.on('goaway', () => { session = null; });
      session.unref();
    }
    const req = session.request({ ':method': 'POST', ':path': path, ...headers });
    let status = 0, data = '';
    req.setTimeout(15000, () => req.close());
    req.on('response', h => { status = h[':status']; });
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve({ status, body: data }));
    req.on('error', reject);
    req.end(body);
  });
}
