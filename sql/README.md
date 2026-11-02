# SQL files — tamang pagkakasunod

Patakbuhin sa **Supabase > SQL Editor**, isang beses lang, sunod-sunod:

1. `setup.sql` — ang base ng database (kailangan muna bago lahat)
2. `admin-upgrade.sql` — tools ng Maintenance Center
3. `admin-user.sql` — idagdag ang sarili mong admin account
4. `profile-upgrade.sql` — profile, stats, page designs
5. `safety-upgrade.sql` — safety center, blocking, reports
6. `card-share-upgrade.sql` — shared card designs (mabilis na Browse)
7. `premium-upgrade.sql` — Premium + trial *(opsyonal, kung gagamitin)*
8. `chat-pause.sql` — pause ng Support chat *(opsyonal)*
9. `reply-upgrade.sql` — anonymous replies: sagot ang nagpadala sa'yo ng private song, papunta sa Inbox nila *(recommended)*

## Diagnosis / pag-aayos
- `check-card.sql` — tseke kung kumpleto ang card design setup (print ng OK o MISSING)
- `check-login.sql` — tseke ang login/RLS problems

## Mga one-time fix (luma, hindi na kailangan sa bagong install)
- `fix-300.sql`, `fix-login.sql` — mga patch na ginamit noon

> Note: may mga nauna nang split files dito (`safety-upgrade-01..04`) — ginawa iyon noon para sa mga limitasyon ng SQL Editor. Ang buong `safety-upgrade.sql` ang gamitin kung sariwang install.
