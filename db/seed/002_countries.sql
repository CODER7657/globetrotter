-- ============================================================================
-- 002_countries — ISO 3166-1 alpha-2, scoped to destinations we carry cities for
-- ============================================================================
-- visa_note is written from the perspective of an Indian passport holder,
-- because that is who this build is for. It is advisory copy shown in the UI,
-- never a rule the planner enforces — visa policy changes faster than a seed
-- file and we do not want a stale row blocking someone's itinerary.
-- ============================================================================

INSERT INTO countries (code, name, region, currency_code, visa_note) VALUES
  -- ── India and neighbours ────────────────────────────────────────────────
  ('IN', 'India',              'South Asia',    'INR', 'Domestic travel. No visa required.'),
  ('NP', 'Nepal',              'South Asia',    'NPR', 'Visa-free for Indian citizens.'),
  ('BT', 'Bhutan',             'South Asia',    'BTN', 'Entry permit on arrival for Indian citizens.'),
  ('LK', 'Sri Lanka',          'South Asia',    'LKR', 'ETA required; free for Indian citizens.'),
  ('MV', 'Maldives',           'South Asia',    'MVR', 'Visa on arrival, 30 days.'),
  ('BD', 'Bangladesh',         'South Asia',    'BDT', 'Visa required in advance.'),
  -- ── Southeast and East Asia ─────────────────────────────────────────────
  ('TH', 'Thailand',           'Southeast Asia','THB', 'Visa exemption for Indian citizens, 60 days.'),
  ('SG', 'Singapore',          'Southeast Asia','SGD', 'e-Visa required in advance.'),
  ('MY', 'Malaysia',           'Southeast Asia','MYR', 'Visa-free entry for Indian citizens, 30 days.'),
  ('ID', 'Indonesia',          'Southeast Asia','IDR', 'Visa on arrival, 30 days.'),
  ('VN', 'Vietnam',            'Southeast Asia','VND', 'e-Visa required in advance.'),
  ('PH', 'Philippines',        'Southeast Asia','PHP', 'Visa required in advance.'),
  ('JP', 'Japan',              'East Asia',     'JPY', 'Visa required; e-Visa available for Indian citizens.'),
  ('KR', 'South Korea',        'East Asia',     'KRW', 'Visa required in advance.'),
  ('CN', 'China',              'East Asia',     'CNY', 'Visa required in advance.'),
  ('HK', 'Hong Kong SAR',      'East Asia',     'HKD', 'Pre-arrival registration for Indian citizens.'),
  ('TW', 'Taiwan',             'East Asia',     'TWD', 'Travel authorisation certificate available.'),
  -- ── Middle East ─────────────────────────────────────────────────────────
  ('AE', 'United Arab Emirates','Middle East',  'AED', 'Visa on arrival for Indian citizens with valid US/UK/EU visa.'),
  ('SA', 'Saudi Arabia',       'Middle East',   'SAR', 'e-Visa available.'),
  ('QA', 'Qatar',              'Middle East',   'QAR', 'Visa on arrival for Indian citizens, 30 days.'),
  ('OM', 'Oman',               'Middle East',   'OMR', 'e-Visa required.'),
  ('BH', 'Bahrain',            'Middle East',   'BHD', 'e-Visa available.'),
  ('KW', 'Kuwait',             'Middle East',   'KWD', 'Visa required in advance.'),
  ('IL', 'Israel',             'Middle East',   'ILS', 'Visa required in advance.'),
  ('TR', 'Turkey',             'Middle East',   'TRY', 'e-Visa available for Indian citizens.'),
  -- ── Europe ──────────────────────────────────────────────────────────────
  ('GB', 'United Kingdom',     'Europe',        'GBP', 'Standard Visitor visa required.'),
  ('FR', 'France',             'Europe',        'EUR', 'Schengen visa required.'),
  ('DE', 'Germany',            'Europe',        'EUR', 'Schengen visa required.'),
  ('IT', 'Italy',              'Europe',        'EUR', 'Schengen visa required.'),
  ('ES', 'Spain',              'Europe',        'EUR', 'Schengen visa required.'),
  ('PT', 'Portugal',           'Europe',        'EUR', 'Schengen visa required.'),
  ('NL', 'Netherlands',        'Europe',        'EUR', 'Schengen visa required.'),
  ('BE', 'Belgium',            'Europe',        'EUR', 'Schengen visa required.'),
  ('AT', 'Austria',            'Europe',        'EUR', 'Schengen visa required.'),
  ('CH', 'Switzerland',        'Europe',        'CHF', 'Schengen visa required.'),
  ('GR', 'Greece',             'Europe',        'EUR', 'Schengen visa required.'),
  ('IE', 'Ireland',            'Europe',        'EUR', 'Irish visa required (separate from Schengen).'),
  ('NO', 'Norway',             'Europe',        'NOK', 'Schengen visa required.'),
  ('SE', 'Sweden',             'Europe',        'SEK', 'Schengen visa required.'),
  ('DK', 'Denmark',            'Europe',        'DKK', 'Schengen visa required.'),
  ('FI', 'Finland',            'Europe',        'EUR', 'Schengen visa required.'),
  ('IS', 'Iceland',            'Europe',        'ISK', 'Schengen visa required.'),
  ('PL', 'Poland',             'Europe',        'PLN', 'Schengen visa required.'),
  ('CZ', 'Czechia',            'Europe',        'CZK', 'Schengen visa required.'),
  ('HU', 'Hungary',            'Europe',        'HUF', 'Schengen visa required.'),
  ('HR', 'Croatia',            'Europe',        'EUR', 'Schengen visa required.'),
  ('RO', 'Romania',            'Europe',        'RON', 'Schengen visa required.'),
  ('RS', 'Serbia',             'Europe',        'RSD', 'Visa-free for Indian citizens, 30 days.'),
  ('GE', 'Georgia',            'Europe',        'GEL', 'e-Visa available.'),
  -- ── Americas ────────────────────────────────────────────────────────────
  ('US', 'United States',      'North America', 'USD', 'B1/B2 visitor visa required.'),
  ('CA', 'Canada',             'North America', 'CAD', 'Visitor visa or eTA required.'),
  ('MX', 'Mexico',             'North America', 'MXN', 'Visa-free with a valid US visa.'),
  ('BR', 'Brazil',             'South America', 'BRL', 'e-Visa required.'),
  ('AR', 'Argentina',          'South America', 'ARS', 'Visa required in advance.'),
  ('CL', 'Chile',              'South America', 'CLP', 'Visa required in advance.'),
  ('CO', 'Colombia',           'South America', 'COP', 'Visa-free with a valid US/Schengen visa.'),
  ('PE', 'Peru',               'South America', 'PEN', 'Visa required in advance.'),
  -- ── Africa and Oceania ──────────────────────────────────────────────────
  ('ZA', 'South Africa',       'Africa',        'ZAR', 'Visa required in advance.'),
  ('EG', 'Egypt',              'Africa',        'EGP', 'Visa on arrival for eligible Indian travellers.'),
  ('MA', 'Morocco',            'Africa',        'MAD', 'Visa required in advance.'),
  ('KE', 'Kenya',              'Africa',        'KES', 'Electronic travel authorisation required.'),
  ('TZ', 'Tanzania',           'Africa',        'TZS', 'Visa on arrival available.'),
  ('MU', 'Mauritius',          'Africa',        'MUR', 'Visa on arrival for Indian citizens, 90 days.'),
  ('AU', 'Australia',          'Oceania',       'AUD', 'Visitor visa required.'),
  ('NZ', 'New Zealand',        'Oceania',       'NZD', 'Visitor visa required.')
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      region = EXCLUDED.region,
      currency_code = EXCLUDED.currency_code,
      visa_note = EXCLUDED.visa_note;
