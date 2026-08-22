-- ============================================================================
-- 003_fx_rates — INR- and USD-based conversion snapshot
-- ============================================================================
-- ⚠️ THESE ARE APPROXIMATE SNAPSHOT VALUES, not live market rates.
--
-- fx_rates is deliberately keyed by (base, quote, as_of) and never updated in
-- place: a trip budgeted today must still reproduce today's numbers in six
-- months. Refreshing means INSERTing a new as_of, not overwriting these rows.
--
-- Both directions are generated for every pair so conversion is a plain lookup
-- with no division branch in application code.
-- ============================================================================

-- INR per unit of the quoted currency, as of the snapshot date.
WITH snapshot(as_of) AS (VALUES ('2026-08-01'::date)),
per_inr(code, inr_value) AS (VALUES
  ('INR', 1.0),
  -- reserve
  ('USD', 87.40),   ('EUR', 95.10),   ('GBP', 111.60),  ('CHF', 101.80),
  ('JPY', 0.5820),  ('CNY', 12.05),
  -- Asia-Pacific
  ('SGD', 65.20),   ('HKD', 11.18),   ('KRW', 0.0631),  ('THB', 2.44),
  ('MYR', 19.65),   ('IDR', 0.00538), ('PHP', 1.512),   ('VND', 0.003420),
  ('TWD', 2.71),    ('AUD', 57.30),   ('NZD', 52.40),
  -- South Asia
  ('LKR', 0.2910),  ('NPR', 0.6250),  ('BTN', 1.0),     ('BDT', 0.7180),
  ('PKR', 0.3120),  ('MVR', 5.670),
  -- Middle East
  ('AED', 23.79),   ('SAR', 23.30),   ('QAR', 24.01),   ('KWD', 285.20),
  ('BHD', 231.90),  ('OMR', 227.10),  ('ILS', 23.85),   ('TRY', 2.145),
  -- Europe
  ('NOK', 8.42),    ('SEK', 8.31),    ('DKK', 12.75),   ('ISK', 0.6340),
  ('PLN', 22.35),   ('CZK', 3.845),   ('HUF', 0.2405),  ('RON', 19.12),
  ('BGN', 48.62),   ('RSD', 0.8115),  ('UAH', 2.098),   ('GEL', 32.40),
  -- Americas
  ('CAD', 63.10),   ('MXN', 4.620),   ('BRL', 15.85),   ('ARS', 0.0625),
  ('CLP', 0.0912),  ('COP', 0.02135), ('PEN', 23.45),
  -- Africa
  ('ZAR', 4.880),   ('EGP', 1.792),   ('MAD', 8.905),   ('KES', 0.6760),
  ('TZS', 0.03285), ('NGN', 0.05720), ('MUR', 1.912)
)
INSERT INTO fx_rates (base_code, quote_code, rate, as_of)
SELECT b.code, q.code,
       -- rate = how many units of `quote` one unit of `base` buys
       ROUND((b.inr_value / q.inr_value)::numeric, 8),
       s.as_of
  FROM per_inr b
 CROSS JOIN per_inr q
 CROSS JOIN snapshot s
 WHERE b.code <> q.code
   -- Full cross product is 57*56 = 3,192 rows and every pair is a direct
   -- lookup. Restrict to pairs anchored on INR or USD: those are the only
   -- bases a trip is actually budgeted in, and it keeps the table honest.
   AND (b.code IN ('INR','USD') OR q.code IN ('INR','USD'))
ON CONFLICT (base_code, quote_code, as_of) DO UPDATE
  SET rate = EXCLUDED.rate;
