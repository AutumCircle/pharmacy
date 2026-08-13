# Local catalogue agent v1

This replaces the legacy agent's direct large POST with a resumable flow:

1. read and validate the full `OSTATKI.DBF` snapshot;
2. initiate a sync using a dedicated machine identity;
3. upload deterministic gzip JSON to the short-lived S3 URL;
4. commit the sync and save its result locally.

Copy `config.example.json` to `config.json` and fill it only on the pharmacy
computer. Never commit that file. The API key is only for an API Gateway usage
plan; `authorization_token` must be a separate machine credential whose
authorizer context has role `agent_sync`.

Run manually first:

```powershell
python agent_sync.py --config config.json
```

The agent refuses unexpectedly small snapshots. A failed server validation is
not retried automatically, and the local idempotency state prevents accidental
duplicate imports after network failures.

The confirmed legacy DBF has only `NAME`, `PRICE`, `COUNTRY`, and `PROIZVOD`,
so `fields.source_sku` remains `null`. The server uses a normalized composite
identity and records deterministic duplicate merges. It never averages prices.
