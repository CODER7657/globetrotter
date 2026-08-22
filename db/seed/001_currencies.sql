-- ============================================================================
-- 001_currencies — ISO 4217 reference data
-- ============================================================================
-- minor_units is NOT cosmetic. JPY and KRW have 0 decimal places; BHD, KWD,
-- OMR and TND have 3. Rendering ¥1,200 as "¥1,200.00" or formatting a Kuwaiti
-- dinar to 2 places is a real correctness bug, and the UI reads this column
-- rather than assuming 2 everywhere.
--
-- INR is first-class: the product supports domestic Indian itineraries and
-- international ones with equal weight, so INR appears both as a base currency
-- for planning and as a quote currency for every other pair.
-- ============================================================================

INSERT INTO currencies (code, name, symbol, minor_units) VALUES
  -- ── India and South Asia ────────────────────────────────────────────────
  ('INR', 'Indian Rupee',            '₹',    2),
  ('LKR', 'Sri Lankan Rupee',        'Rs',   2),
  ('NPR', 'Nepalese Rupee',          'Rs',   2),
  ('BTN', 'Bhutanese Ngultrum',      'Nu.',  2),
  ('BDT', 'Bangladeshi Taka',        '৳',    2),
  ('PKR', 'Pakistani Rupee',         'Rs',   2),
  ('MVR', 'Maldivian Rufiyaa',       'Rf',   2),
  -- ── Major reserve ───────────────────────────────────────────────────────
  ('USD', 'US Dollar',               '$',    2),
  ('EUR', 'Euro',                    '€',    2),
  ('GBP', 'Pound Sterling',          '£',    2),
  ('JPY', 'Japanese Yen',            '¥',    0),  -- zero decimals
  ('CHF', 'Swiss Franc',             'CHF',  2),
  ('CNY', 'Chinese Yuan',            '¥',    2),
  -- ── Asia-Pacific ────────────────────────────────────────────────────────
  ('SGD', 'Singapore Dollar',        'S$',   2),
  ('HKD', 'Hong Kong Dollar',        'HK$',  2),
  ('KRW', 'South Korean Won',        '₩',    0),  -- zero decimals
  ('THB', 'Thai Baht',               '฿',    2),
  ('MYR', 'Malaysian Ringgit',       'RM',   2),
  ('IDR', 'Indonesian Rupiah',       'Rp',   2),
  ('PHP', 'Philippine Peso',         '₱',    2),
  ('VND', 'Vietnamese Dong',         '₫',    0),  -- zero decimals
  ('TWD', 'New Taiwan Dollar',       'NT$',  2),
  ('AUD', 'Australian Dollar',       'A$',   2),
  ('NZD', 'New Zealand Dollar',      'NZ$',  2),
  -- ── Middle East ─────────────────────────────────────────────────────────
  ('AED', 'UAE Dirham',              'د.إ',  2),
  ('SAR', 'Saudi Riyal',             '﷼',    2),
  ('QAR', 'Qatari Riyal',            'ر.ق',  2),
  ('KWD', 'Kuwaiti Dinar',           'د.ك',  3),  -- three decimals
  ('BHD', 'Bahraini Dinar',          '.د.ب', 3),  -- three decimals
  ('OMR', 'Omani Rial',              'ر.ع.', 3),  -- three decimals
  ('ILS', 'Israeli New Shekel',      '₪',    2),
  ('TRY', 'Turkish Lira',            '₺',    2),
  -- ── Europe (non-euro) ───────────────────────────────────────────────────
  ('NOK', 'Norwegian Krone',         'kr',   2),
  ('SEK', 'Swedish Krona',           'kr',   2),
  ('DKK', 'Danish Krone',            'kr',   2),
  ('ISK', 'Icelandic Krona',         'kr',   0),  -- zero decimals
  ('PLN', 'Polish Zloty',            'zł',   2),
  ('CZK', 'Czech Koruna',            'Kč',   2),
  ('HUF', 'Hungarian Forint',        'Ft',   2),
  ('RON', 'Romanian Leu',            'lei',  2),
  ('BGN', 'Bulgarian Lev',           'лв',   2),
  ('RSD', 'Serbian Dinar',           'дин',  2),
  ('UAH', 'Ukrainian Hryvnia',       '₴',    2),
  ('GEL', 'Georgian Lari',           '₾',    2),
  -- ── Americas ────────────────────────────────────────────────────────────
  ('CAD', 'Canadian Dollar',         'C$',   2),
  ('MXN', 'Mexican Peso',            'Mex$', 2),
  ('BRL', 'Brazilian Real',          'R$',   2),
  ('ARS', 'Argentine Peso',          '$',    2),
  ('CLP', 'Chilean Peso',            '$',    0),  -- zero decimals
  ('COP', 'Colombian Peso',          '$',    2),
  ('PEN', 'Peruvian Sol',            'S/',   2),
  -- ── Africa ──────────────────────────────────────────────────────────────
  ('ZAR', 'South African Rand',      'R',    2),
  ('EGP', 'Egyptian Pound',          'E£',   2),
  ('MAD', 'Moroccan Dirham',         'د.م.', 2),
  ('KES', 'Kenyan Shilling',         'KSh',  2),
  ('TZS', 'Tanzanian Shilling',      'TSh',  2),
  ('NGN', 'Nigerian Naira',          '₦',    2),
  ('MUR', 'Mauritian Rupee',         '₨',    2)
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      symbol = EXCLUDED.symbol,
      minor_units = EXCLUDED.minor_units;
