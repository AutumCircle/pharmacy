# Factory backlog

`/factory next` takes the first unchecked item, runs it through the loop and ticks it off
as `- [x] … → <job-id>`. One feature per line; write it the way you'd brief a developer.

- [ ] Rate-limit order tracking lookups: `/api/tracking` answers HTTP 429 with a Russian message after too many phone lookups from one client, so phone numbers can't be enumerated
- [ ] Rate-limit `/api/checkout` per client so a script can't flood the pharmacy with fake orders; legitimate customers retrying once or twice must still succeed
