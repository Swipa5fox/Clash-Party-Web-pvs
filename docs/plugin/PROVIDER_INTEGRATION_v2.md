# Clash Party Provider Integration v2

Client spec: `cpx-plugin/2`.

Chinese reference document:
[`机场服务端对接指南-v2.md`](机场服务端对接指南-v2.md).

Related files:

- Reference gateway: [`deploy/gateway/`](../../deploy/gateway/)
- Sign test vectors:
  [`src/main/resolve/plugin/__fixtures__/sign-vectors.json`](../../src/main/resolve/plugin/__fixtures__/sign-vectors.json)

During development there was an earlier v1 design (password + encrypted container).
That design has been retired, and the current codebase does not include a v1
implementation.

---

## 1. Integration Model

The client must not receive the real subscription URL, API host, or origin token.

The user imports a public `.cpx` descriptor. Login happens in the system browser. The client generates an Ed25519 device key pair locally. Subscription updates then use a gateway challenge/config flow.

Provider-side components:

| Component                  | Host                                     | Purpose                                      |
| -------------------------- | ---------------------------------------- | -------------------------------------------- |
| OAuth authorize endpoint   | Login host from `.cpx` `loginUrl`        | User login and one-time code issuance        |
| `/.well-known/cpx-gateway` | Same host and port as `loginUrl`         | Current gateway origin and endpoint paths    |
| Gateway endpoints          | Gateway host; may differ from login host | Device enrollment, nonce, config, revocation |

The login host is the trust root and is fixed in distributed `.cpx` files. The gateway host is discovered at runtime and can be rotated by updating the well-known document.

Failure behavior:

| Failed host  | Result                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------- |
| Gateway host | Client can rediscover through the login host                                                  |
| Login host   | Existing devices can keep using the cached gateway; new login, re-login, and rediscovery fail |
| Both         | Client is disconnected; redistribute a new `.cpx`                                             |

Flow:

```text
Install:
  Import .cpx
  Validate descriptor
  Create local record; no network request yet

Login:
  1. GET https://<login-host>/.well-known/cpx-gateway
  2. Generate Ed25519 device key pair and deviceId(UUIDv4)
  3. Open system browser:
     loginUrl?response_type=code&code_challenge=...&state=...
  4. Provider login page redirects to:
     http://127.0.0.1:<port>/callback?code=...&state=...
  5. POST {gateway}/enroll with code and PKCE verifier
  6. POST {gateway}/challenge
  7. POST {gateway}/config with Ed25519 signature
  8. Store returned Clash YAML as a normal profile

Update:
  Repeat challenge -> config. No browser is opened.

Re-login:
  Gateway returns {"error":"revoked"} or {"error":"device_revoked"}.
  Client marks the profile as needs re-authentication.

Delete:
  Client best-effort calls /revoke, then deletes local state.
```

---

## 2. Reference Gateway

[`deploy/gateway/`](../../deploy/gateway/) is the reference implementation. It includes Docker deployment, a SQLite account store, and `cpx-admin`.

Important files:

| File                                                                     | Purpose                             |
| ------------------------------------------------------------------------ | ----------------------------------- |
| [`deploy/gateway/src/auth.mjs`](../../deploy/gateway/src/auth.mjs)       | authorize page and one-time codes   |
| [`deploy/gateway/src/gateway.mjs`](../../deploy/gateway/src/gateway.mjs) | enroll/challenge/config/revoke      |
| [`deploy/gateway/src/crypto.mjs`](../../deploy/gateway/src/crypto.mjs)   | PKCE, Ed25519, canonical sign input |
| [`deploy/gateway/src/origin.mjs`](../../deploy/gateway/src/origin.mjs)   | hidden-origin subscription fetch    |

For an existing panel, the usual additions are:

1. A device binding table: `user_id`, `device_id`, `device_pubkey`, `created_at`.
2. Pending nonce storage: Redis, memory, or database; short TTL; delete after use.
3. An OAuth authorize endpoint backed by the existing login system.
4. `/.well-known/cpx-gateway`.
5. Four gateway endpoints that call existing user-status and subscription-generation logic.

---

## 3. `.cpx` Descriptor

`.cpx` is public JSON. Use one file for all users. It must not contain user data, tokens, API hosts, gateway hosts, or subscription URLs.

```json
{
  "magic": "CPXF",
  "v": 2,
  "spec": "cpx-plugin/2",
  "loginUrl": "https://panel.example.com/oauth/authorize",
  "provider": {
    "name": "Example",
    "icon": "data:image/png;base64,iVBORw0K...",
    "site": "https://example.com"
  }
}
```

Field rules:

