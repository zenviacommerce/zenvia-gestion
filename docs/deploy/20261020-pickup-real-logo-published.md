# 2026-10-20 — PR252 real logo review approved / publication

Owner approved real logo sample and authorized PR252 publication, PR251 already live.

## Pre-release verification
PR252 exact head356484fd69e650e8be00dd2e8b65738b11f29bed has all5required CI success (runs39396323391,39396323407,39396323396,39396323452,39396323533). Changes only tests/fixtures/evidence; no src/Auth/Edge/SQL changes. Live pre-release rollback dpl_9zaNiu7w6X9n4mwzUmSbiEk6R6G5, index-D4U9zrKC.js, main f9e8cd8223cb1fe964834b469adf7b1321a87bea.

Confirmed deployed private.mfa_impl_pickup_report_create reads sender fields from public.business_settings WHERE owner_id=private.pickup_report_owner(), the same General configuration. Production values read-only: ZENVIA COMMERCE SL; B26806943; Polígono Industrial La Ventilla, Nave44,11660Prado Del Rey,Cádiz,ES; info@zenviacommerce.com;655154080. Sender snapshot is fixed when issuing report and retained on reprint; logo is loaded from current General via authenticated company-assets download. Sample address/NIF were fixture-only. No production configuration modified and no definitive report created for this confirmation.

PR252 merged using expected head, merge5563a2eb819275c46fd307c33480cd930f35459a. Vercel publication pending. Original PR251 migration remains applied once; do not reapply.
