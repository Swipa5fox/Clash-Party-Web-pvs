# Clash Party Provider Integration v2

Client spec: `cpx-plugin/2`.

Chinese reference document:
[`机场服务端对接指南-v2.md`](机场服务端对接指南-v2.md).

Related files:

- Reference gateway: [`deploy/gateway/`](../../deploy/gateway/)
  (deployment, environment variables and the `cpx-admin` CLI are documented in
  [`deploy/gateway/README.md`](../../deploy/gateway/README.md))
- Descriptor generator: [`scripts/plugin/gen-cpx.mjs`](../../scripts/plugin/gen-cpx.mjs)

> ## Build note — differences from the upstream v2 design
>
> This repository is a **LAN direct-access build** of Clash Party. Compared with the
> upstream `cpx-plugin/2` design:
>
> - **Request signing is removed.** There is no Ed25519 device key pair, no
>   `devicePubKey` in `/enroll`, and no `sig`/`ts` in `/config` or `/revoke`.
>   Device identity is `deviceId` plus a one-time nonce (section 11).
> - **No local credential encryption.** The client stores `deviceId` and the
>   cached gateway as plaintext JSON.
> - **`http://` and private hosts are allowed** for `loginUrl` and `gateway`,
>   including `127.0.0.1`, LAN IPs and `localhost`. An `IP:port` deployment needs
>   no domain name and no certificate.
> - **Deep links and file association are gone.** `clash://install-plugin?url=...`
>   is not implemented and double-clicking a `.cpx` file does nothing — the
>   desktop shell was removed. Plugins are imported in the Web UI (section 3).
> - **The upstream signature test vectors are gone**:
>   `src/main/resolve/plugin/__fixtures__/sign-vectors.json` does not exist in
>   this build.
>
> The `spec` string `cpx-plugin/2` is unchanged, but the semantics in this
> document are the ones this build actually implements. Implement against this
> document, not against the upstream v2 specification. This build is meant for a
> trusted LAN; do not expose it to untrusted networks.
>
> During development there was an earlier v1 design (password + encrypted
> container). That design has been retired, and the current codebase does not
> include a v1 implementation.

---

## 1. Integration Model

The client must not receive the real subscription URL, API host, or origin token.

The user imports a public `.cpx` descriptor. Login happens in a browser against
the provider's own page. The client generates a `deviceId` (UUIDv4) locally, and
that id plus one-time nonces are the whole device credential. Subscription
updates then use a gateway challenge/config flow.

Provider-side components:

| Component                  | Host                                     | Purpose                                      |
| -------------------------- | ---------------------------------------- | -------------------------------------------- |
| OAuth authorize endpoint   | Login host from `.cpx` `loginUrl`        | User login and one-time code issuance        |
| `/.well-known/cpx-gateway` | Same host and port as `loginUrl`         | Current gateway origin and endpoint paths    |
| Gateway endpoints          | Gateway host; may differ from login host | Device enrollment, nonce, config, revocation |

The login host is the trust root and is fixed in distributed `.cpx` files. The
gateway host is discovered at runtime and can be rotated by updating the
well-known document.

Failure behavior:

| Failed host  | Result                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------- |
| Gateway host | Client can rediscover through the login host                                                  |
| Login host   | Existing devices can keep using the cached gateway; new login, re-login, and rediscovery fail |
| Both         | Client is disconnected; redistribute a new `.cpx`                                             |

Flow:

```text
Install:
  Import .cpx in the Web UI (drag onto the profiles page, or
    plugin card -> 导入插件 -> 选择文件)
  Validate descriptor
  Create local record (status needs-login); no network request yet

Login:
  1. GET {loginUrl scheme}://{loginUrl host}/.well-known/cpx-gateway
  2. Generate deviceId(UUIDv4)
  3. Open the authorize URL in a browser:
     loginUrl?response_type=code&code_challenge=...&state=...
     The client does not launch a browser by itself — it writes the URL to the
     application log (terminal output and the log file) and waits (see section 4).
  4. Provider login page redirects to:
     http://127.0.0.1:<port>/callback?code=...&state=...
  5. POST {gateway}/enroll with code and PKCE verifier
  6. POST {gateway}/challenge
  7. POST {gateway}/config with deviceId and nonce
  8. Store returned Clash YAML as a normal profile

Update:
  Repeat challenge -> config on the plugin interval (default 24h).
  No browser is opened.

Re-login:
  Gateway returns {"error":"revoked"} or {"error":"device_revoked"}.
  Client marks the plugin as needs-reauth.

Delete:
  Client best-effort calls /revoke, then deletes local state.
```

