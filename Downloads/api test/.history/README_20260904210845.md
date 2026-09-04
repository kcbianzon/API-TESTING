# API Scout

A universal API tester that runs requests through a local Node.js proxy, avoiding browser CORS false negatives. It reports reachability, status, latency, headers, response body, and likely causes for common failures.

## Run

Requires Node.js 18 or newer.

```powershell
npm start
```

Open http://localhost:4173.

Enter a complete `http://` or `https://` URL. Query parameters and headers use JSON objects, for example `{ "page": 2 }` or `{ "Authorization": "Bearer token" }`.