| Field           | Rule                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------- |
| `magic`         | String `"CPXF"`                                                                                               |
| `v`             | Number `2`                                                                                                    |
| `spec`          | String `"cpx-plugin/2"`                                                                                       |
| Top-level keys  | Only `magic`, `v`, `spec`, `loginUrl`, `provider`                                                             |
| `loginUrl`      | HTTPS URL; no query, fragment, or userinfo; host must not be private, loopback, `localhost`, or `*.localhost` |
| `provider`      | Object; only `name`, `icon`, `site`                                                                           |
| `provider.name` | Required non-empty string                                                                                     |
| `provider.icon` | Optional data URI; only PNG/JPEG/WEBP; total string length <= 65536                                           |
| `provider.site` | Optional HTTPS URL; same host restrictions as `loginUrl`; path is allowed                                     |

`loginUrl` is the OAuth authorize endpoint, not a generic login page. The client appends OAuth parameters to it.

Generator:

```bash
node scripts/plugin/gen-cpx.mjs <loginUrl> <providerName> [site] [output]
```

### Distribution Options

- **File download**: Distribute the `.cpx` file directly. Clients with the file association registered can launch the app by double-clicking the file and will see the plugin preview and confirmation page.
- **Deep link**: Host the same `.cpx` file at a public HTTPS URL, then use the following link in a web button or QR code:

  ```text
  clash://install-plugin?url=https%3A%2F%2Fprovider.example.com%2Fapp.cpx
  ```

  `mihomo://` is equivalent to `clash://`. URL-encode the `url` parameter. The client downloads and validates the file, installs the plugin, and opens the system browser for login. The download URL must use public HTTPS, redirects are rejected, and the file must not exceed 1 MiB.

---

## 4. OAuth Authorize

Use OAuth 2.0 Authorization Code + PKCE(S256). The client opens the system browser. Credentials are submitted only to the provider page.

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

1. Allow loopback redirect URI `http://127.0.0.1:<random-port>/callback`. The port changes per login.
2. After successful login, redirect to `redirect_uri?code=...&state=...`.
3. The issued `code` must be one-time and expire in no more than 60 seconds.
4. Store `user_id`, `redirect_uri`, `client_id`, and `code_challenge` with the code.
5. `/enroll` must compare stored `redirect_uri` and `client_id` byte-for-byte.

Loopback redirect uses HTTP for native apps; do not reject it for not being HTTPS. See RFC 8252.

---

## 5. Gateway Discovery

The client requests the exact host from `loginUrl`:

```text
GET https://<login-host>/.well-known/cpx-gateway
```

Response:

```json
{
  "spec": "cpx-plugin/2",
  "gateway": "https://gw.front.example.net",
  "endpoints": {
    "enroll": "/enroll",
    "challenge": "/challenge",
    "config": "/config",
    "revoke": "/revoke"
  }
}
```

Field rules:

| Field       | Rule                                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `spec`      | String `"cpx-plugin/2"`                                                                                                                          |
| `gateway`   | HTTPS origin only: scheme, host, optional port; no path, query, fragment, or userinfo; public host                                               |
| `endpoints` | Must contain `enroll`, `challenge`, `config`, `revoke`; each value is a relative path starting with `/`; no absolute URL, `?`, `#`, or backslash |

The discovery request uses HTTPS only, does not follow redirects, and caps the response body at 64 KiB. Non-2xx, invalid JSON, or invalid fields are discovery failures.

### Gateway Rotation

To rotate the gateway, update `/.well-known/cpx-gateway`.

The client rediscovers and retries once when the cached gateway returns:

- HTTP `410`;
- JSON `{"error":"gateway_retired"}`;
- network-level failure, such as DNS failure, connection failure, or TLS handshake failure.

Plain 5xx, 429, and timeouts are treated as transient failures. They do not trigger rediscovery.

Rediscovery requires the login host to be reachable.

---

## 6. Gateway Common Rules

All gateway endpoints are `POST` with JSON request bodies. The client uses HTTPS only, does not follow redirects, and caps responses at 10 MiB.

No Authorization header is used. No bearer token is issued. Device identity is based on `deviceId`, the stored Ed25519 public key, and request signatures.

Client error classification:

| Class       | Condition                                                  | Client action                             |
| ----------- | ---------------------------------------------------------- | ----------------------------------------- |
| `retired`   | HTTP `410`, or JSON `{"error":"gateway_retired"}`          | Rediscover gateway and retry once         |
| `revoked`   | JSON `{"error":"revoked"}` or `{"error":"device_revoked"}` | Mark as needs re-authentication           |
| `transient` | Other non-2xx, timeout, network error                      | Back off and retry; login state unchanged |
| success     | 2xx without an error marker                                | Continue                                  |