---

## 2. Reference Gateway

[`deploy/gateway/`](../../deploy/gateway/) is the reference implementation. It
includes Docker deployment, a SQLite account store, a panel gate, and
`cpx-admin`.

Important files:

| File                                                                           | Purpose                                           |
| ------------------------------------------------------------------------------ | ------------------------------------------------- |
| [`deploy/gateway/src/auth.mjs`](../../deploy/gateway/src/auth.mjs)             | authorize page and one-time codes                 |
| [`deploy/gateway/src/gateway.mjs`](../../deploy/gateway/src/gateway.mjs)       | enroll/challenge/config/revoke                    |
| [`deploy/gateway/src/crypto.mjs`](../../deploy/gateway/src/crypto.mjs)         | scrypt password hashing and PKCE (no Ed25519)     |
| [`deploy/gateway/src/origin.mjs`](../../deploy/gateway/src/origin.mjs)         | hidden-origin subscription fetch (https, bounded) |
| [`deploy/gateway/src/codes.mjs`](../../deploy/gateway/src/codes.mjs)           | in-memory one-time authorization-code pool        |
| [`deploy/gateway/src/nonces.mjs`](../../deploy/gateway/src/nonces.mjs)         | in-memory per-device nonce pool                   |
| [`deploy/gateway/src/db.mjs`](../../deploy/gateway/src/db.mjs)                 | `node:sqlite` users and devices store             |
| [`deploy/gateway/src/config.mjs`](../../deploy/gateway/src/config.mjs)         | environment configuration                         |
| [`deploy/gateway/src/server.mjs`](../../deploy/gateway/src/server.mjs)         | HTTP server and routing                           |
| [`deploy/gateway/src/panel-auth.mjs`](../../deploy/gateway/src/panel-auth.mjs) | signed-cookie gate for the panel/API proxy        |
| [`deploy/gateway/src/proxy.mjs`](../../deploy/gateway/src/proxy.mjs)           | reverse proxy to the mihomo external controller   |
| [`deploy/gateway/src/ratelimit.mjs`](../../deploy/gateway/src/ratelimit.mjs)   | per-IP login attempt limiter                      |
| [`deploy/gateway/src/admin.mjs`](../../deploy/gateway/src/admin.mjs)           | `cpx-admin` command implementation                |

For an existing panel, the usual additions are:

1. A device binding table: `username`, `device_id`, `created_at`. No public key
   column — this build does not sign requests.
2. Pending nonce storage: memory, Redis, or database; short TTL; consumed once;
   a per-device cap.
3. An OAuth authorize endpoint backed by the existing login system.
4. `/.well-known/cpx-gateway`.
5. Four gateway endpoints that call existing user-status and
   subscription-generation logic.

A login attempt limiter and a gate on any admin surface you publish next to the
gateway are recommended; the reference implementation ships both
(`ratelimit.mjs`, `panel-auth.mjs`).

---

## 3. `.cpx` Descriptor

`.cpx` is public JSON. Use one file for all users. It must not contain user data,
tokens, API hosts, gateway hosts, or subscription URLs.

```json
{
  "magic": "CPXF",
  "v": 2,
  "spec": "cpx-plugin/2",
  "loginUrl": "http://192.168.1.10:8080/oauth/authorize",
  "provider": {
    "name": "Example",
    "icon": "data:image/png;base64,iVBORw0K...",
    "site": "http://example.lan"
  }
}
```

Field rules:

