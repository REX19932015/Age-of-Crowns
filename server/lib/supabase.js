'use strict';
// Small Supabase client for the server: checks player logins (Auth) and reads/writes
// tables through the REST API (PostgREST) with the SECRET key. No packages needed (Node 18+ fetch).

class SupabaseError extends Error {
  constructor(status, body) {
    super((body && (body.message || body.msg || body.error_description || body.error)) || ('HTTP ' + status));
    this.status = status; this.body = body; this.code = body && body.code;
  }
}

class Supa {
  constructor(url, secretKey) {
    this.url = url.replace(/\/+$/, '');
    this.key = secretKey;
    // New-style keys (sb_secret_…) go only in the apikey header; legacy service_role JWTs also go in Authorization.
    this.isJwt = !secretKey.startsWith('sb_');
  }
  _headers(extra) {
    const h = { apikey: this.key, 'Content-Type': 'application/json', ...extra };
    if (this.isJwt) h.Authorization = 'Bearer ' + this.key;
    return h;
  }
  async _req(method, path, body, headers) {
    const res = await fetch(this.url + path, { method, headers: this._headers(headers), body: body === undefined ? undefined : JSON.stringify(body) });
    const txt = await res.text();
    let data = null; try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
    if (!res.ok) throw new SupabaseError(res.status, data);
    return data;
  }

  /** Returns the Supabase user for a player's access token, or null if the token is not valid. */
  async userFromToken(token) {
    if (!token || typeof token !== 'string' || token.length > 4096) return null;
    const res = await fetch(this.url + '/auth/v1/user', { headers: { apikey: this.key, Authorization: 'Bearer ' + token } });
    if (!res.ok) return null;
    const u = await res.json().catch(() => null);
    return u && u.id ? u : null;
  }

  static _filters(q, where) {
    for (const [col, v] of Object.entries(where || {})) {
      if (v === null) q.push(col + '=is.null');
      else if (Array.isArray(v)) q.push(col + '=in.(' + v.map(x => '"' + String(x).replace(/"/g, '') + '"').join(',') + ')');
      else if (typeof v === 'object' && v.op) q.push(col + '=' + v.op + '.' + encodeURIComponent(String(v.value)));
      else q.push(col + '=eq.' + encodeURIComponent(String(v)));
    }
  }
  async select(table, { columns = '*', where = {}, order = null, limit = null } = {}) {
    const q = ['select=' + encodeURIComponent(columns)];
    Supa._filters(q, where);
    if (order) q.push('order=' + encodeURIComponent(order));
    if (limit) q.push('limit=' + limit);
    return this._req('GET', '/rest/v1/' + table + '?' + q.join('&'));
  }
  async one(table, opts) { const r = await this.select(table, { ...opts, limit: 1 }); return r && r[0] ? r[0] : null; }
  async insert(table, rows, { upsert = false, onConflict = null, returning = true } = {}) {
    const prefer = [returning ? 'return=representation' : 'return=minimal'];
    if (upsert) prefer.push('resolution=merge-duplicates');
    const q = onConflict ? '?on_conflict=' + encodeURIComponent(onConflict) : '';
    return this._req('POST', '/rest/v1/' + table + q, rows, { Prefer: prefer.join(',') });
  }
  async update(table, where, patch, { returning = false } = {}) {
    const q = []; Supa._filters(q, where);
    if (!q.length) throw new Error('refusing to update without a filter');
    return this._req('PATCH', '/rest/v1/' + table + '?' + q.join('&'), patch, { Prefer: returning ? 'return=representation' : 'return=minimal' });
  }
  async remove(table, where) {
    const q = []; Supa._filters(q, where);
    if (!q.length) throw new Error('refusing to delete without a filter');
    return this._req('DELETE', '/rest/v1/' + table + '?' + q.join('&'), undefined, { Prefer: 'return=minimal' });
  }
}

module.exports = { Supa, SupabaseError };