For expired accounts, disabled users, or revoked devices, include `revoked` or `device_revoked` in the JSON body. A bare `401` or `403` is treated as transient.

---

## 7. `POST {gateway}/enroll`

Purpose: exchange an authorize code for a device binding. This is similar to OAuth token exchange, but no bearer token is returned.

Request:

```json
{
  "code": "<authorize code>",
  "code_verifier": "<PKCE verifier>",
  "redirect_uri": "http://127.0.0.1:<port>/callback",
  "client_id": "mihomo-party",
  "devicePubKey": "<base64 Ed25519 public key>",
  "deviceId": "<UUIDv4>"
}
```

Server steps:

1. Find `code`; verify it is unexpired and unused.
2. Verify PKCE: `BASE64URL(SHA256(code_verifier)) == code_challenge`.
3. Compare `redirect_uri` and `client_id` with the stored values byte-for-byte.
4. Resolve `user_id` from the code.
5. Store `(user_id, deviceId, devicePubKey)`.
6. Mark the code as used.
7. Return 2xx, for example `{"ok":true}`.

Notes:

- `deviceId` is client-generated. Do not replace it.
- A user may have multiple devices. Apply a device-count limit or cleanup policy.
- If enroll succeeds but the first config fetch fails, keep the device binding.
- Re-login creates a new key pair and a new device binding.

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
- Delete nonce after use; clean expired nonces.
- Limit pending nonces per device, for example 8.
- `nonceId` is an opaque visible ASCII handle, length <= 64, with no spaces or control characters.
- `nonce` uses standard base64 with `=` padding; decoded length must be exactly 32 bytes.
- `exp` is informational.

For an unknown device, expired account, or revoked device, return:

```json
{ "error": "revoked" }
```

---

## 9. `POST {gateway}/config`

Purpose: verify the device signature and return the user's Clash YAML.

Request:

```json
{
  "deviceId": "<UUIDv4>",
  "nonceId": "<challenge nonceId>",
  "nonce": "<challenge nonce>",
  "ts": 1700000000000,
  "sig": "<base64 Ed25519 signature>"
}
```

Server steps:

1. Look up the pending nonce by `deviceId` and `nonceId`.
2. Verify request `nonce` matches the stored value.
3. Verify the nonce is unexpired and unconsumed.
4. Check clock skew: `abs(now_ms - ts) <= 300000`.
5. Load `devicePubKey` for the device.
6. Build the canonical sign input from section 11 with `op=1`.
7. Verify the Ed25519 signature.
8. Consume the nonce.
9. Resolve `user_id` from `deviceId`.
10. Generate the subscription internally or fetch it from a hidden origin.
11. Return HTTP 200 with Clash YAML as the response body.

Successful `/config` response is not JSON. The client parses it as Clash YAML and requires an object containing at least `proxies` or `proxy-providers`.

Do not return the subscription URL, origin API host, or origin token.

---

## 10. `POST {gateway}/revoke`

Purpose: unbind a device. The client calls this best-effort when the user deletes the plugin.

Request body is the same as `/config`.

Use the same verification flow as `/config`, but build the sign input with `op=2`. After successful verification, remove the `deviceId` binding and consume the nonce.

`/revoke` must be idempotent. Return 2xx even if the device is already absent.

---

## 11. Device Signature

Canonical sign input:

```text
SignInput = "CPX2"                              // 4 bytes ASCII
          | uint8(op)                           // config=1, revoke=2
          | uint8(len(deviceId)) | deviceId     // UTF-8 bytes
          | uint8(len(nonceId))  | nonceId      // UTF-8 bytes
          | nonce                               // 32 raw bytes
          | uint64_be(ts)                       // Unix milliseconds
```

Signature:

```text
sig = Ed25519_sign(devicePrivKey, SignInput)
```

`sig` is 64 raw bytes on input to standard base64.

Implementation notes:

- Decode `nonce` from base64 before adding it to `SignInput`.
- Encode `ts` as an 8-byte unsigned big-endian integer.
- `deviceId` and `nonceId` length prefixes are one unsigned byte.
- `/config` uses `op=1`; `/revoke` uses `op=2`.

---

## 12. Wire Encoding

| Field                              | Encoding                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| `devicePubKey`                     | Ed25519 public key, 32 raw bytes, standard base64 with padding                    |
| `sig`                              | Ed25519 signature, 64 raw bytes, standard base64 with padding                     |
| `nonce`                            | 32 raw bytes, standard base64 with padding, usually 44 chars                      |
| `deviceId`                         | UUIDv4, 36 lowercase chars with hyphens; server cap <= 64                         |
| `nonceId`                          | Server-generated opaque visible ASCII, length <= 64                               |
| `ts`                               | Integer, Unix milliseconds                                                        |
| `op`                               | `uint8`; config=1, revoke=2                                                       |
| `code`                             | Opaque authorize code, length <= 2048                                             |
| `code_challenge` / `code_verifier` | RFC 7636 base64url, no padding; verifier length 43-128, charset `[A-Za-z0-9-._~]` |

