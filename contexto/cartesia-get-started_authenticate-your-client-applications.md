> ## Documentation Index
> Fetch the complete documentation index at: https://docs.cartesia.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Authenticate your applications

> Use access tokens in browsers and API keys on servers

The implementation guide on this page shows you how to use [access tokens](https://docs.cartesia.ai/api-reference/auth/access-token.md) in browsers and use [API keys](https://play.cartesia.ai/keys) on trusted servers.

| Environment | Recommended auth | Why |
| - | - | - |
| Browser app | Access token | Keeps your API key out of client code |
| Trusted server, script, or notebook | API key | Simpler and does not require token exchange |

## Server-side apps: use API keys

Use your API key directly from trusted environments such as backend services, jobs, local scripts, and notebooks.

Cartesia accepts both `X-Api-Key` and `Authorization` headers for server-side authentication. Header names are case-insensitive, so `X-API-KEY` and `authorization` work too.

```typescript theme={null}
const ws = new WebSocket("wss://api.cartesia.ai/tts/websocket", {
  headers: {
    // "X-Api-Key": CARTESIA_API_KEY,
    // OR
    // "Authorization": `Bearer ${CARTESIA_API_KEY}`,
  },
});
```

The header-based WebSocket example above is for server-side clients that support custom headers. In browsers, use an access token and query parameters instead.

## Browser apps: use access tokens

Never ship a Cartesia API key in browser code. A user can extract it and make requests on your account.

Instead, generate a short-lived access token on your server and return that token to the browser.

## Prerequisites

Before implementing Access Tokens:

1. Configure your server with a Cartesia API key
2. Implement user authentication in your application
3. Establish secure client-server communication

### Available Grants

Access Tokens support granular permissions through grants. Both TTS and STT grants are optional:

**TTS Grant**: With `grants: { tts: true }`, clients have access to:

* `/tts/bytes` - Synchronous TTS generation streamed with chunked encoding
* `/tts/sse` - Server-sent events for streaming
* `/tts/websocket` - WebSocket-based streaming

**STT Grant**: With `grants: { stt: true }`, clients have access to:

* `/stt/websocket` - WebSocket-based speech-to-text streaming
* `/stt` - Batch speech-to-text processing
* `/audio/transcriptions` - OpenAI-compatible transcription endpoint

**Agents Grant**: With `grants: { agent: true }`, clients have access to:

* the Agents WebSocket calling endpoint

You can request one or more grants in a single token:

```json theme={null}
grants: { tts: true, stt: true, agent: false }
```

## Implementation Guide

### 1. Token Generation (Server-side)

Make a request to generate a new access token using cURL or the official client libraries:

```bash cURL lines theme={null}
# TTS and STT access
curl --location 'https://api.cartesia.ai/access-token' \
  -H 'Cartesia-Version: 2026-08-14' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer sk_car_...' \
  -d '{ "grants": {"tts": true, "stt": true}, "expires_in": 60}'
```

```javascript JavaScript lines theme={null}
import Cartesia from "@cartesia/cartesia-js";

const client = new Cartesia({ apiKey: "YOUR_API_KEY" });

// TTS and STT access
await client.accessToken.create({
  grants: {
    tts: true,
    stt: true
  },
  expires_in: 60
});
```

```python Python lines theme={null}
from cartesia import Cartesia

client = Cartesia(
  api_key="YOUR_API_KEY"
)

# TTS and STT access
response = client.access_token.create(
  grants={"tts": True, "stt": True}, # Grant both permissions
  expires_in=60 # Token expires in 60 seconds
)

# The response will contain the access token
print(f"Access Token: {response.token}")
```

```typescript JavaScript (fetch) lines theme={null}
// TTS and STT access
const response = await fetch("https://api.cartesia.ai/access-token", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Cartesia-Version": "2026-08-14",
    Authorization: "Bearer <your_api_key>",
  },
  body: JSON.stringify({
    grants: { tts: true, stt: true },
    expires_in: 60, // 1 minute
  }),
});

const { token } = await response.json();
```

For detailed API specifications, see the [Token API Reference](https://docs.cartesia.ai/api-reference/auth/access-token.md).

### 2. Token Storage (Client-side)

Store the token securely, such as setting an HTTP-only cookie with a matching token expiration. The cookie should be `httpOnly`, `secure`, and `sameSite: "strict"`.

### 3. Making Authenticated Requests Using the API

```typescript lines theme={null}
// Using TTS with access token
const ttsResponse = await fetch("https://api.cartesia.ai/tts/bytes", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  },
  // ... request configuration
});

// Using STT with access token
const sttResponse = await fetch("https://api.cartesia.ai/stt", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${accessToken}`,
  },
  body: formData, // multipart/form-data with audio file
});
```

```typescript lines theme={null}
// Browser WebSocket (access token in query param)
const url = new URL("wss://api.cartesia.ai/tts/websocket");
url.searchParams.set("cartesia_version", "2026-03-01");
url.searchParams.set("access_token", accessToken);

const ws = new WebSocket(url);
```

### 4. Token Refresh Strategy

Before each API call, check whether the current token is still valid. If it has expired or is about to expire, request a new one from your server before proceeding.

```typescript lines theme={null}
async function getValidToken(): Promise<string> {
  if (!token || tokenExpiresAt < Date.now() + 5000) {
    // Token missing or expiring within 5 s — refresh
    const res = await fetch("/api/token");
    const data = await res.json();
    token = data.token;
    tokenExpiresAt = Date.now() + data.expires_in * 1000;
  }
  return token;
}
```

## Security Best Practices

### Server-side

* Generate tokens server-side only — never in browser code
* Use short token lifetimes (minutes)
* Serve tokens over HTTPS exclusively

### Client-side

* Store tokens in HTTP-only cookies (cookies the browser sends automatically but JavaScript cannot read)
* Enable `secure` and `sameSite: "strict"` cookie flags
* Never store tokens in `localStorage` or `sessionStorage`
* Never log tokens or display them in the UI

## Additional Resources

* [API Reference](https://docs.cartesia.ai/api-reference/auth/access-token.md) - Access Token generation endpoint documentation


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.