| Field           | Rule                                                                                                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `magic`         | String `"CPXF"`                                                                                                                  |
| `v`             | Number `2`                                                                                                                       |
| `spec`          | String `"cpx-plugin/2"`                                                                                                          |
| Top-level keys  | Only `magic`, `v`, `spec`, `loginUrl`, `provider`                                                                                |
| `loginUrl`      | `http` or `https` URL; no query, fragment, or userinfo. Any host is accepted, including private IPs, `127.0.0.1` and `localhost` |
| `provider`      | Object; only `name`, `icon`, `site`                                                                                              |
| `provider.name` | Required non-empty string                                                                                                        |
| `provider.icon` | Optional data URI; only PNG/JPEG/WEBP; total string length <= 65536                                                              |
| `provider.site` | Optional `http`/`https` URL; no userinfo; path and query allowed                                                                 |

`loginUrl` is the OAuth authorize endpoint, not a generic login page. The client
appends OAuth parameters to it.

A `v: 1` file is rejected with a distinct "plugin file format is outdated"
message.

Generator:

```bash
node scripts/plugin/gen-cpx.mjs http://192.168.1.10:8080/oauth/authorize "Your Provider" http://192.168.1.10:8080 your-airport.cpx
```

The generator writes only `loginUrl`, `provider.name` and (optionally)
`provider.site`. Add `provider.icon` by hand if you need one.

### Distribution

Import happens in the Web UI:

- Drag a `.cpx` file onto the profiles page, or use the plugin card's
  `导入插件` button and `选择文件 (.cpx)`.
- The client shows a preview and confirmation page (provider name, icon, site,
  login host). Nothing is sent over the network during preview or install; the
  first network request happens when the user clicks `登录`.
- The client rejects a descriptor larger than 1 MiB.

There is no deep-link handler. `clash://install-plugin?url=...` and `mihomo://`
are not implemented in this build, and registering a `.cpx` file association has
no effect. Publish the descriptor for download and let users import it in the
Web UI.

---

## 4. OAuth Authorize

Use OAuth 2.0 Authorization Code + PKCE(S256). Credentials are submitted only to
the provider page.

Client query parameters:

| Parameter               | Value                                          |
| ----------------------- | ---------------------------------------------- |
| `response_type`         | `code`                                         |
| `client_id`             | `mihomo-party`                                 |
| `redirect_uri`          | `http://127.0.0.1:<random-port>/callback`      |
| `code_challenge`        | `BASE64URL(SHA256(code_verifier))`, no padding |
| `code_challenge_method` | `S256`                                         |
| `state`                 | Random string; echo unchanged                  |
| `scope`                 | `subscribe`                                    |

Authorize endpoint requirements:

1. Allow loopback redirect URI `http://127.0.0.1:<random-port>/callback`. The
   port changes per login. The reference gateway accepts
   `^http://(127\.0\.0\.1|localhost):\d{1,5}/callback$`.
2. After successful login, redirect to `redirect_uri?code=...&state=...`.
3. The issued `code` must be one-time and expire in no more than 60 seconds.
4. Store `username`, `redirect_uri`, `client_id`, and `code_challenge` with the
   code. `/enroll` must compare stored `redirect_uri` and `client_id`
   byte-for-byte.
5. Rate-limit failed and repeated submissions. The reference gateway allows 10
   authorize POSTs per IP per 60 seconds and then returns a 429 login error page.

Loopback redirect uses HTTP for native apps; do not reject it for not being
HTTPS. See RFC 8252.

### How the client actually opens this URL

The client does not launch a browser. It generates the authorize URL, writes it
to the Clash Party application log, and waits up to 5 minutes for the callback.
The log line is:

```text
[<timestamp>] [WARN] [PluginOAuth] open in your browser: http://<login-host>/oauth/authorize?...
```

It lands on the process console output **and** in
`logs/clash-party-<date>.log` under the data directory, so `docker logs` and the
log file both work. Users copy the URL from there; the Web UI states this
explicitly instead of promising to open a browser.

The callback listener binds `127.0.0.1` **on the machine running the client**.
The login browser must therefore be able to reach that address, which means:

- the browser runs on the same machine as the client, or
- the port is forwarded (SSH tunnel) or the deployment otherwise routes
  `127.0.0.1:<port>/callback` from the browser's machine to the client's machine.