Only PKCE fields use base64url without padding. Binary protocol fields use standard base64 with padding.

---

## 13. PHP Snippet

PKCE:

```php
function pkce_ok(string $verifier, string $challenge): bool {
    $calc = rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');
    return hash_equals($challenge, $calc);
}
```

Signature verification:

```php
function build_sign_input(int $op, string $deviceId, string $nonceId, string $nonceRaw, int $tsMs): string {
    return "CPX2"
        . chr($op)
        . chr(strlen($deviceId)) . $deviceId
        . chr(strlen($nonceId)) . $nonceId
        . $nonceRaw
        . pack('J', $tsMs); // uint64 big-endian
}

$nonceRaw = base64_decode($req['nonce'], true);
$pub      = base64_decode($devicePubKeyB64, true);
$sig      = base64_decode($req['sig'], true);
$ts       = (int)$req['ts'];

if ($nonceRaw === false || $pub === false || $sig === false) { /* 400 */ }
if (strlen($nonceRaw) !== 32 || strlen($pub) !== 32 || strlen($sig) !== 64) { /* 400 */ }
if (abs((int)(microtime(true) * 1000) - $ts) > 300000) { /* 400 */ }

// Also check nonceId/nonce belongs to deviceId and is unexpired/unconsumed.

$op    = ($endpoint === 'config') ? 1 : 2;
$input = build_sign_input($op, $req['deviceId'], $req['nonceId'], $nonceRaw, $ts);
$ok    = sodium_crypto_sign_verify_detached($sig, $input, $pub);
if (!$ok) { /* 401 or 400 */ }

// Consume nonce after successful verification.
```

Revocation response:

```php
http_response_code(403);
header('Content-Type: application/json');
echo json_encode(['error' => 'revoked']);
```

---

## 14. Test Vectors

File:

```text
src/main/resolve/plugin/__fixtures__/sign-vectors.json
```

Each vector contains:

- `op`
- `deviceId`
- `nonceId`
- `privSeedB64`
- `pubKeyB64`
- `nonceB64`
- `ts`
- `inputHex`
- `sigB64`

Verify:

1. Your canonical input hex equals `inputHex`.
2. `sigB64` verifies under `pubKeyB64`.

Regenerate vectors:

```bash
node scripts/plugin/gen-sign-vectors.mjs
```

---

## 15. Launch Checklist

Descriptor:

- [ ] `.cpx` contains only valid v2 fields.
- [ ] `loginUrl` is an HTTPS authorize endpoint with no query, fragment, or userinfo.
- [ ] Optional icon uses an allowed data URI format and size.

Login host:

- [ ] `/.well-known/cpx-gateway` returns valid JSON.
- [ ] authorize accepts `http://127.0.0.1:<random-port>/callback`.
- [ ] successful login redirects with `code` and original `state`.
- [ ] code is one-time and TTL <= 60 seconds.
- [ ] code stores `redirect_uri`, `client_id`, and `code_challenge`.

Gateway:

- [ ] `gateway` is a public HTTPS origin.
- [ ] endpoint paths are relative and contain no backslash, query, or fragment.
- [ ] `/enroll` verifies PKCE, code, redirect URI, and client ID.
- [ ] `/challenge` issues 32-byte standard-base64 nonce values with short TTL and pool limits.
- [ ] `/config` verifies nonce, clock skew, signature, consumes nonce, and returns Clash YAML.
- [ ] `/revoke` verifies with `op=2`, consumes nonce, and idempotently unbinds the device.
- [ ] account/device revocation returns `{"error":"revoked"}` or `{"error":"device_revoked"}`.
- [ ] gateway retirement returns HTTP `410` or `{"error":"gateway_retired"}`.

Compatibility:

- [ ] `devicePubKey`, `sig`, and `nonce` use standard base64 with padding.
- [ ] PKCE uses base64url without padding.
- [ ] sign input uses raw nonce bytes, not the base64 string.
- [ ] `ts` is encoded as uint64 big-endian.
- [ ] implementation passes `sign-vectors.json`.

---

## 16. Logging

Do not log:

- authorize `code`
- `code_verifier`
- nonce or nonceId
- user password or raw login form
- subscription URL, origin token, or full Clash YAML

Safe operational fields include `user_id`, `deviceId`, endpoint name, status code, duration, and gateway version.
