# receiptkit

JavaScript SDK for [ReceiptKit](https://www.receiptkit.io) — print receipts from any web or Node.js application.

## Installation

```bash
npm install receiptkit
```

## Quick start

### HTTP (recommended — works everywhere)

```ts
import { ReceiptKitSession } from "receiptkit/http";

const session = new ReceiptKitSession({
  apiKey: "rk_pub_...",   // use rk_pub_ for browser/client-side code
  orgId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",   // UUID from your dashboard
  templateId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",  // UUID from your dashboard
  printerEndpoint: "tcp:00:11:22:33:44:55",
});

const result = await session.print({
  data: { order: { total: "$12.99", items: [...] } },
  drawer: "NONE",  // "START" to kick open a cash drawer
});

console.log(result.status); // "success"
```

### MQTT (low-latency, browser WebSocket)

```ts
import { ReceiptKitSession } from "receiptkit/mqtt";

const session = new ReceiptKitSession({
  apiKey: "rk_pub_...",   // use rk_pub_ for browser/client-side code
  orgId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",   // UUID from your dashboard
  templateId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",  // UUID from your dashboard
  printerEndpoint: "tcp:00:11:22:33:44:55",
});

await session.connect();

const result = await session.print({
  data: { order: { total: "$12.99" } },
  drawer: "NONE",  // "START" to kick open a cash drawer
});
```

### React

```tsx
import { ReceiptKitProvider, useReceiptKit } from "receiptkit/react";

// Wrap your app
<ReceiptKitProvider config={{ apiKey: "rk_pub_...", orgId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" }}>
  <App />
</ReceiptKitProvider>

// Use in components
const { client } = useReceiptKit();
```

### Next.js / server-side

```ts
import { serverPrintAndWait } from "receiptkit/server";

const result = await serverPrintAndWait(
  {
    apiKey: process.env.RECEIPTKIT_SECRET_KEY!,  // rk_live_ key — server-side only, never in the browser
    orgId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",  // UUID from your dashboard
  },
  {
    bridgeId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    printerEndpoint: "tcp:00:11:22:33:44:55",
    templateId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    data: { order: { total: "$12.99" } },
    drawer: "NONE",  // "START" to kick open a cash drawer
  }
);
```

`printerEndpoint` is the print target. TCP printers use the device MAC address with a `tcp:` prefix, such as `tcp:00:11:22:33:44:55`; `:` and `-` separators are accepted and normalized internally. USB printers use `usb:<stable-serial-or-instance-id>`.

## API key types

| Key prefix | Use case |
|---|---|
| `rk_pub_...` | Browser / client-side — safe to expose in front-end code |
| `rk_live_...` | Server-side only — keep secret, never ship to the browser |

Both keys are available from your [ReceiptKit dashboard](https://www.receiptkit.io/dashboard).

## Subpath exports

| Import | Contents | mqtt dep? |
|---|---|---|
| `receiptkit` | Full client + session | Yes |
| `receiptkit/http` | HTTP-only session | No |
| `receiptkit/mqtt` | MQTT session (explicit) | Yes |
| `receiptkit/react` | React hooks + provider | Yes |
| `receiptkit/server` | Server-side singleton | Yes |

Use `receiptkit/http` in server components, edge functions, or any environment where you want zero MQTT bundle overhead.

## Documentation

Full documentation at [receiptkit.io/docs](https://www.receiptkit.io/docs)

## License

MIT