With the browser on a different machine and no tunnel, the provider's redirect
cannot connect to anything and login cannot complete. Providers should surface
the authorize URL (or a QR code) on their own login page so an operator can move
it to a browser that satisfies the above.

A callback with a wrong `state` or a missing `code` is answered with
`Login failed. You may close this window.`; a good one with
`Login complete. You may close this window.`.

---

## 5. Gateway Discovery

The client requests the exact host from `loginUrl`, keeping its scheme:

```text
GET {loginUrl scheme}://{loginUrl host}/.well-known/cpx-gateway
```

Response:

```json
{
  "spec": "cpx-plugin/2",
  "gateway": "http://192.168.1.10:8080",
  "endpoints": {
    "enroll": "/enroll",
    "challenge": "/challenge",
    "config": "/config",
    "revoke": "/revoke"
  }
}
```

Field rules:

| Field       | Rule                                                                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `spec`      | String `"cpx-plugin/2"`                                                                                                                                                  |
| `gateway`   | `http`/`https` origin only: scheme, host, optional port; no path, query, fragment, or userinfo. Any host is accepted, including private/loopback                         |
| `endpoints` | Must contain `enroll`, `challenge`, `config`, `revoke`; each value is a relative path starting with `/`; no absolute URL, protocol-relative `//`, `?`, `#`, or backslash |

The discovery request does not follow redirects and caps the response body at
64 KiB. Non-2xx, invalid JSON, or invalid fields are discovery failures.

### Gateway Rotation

To rotate the gateway, update `/.well-known/cpx-gateway`.

The client rediscovers and retries once when the cached gateway returns:

- HTTP `410`;
- JSON `{"error":"gateway_retired"}`;
- network-level failure, such as DNS failure, connection failure, or TLS
  handshake failure.

When rediscovery succeeds the client stores the new gateway in its local vault,
so the following updates go straight to the new host.

Plain 5xx, 429, and timeouts are treated as transient failures. They do not
trigger rediscovery.

Rediscovery requires the login host to be reachable. Revocation on delete uses
the same rediscovery path, so a rotated gateway still gets its device unbound.

---

## 6. Gateway Common Rules

All gateway endpoints are `POST` with JSON request bodies and
`Content-Type: application/json`. The client speaks `http` or `https` depending
on what was discovered, does not follow redirects, and caps responses at 10 MiB.
Request timeouts come from the client's subscription-timeout setting (default
30 seconds). Requests can optionally be sent through the client's local mixed
proxy (`走代理` switch on the plugin card).

No Authorization header is used. No bearer token is issued. Device identity is
`deviceId` plus a one-time nonce; there is no request signature.

Client error classification:

| Class       | Condition                                                  | Client action                             |
| ----------- | ---------------------------------------------------------- | ----------------------------------------- |
| `retired`   | HTTP `410`, or JSON `{"error":"gateway_retired"}`          | Rediscover gateway and retry once         |
| `revoked`   | JSON `{"error":"revoked"}` or `{"error":"device_revoked"}` | Mark as needs-reauth                      |
| `transient` | Other non-2xx (including `429`), timeout, network error    | Back off and retry; login state unchanged |
| success     | 2xx without an error marker                                | Continue                                  |

For expired accounts, disabled users, or revoked devices, include `revoked` or
`device_revoked` in the JSON body. A bare `401` or `403` is treated as
transient.

Transient failures on profile update are retried with exponential backoff:
10 minutes after the first failure, doubling on each further failure, capped at
24 hours, with up to 30% jitter added.

---

## 7. `POST {gateway}/enroll`

Purpose: exchange an authorize code for a device binding. This is similar to
OAuth token exchange, but no bearer token is returned.

Request:

```json
{
  "code": "<authorize code>",
  "code_verifier": "<PKCE verifier>",
  "redirect_uri": "http://127.0.0.1:<port>/callback",
  "client_id": "mihomo-party",
  "deviceId": "<UUIDv4>"
}
```

Server steps:

1. Find `code`; consume it even if a later step fails.
2. Verify PKCE: `BASE64URL(SHA256(code_verifier)) == code_challenge`.
3. Compare `redirect_uri` and `client_id` with the stored values byte-for-byte.
4. Validate `deviceId` as UUIDv4.
5. Resolve the user from the code.
6. Enforce the device limit; store `(username, deviceId, created_at)`.
7. Return 2xx, for example `{"ok":true}`.

