# healarr

Self-hosted health tracker with API access.

## Auth

Pass session token as a cookie:

```
curl --cookie "healarr_session=<token>" https://...
```

## Features

- Daily mood + sleep logging.
- Custom metrics via API.
- Bearer-token API auth (dashboard issues tokens at `/settings/tokens`).