Reference gateway error bodies:

| Status | Body                           | Cause                                  |
| ------ | ------------------------------ | -------------------------------------- |
| 400    | `{"error":"invalid_code"}`     | unknown, expired, or already-used code |
| 400    | `{"error":"bad_pkce"}`         | verifier does not match the challenge  |
| 400    | `{"error":"binding_mismatch"}` | `redirect_uri` or `client_id` mismatch |
| 400    | `{"error":"bad_request"}`      | `deviceId` is not a UUIDv4             |
| 403    | `{"error":"device_limit"}`     | device limit reached                   |

Notes:

- `deviceId` is client-generated. Do not replace it.
- A user may have multiple devices. Apply a device-count limit or cleanup
  policy; re-binding an existing `deviceId` to the same user must not consume a
  new slot.
- If enroll succeeds but the first config fetch fails, keep the device binding.
  The client keeps its device and retries the fetch on the next login attempt.
- Re-login creates a new `deviceId` and a new device binding.

---

## 8. `POST {gateway}/challenge`

Purpose: issue a one-time nonce for a device.

Request:

```json
{ "deviceId": "<UUIDv4>" }
```

Success response:

```json
{
  "nonceId": "<opaque id>",
  "nonce": "<base64 32 bytes>",
  "exp": 60
}
```

Rules:

- Keep a pending-nonce pool per `deviceId`.
- Allow several pending nonces for concurrency.
- `nonce` is 32 cryptographically random bytes.
- TTL should be no more than 60 seconds.
- Delete the nonce after use; clean expired nonces.
- Limit pending nonces per device, for example 8.
- `nonceId` is an opaque visible ASCII handle, length <= 64, with no spaces or
  control characters.
- `nonce` uses standard base64 with `=` padding; decoded length must be exactly
  32 bytes.
- `exp` is informational and is expressed in seconds.

Reference gateway behavior: `nonceId` is 16 random bytes as hex (32 characters),
`nonce` is 32 random bytes as base64 (44 characters), TTL is 60 seconds, and the
pool is in memory — a restart simply drops in-flight challenges.

Errors:

| Status | Body                          | Cause                                       |
| ------ | ----------------------------- | ------------------------------------------- |
| 410    | `{"error":"gateway_retired"}` | gateway retired                             |
| 403    | `{"error":"device_revoked"}`  | unknown device, expired account, or revoked |
| 429    | `{"error":"too_many_nonces"}` | per-device pending-nonce cap reached        |

---

## 9. `POST {gateway}/config`

Purpose: return the user's Clash YAML for a device holding a valid nonce.

Request:

```json
{
  "deviceId": "<UUIDv4>",
  "nonceId": "<challenge nonceId>",
  "nonce": "<challenge nonce>"
}
```

Server steps:

1. Return `410 {"error":"gateway_retired"}` if the gateway is retired.
2. Look up the device; unknown device -> `403 {"error":"device_revoked"}`.
3. Look up the pending nonce by `deviceId` and `nonceId`; compare `nonce` in
   constant time; failure -> `401 {"error":"bad_nonce"}`.
4. Consume the nonce.
5. Resolve the user from the device.
6. Generate the subscription internally or fetch it from a hidden origin.
7. Return HTTP 200 with Clash YAML as the response body
   (`text/yaml; charset=utf-8`).

The client calls `/challenge` first for every `/config` and `/revoke` request,
so each nonce is bound to one operation.

Successful `/config` response is not JSON. The client parses it as Clash YAML and
requires an object containing at least `proxies` or `proxy-providers`. Anything
else is treated as a transient failure.

Do not return the subscription URL, origin API host, or origin token.

A failing hidden-origin fetch should be reported as
`502 {"error":"upstream"}` (the reference gateway does this).

---

## 10. `POST {gateway}/revoke`

Purpose: unbind a device. The client calls this best-effort when the user deletes
the plugin or deletes the generated profile.

Request body is the same as `/config`:

```json
{
  "deviceId": "<UUIDv4>",
  "nonceId": "<challenge nonceId>",
  "nonce": "<challenge nonce>"
}
```

Use the same verification flow as `/config`, consume the nonce, then remove the
`deviceId` binding.

`/revoke` must be idempotent. Return 2xx even if the device is already absent —
the reference gateway checks the device first and answers `{"ok":true}` without
touching the nonce store in that case.

---

## 11. Device Identity and Replay Protection

This build has no request signing. The two things that identify and protect a
device are:

- `deviceId` — a client-generated UUIDv4, stored server-side against a user. It
  is the only device credential and is not secret beyond being unguessable.
- A one-time nonce — requested from `/challenge` immediately before each
  `/config` and `/revoke`, checked against the pending pool, and consumed once.

Properties this gives you:

- A request is only accepted inside the nonce TTL (<= 60 s).
- Replaying a captured request fails, because the nonce is gone after the first
  use.
- The client never sends a bearer token, so there is nothing long-lived to
  steal from the wire.

What it does not give you: authentication of the caller. Anyone who learns a
`deviceId` can ask for a nonce and pull that device's subscription. Treat
`deviceId` and the gateway itself as LAN-internal, which is the deployment
assumption of this build.

For reference, the upstream v2 design signed each request with an Ed25519 device
key over:

```text
SignInput = "CPX2" | uint8(op) | uint8(len(deviceId)) | deviceId
          | uint8(len(nonceId)) | nonceId | nonce(32 raw bytes) | uint64_be(ts)
```

with `op=1` for config and `op=2` for revoke, and sent `devicePubKey`, `ts`, and
`sig` alongside. **This build neither sends nor verifies any of that.** A server
that requires a signature will reject every request from this client, and this
client ignores signature-related fields entirely. Implement the nonce check
instead.

---

## 12. Wire Encoding

| Field                              | Encoding                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `deviceId`                         | UUIDv4, 36 lowercase chars with hyphens; the reference gateway rejects anything else        |
| `nonceId`                          | Server-generated opaque visible ASCII, length <= 64 (reference: 32 hex chars)               |
| `nonce`                            | 32 raw bytes, standard base64 with padding, usually 44 chars                                |
| `code`                             | Opaque authorize code; the reference gateway issues 32 random bytes as base64url (43 chars) |
| `code_challenge` / `code_verifier` | RFC 7636 base64url, no padding; verifier length 43-128, charset `[A-Za-z0-9-._~]`           |
| `redirect_uri`                     | `http://127.0.0.1:<port>/callback`                                                          |
| `client_id`                        | `mihomo-party`                                                                              |
| `exp`                              | Integer seconds; informational                                                              |

Only PKCE fields use base64url without padding. `nonce` uses standard base64 with
padding. Signed-protocol fields (`devicePubKey`, `sig`, `ts`, `op`) are not used
by this build.

---

## 13. PHP Snippet

PKCE:

```php
function pkce_ok(string $verifier, string $challenge): bool {
    $calc = rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');
    return hash_equals($challenge, $calc);
}
```

Nonce check and consume for `/config` and `/revoke`:

```php
$nonceB64 = (string)($req['nonce'] ?? '');
$nonceRaw = base64_decode($nonceB64, true);
if ($nonceRaw === false || strlen($nonceRaw) !== 32) { /* 400 */ }

// Pending row was stored as (nonceId, deviceId, nonceRaw, exp).
$row = $store->get($req['nonceId'] ?? '');
if (!$row || $row['deviceId'] !== $req['deviceId'] || $row['exp'] < time()) {
    http_response_code(401);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'bad_nonce']);
    exit;
}
if (!hash_equals($row['nonceRaw'], $nonceRaw)) {
    http_response_code(401);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'bad_nonce']);
    exit;
}
$store->delete($req['nonceId']); // consume exactly once

// Then resolve the user from deviceId and return Clash YAML (text/yaml).
```

Revocation response for an expired account or revoked device:

```php
http_response_code(403);
header('Content-Type: application/json');
echo json_encode(['error' => 'revoked']);
```

Gateway retirement:

```php
http_response_code(410);
header('Content-Type: application/json');
echo json_encode(['error' => 'gateway_retired']);
```

---

## 14. Interop Testing

Run the reference gateway and walk one full round trip:

1. Start the stack (`deploy/gateway/deploy.sh` or
   `docker compose up` in [`deploy/gateway/`](../../deploy/gateway/)) and set
   `PUBLIC_ORIGIN` to the gateway origin written into the discovery document.
2. Create an account and bind a subscription URL:

   ```bash
   cpx-admin add-user alice https://origin.example.net/sub/abc --limit 3
   cpx-admin list-users
   ```

3. Generate the descriptor with `scripts/plugin/gen-cpx.mjs` pointing at the
   gateway's `/oauth/authorize`.
4. Import the `.cpx` in the Web UI, log in, and confirm the profile appears.
5. Verify the wire behavior:

   - `/enroll` returns 2xx and `cpx-admin list-devices alice` shows the new
     `deviceId`.
   - `/challenge` returns a 44-character standard-base64 `nonce` and a
     `nonceId` of at most 64 visible ASCII characters.
   - `/config` returns Clash YAML that parses to an object with `proxies` or
     `proxy-providers`.
   - Replaying the same `/config` body fails with `401 bad_nonce`.
   - After deleting the plugin, the device is gone from
     `cpx-admin list-devices alice`.
   - Setting `RETIRED=true` makes `/challenge` and `/config` answer
     `410 gateway_retired`.

Client-side unit tests for this protocol live in
`src/main/resolve/plugin/*.test.ts`; gateway tests live in
`deploy/gateway/src/*.test.mjs`.

The upstream signature test vectors
(`src/main/resolve/plugin/__fixtures__/sign-vectors.json`) are not part of this
build, and no test or checklist item depends on them.

---

## 15. Launch Checklist

Descriptor:

- [ ] `.cpx` contains only valid v2 fields.
- [ ] `loginUrl` is an authorize endpoint with no query, fragment, or userinfo.
- [ ] Optional icon uses an allowed data URI format and size.
- [ ] The descriptor is published for download; no deep link is advertised.

Login host:

- [ ] `/.well-known/cpx-gateway` returns valid JSON.
- [ ] authorize accepts `http://127.0.0.1:<random-port>/callback`.
- [ ] successful login redirects with `code` and the original `state`.
- [ ] code is one-time and TTL <= 60 seconds.
- [ ] code stores `username`, `redirect_uri`, `client_id`, and `code_challenge`.
- [ ] the authorize URL is reachable from a browser that can also reach the
      client host's `127.0.0.1` (same machine, tunnel, or documented workaround).
- [ ] login attempts are rate-limited.

Gateway:

- [ ] `gateway` is an `http`/`https` origin with no path, query, fragment, or
      userinfo.
- [ ] endpoint paths are relative and contain no backslash, query, or fragment.
- [ ] `/enroll` consumes the code once, verifies PKCE, redirect URI, and client
      ID, and enforces the device limit.
- [ ] `/challenge` issues 32-byte standard-base64 nonce values with short TTL and
      pool limits.
- [ ] `/config` verifies and consumes the nonce and returns Clash YAML.
- [ ] `/revoke` verifies and consumes the nonce and idempotently unbinds the
      device.
- [ ] account/device revocation returns `{"error":"revoked"}` or
      `{"error":"device_revoked"}`.
- [ ] gateway retirement returns HTTP `410` or `{"error":"gateway_retired"}`.

Compatibility:

- [ ] no request signature is required (`devicePubKey`, `sig`, `ts`, `op` are not
      used).
- [ ] `nonce` uses standard base64 with padding and decodes to 32 bytes.
- [ ] PKCE uses base64url without padding.
- [ ] `redirect_uri` and `client_id` are compared byte-for-byte at `/enroll`.
- [ ] the hidden origin is still never exposed to the client.

---

## 16. Logging

Do not log:

- authorize `code`
- `code_verifier`
- nonce or nonceId
- user password or raw login form
- subscription URL, origin token, or full Clash YAML

Safe operational fields include `username`, `deviceId`, endpoint name, status
code, duration, and gateway version.
