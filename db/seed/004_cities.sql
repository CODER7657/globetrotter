-- ============================================================================
-- 004_cities — destinations, India-first then international
-- ============================================================================
-- best_months drives the "when to go" chip and the seasonal search signal.
-- cost indices are per-city and versioned in city_cost_index, in that city's
-- own currency — converting at read time is the cost engine's job, not the
-- seed's.
-- ============================================================================

INSERT INTO cities (country_code, name, slug, admin_area, latitude, longitude, timezone, population, popularity, summary, best_months) VALUES
  -- ── India ───────────────────────────────────────────────────────────────
  ('IN','Mumbai','mumbai','Maharashtra',19.07600,72.87770,'Asia/Kolkata',20400000,94,'India''s financial capital: Art Deco seafront, Bollywood, and the best street food on the west coast.','{11,12,1,2}'),
  ('IN','New Delhi','new-delhi','Delhi',28.61390,77.20900,'Asia/Kolkata',32900000,93,'Mughal monuments, sprawling bazaars and the gateway to the Golden Triangle.','{10,11,2,3}'),
  ('IN','Jaipur','jaipur','Rajasthan',26.91240,75.78730,'Asia/Kolkata',3900000,88,'The Pink City: hilltop forts, mirrored palaces and Rajasthani craft markets.','{10,11,12,1,2}'),
  ('IN','Udaipur','udaipur','Rajasthan',24.57110,73.69130,'Asia/Kolkata',450000,85,'Lake palaces and narrow hill lanes; the most romantic city in Rajasthan.','{9,10,11,2,3}'),
  ('IN','Jodhpur','jodhpur','Rajasthan',26.23890,73.02430,'Asia/Kolkata',1100000,79,'The Blue City beneath the vast Mehrangarh Fort.','{10,11,12,1,2}'),
  ('IN','Agra','agra','Uttar Pradesh',27.17670,78.00810,'Asia/Kolkata',1600000,90,'The Taj Mahal at sunrise, plus a red sandstone fort most visitors skip.','{10,11,12,1,2}'),
  ('IN','Varanasi','varanasi','Uttar Pradesh',25.31760,82.97390,'Asia/Kolkata',1200000,84,'Ghats, dawn boat rides and evening aarti on the Ganges.','{10,11,12,1,2,3}'),
  ('IN','Goa','goa','Goa',15.29930,74.12400,'Asia/Kolkata',1500000,91,'Portuguese churches, spice plantations and beaches from party to near-empty.','{11,12,1,2}'),
  ('IN','Bengaluru','bengaluru','Karnataka',12.97160,77.59460,'Asia/Kolkata',13600000,80,'Garden city turned tech capital: craft beer, bookshops and a mild climate all year.','{1,2,9,10,11,12}'),
  ('IN','Hampi','hampi','Karnataka',15.33500,76.46000,'Asia/Kolkata',35000,72,'Boulder-strewn ruins of the Vijayanagara empire, spread over 4,000 hectares.','{11,12,1,2}'),
  ('IN','Kochi','kochi','Kerala',9.93120,76.26730,'Asia/Kolkata',2100000,78,'Chinese fishing nets, colonial godowns and the start of the Kerala backwaters.','{11,12,1,2,3}'),
  ('IN','Alleppey','alleppey','Kerala',9.49810,76.33880,'Asia/Kolkata',175000,75,'Houseboats on the backwaters; slow travel at its most literal.','{11,12,1,2}'),
  ('IN','Munnar','munnar','Kerala',10.08890,77.05950,'Asia/Kolkata',68000,71,'Tea estates layered across the Western Ghats, cool even in summer.','{9,10,11,12,1}'),
  ('IN','Rishikesh','rishikesh','Uttarakhand',30.08690,78.26760,'Asia/Kolkata',102000,76,'Yoga ashrams, Ganges rafting and the foothills of the Himalaya.','{9,10,11,3,4}'),
  ('IN','Manali','manali','Himachal Pradesh',32.23960,77.18870,'Asia/Kolkata',37000,77,'Mountain town for trekking in summer and snow in winter.','{3,4,5,6,10}'),
  ('IN','Leh','leh','Ladakh',34.16420,77.58480,'Asia/Kolkata',31000,74,'High-altitude desert, monasteries and the road to Pangong Tso.','{6,7,8,9}'),
  ('IN','Darjeeling','darjeeling','West Bengal',27.03600,88.26270,'Asia/Kolkata',120000,70,'Tea gardens, the toy train and Kanchenjunga at dawn.','{3,4,5,10,11}'),
  ('IN','Amritsar','amritsar','Punjab',31.63400,74.87230,'Asia/Kolkata',1200000,73,'The Golden Temple, the world''s largest free kitchen, and the Wagah border.','{10,11,12,2,3}'),
  ('IN','Ahmedabad','ahmedabad','Gujarat',23.02250,72.57140,'Asia/Kolkata',8400000,66,'UNESCO-listed old city, stepwells and the best Gujarati thali anywhere.','{11,12,1,2}'),
  ('IN','Chennai','chennai','Tamil Nadu',13.08270,80.27070,'Asia/Kolkata',11500000,68,'Carnatic music, Marina Beach and gateway to the Tamil temple trail.','{12,1,2}'),
  -- ── Asia ────────────────────────────────────────────────────────────────
  ('LK','Colombo','colombo',NULL,6.92710,79.86120,'Asia/Colombo',750000,64,'Colonial arcades and a fast-changing seafront.','{1,2,3,11,12}'),
  ('LK','Kandy','kandy',NULL,7.29060,80.63370,'Asia/Colombo',125000,68,'Hill capital around a lake, home to the Temple of the Tooth.','{1,2,3,4}'),
  ('NP','Kathmandu','kathmandu',NULL,27.71720,85.32400,'Asia/Kathmandu',1500000,79,'Durbar squares, stupas and the staging post for Himalayan treks.','{10,11,3,4}'),
  ('MV','Male','male',NULL,4.17550,73.50930,'Indian/Maldives',215000,80,'Atoll capital and transfer hub for the resort islands.','{11,12,1,2,3}'),
  ('TH','Bangkok','bangkok',NULL,13.75630,100.50180,'Asia/Bangkok',10700000,92,'Temples, canals and the best street food in Southeast Asia.','{11,12,1,2}'),
  ('TH','Chiang Mai','chiang-mai',NULL,18.78830,98.98530,'Asia/Bangkok',1200000,83,'Walled old city, mountain temples and a serious coffee scene.','{11,12,1,2}'),
  ('SG','Singapore','singapore',NULL,1.35210,103.81980,'Asia/Singapore',5900000,89,'Hawker centres, rooftop gardens and the tidiest transit on earth.','{2,3,4,7,8}'),
  ('ID','Bali','bali','Bali',-8.34050,115.09200,'Asia/Makassar',4300000,90,'Rice terraces, surf breaks and temple cliffs.','{4,5,6,9,10}'),
  ('VN','Hanoi','hanoi',NULL,21.02780,105.83420,'Asia/Ho_Chi_Minh',8100000,82,'Old Quarter chaos, lakeside calm and the country''s best pho.','{10,11,3,4}'),
  ('JP','Tokyo','tokyo',NULL,35.67620,139.65030,'Asia/Tokyo',37000000,96,'Every scale of city at once, from alley izakaya to the world''s busiest crossing.','{3,4,10,11}'),
  ('JP','Kyoto','kyoto',NULL,35.01160,135.76810,'Asia/Tokyo',1460000,94,'Two thousand temples, geisha districts and the bamboo grove.','{3,4,10,11}'),
  ('AE','Dubai','dubai',NULL,25.20480,55.27080,'Asia/Dubai',3600000,86,'Desert megacity: the tallest building on earth and a persistent old-town souk.','{11,12,1,2,3}'),
  -- ── Europe ──────────────────────────────────────────────────────────────
  ('FR','Paris','paris','Île-de-France',48.85660,2.35220,'Europe/Paris',11100000,98,'The reference point for every other city break.','{4,5,6,9,10}'),
  ('IT','Rome','rome','Lazio',41.90280,12.49640,'Europe/Rome',4300000,95,'Two thousand years stacked on top of each other, still lived in.','{4,5,9,10}'),
  ('IT','Venice','venice','Veneto',45.44080,12.31550,'Europe/Rome',260000,90,'A city with no cars, sinking beautifully.','{4,5,9,10}'),
  ('IT','Florence','florence','Tuscany',43.76960,11.25580,'Europe/Rome',380000,88,'Renaissance density: the Uffizi, the Duomo, and Tuscany at the gates.','{4,5,9,10}'),
  ('ES','Barcelona','barcelona','Catalonia',41.38510,2.17340,'Europe/Madrid',5600000,93,'Gaudí, a working beach and the best late dinner culture in Europe.','{5,6,9,10}'),
  ('ES','Madrid','madrid','Madrid',40.41680,-3.70380,'Europe/Madrid',6700000,86,'World-class galleries and a city that genuinely does not sleep.','{4,5,9,10}'),
  ('PT','Lisbon','lisbon',NULL,38.72230,-9.13930,'Europe/Lisbon',2900000,87,'Tiled hills, trams and Atlantic light.','{3,4,5,9,10}'),
  ('GB','London','london','England',51.50740,-0.12780,'Europe/London',9600000,95,'Free world-class museums and a different neighbourhood every mile.','{5,6,7,9}'),
  ('GB','Edinburgh','edinburgh','Scotland',55.95330,-3.18830,'Europe/London',540000,81,'Volcanic castle rock, medieval closes and August festival mania.','{5,6,8,9}'),
  ('NL','Amsterdam','amsterdam','North Holland',52.37280,4.89360,'Europe/Amsterdam',920000,89,'Canal rings, Golden Age painting and bicycles as infrastructure.','{4,5,6,9}'),
  ('CZ','Prague','prague',NULL,50.07550,14.43780,'Europe/Prague',1300000,88,'Gothic spires largely untouched by the twentieth century.','{4,5,9,10}'),
  ('AT','Vienna','vienna',NULL,48.20820,16.37380,'Europe/Vienna',1900000,83,'Imperial palaces, coffee houses and the world''s most liveable city, repeatedly.','{4,5,9,10}'),
  ('CH','Zurich','zurich',NULL,47.37690,8.54170,'Europe/Zurich',430000,74,'Lakeside old town and the fastest access to the Alps.','{6,7,8,9}'),
  ('GR','Athens','athens','Attica',37.98380,23.72750,'Europe/Athens',3200000,84,'The Acropolis above a genuinely gritty, excellent modern city.','{4,5,9,10}'),
  ('IS','Reykjavik','reykjavik',NULL,64.14660,-21.94260,'Atlantic/Reykjavik',135000,79,'Base camp for volcanoes, glaciers and the aurora.','{6,7,8,2,3}'),
  ('TR','Istanbul','istanbul',NULL,41.00820,28.97840,'Europe/Istanbul',15500000,90,'Two continents, one skyline of domes and minarets.','{4,5,9,10}'),
  -- ── Americas, Africa, Oceania ───────────────────────────────────────────
  ('US','New York','new-york','New York',40.71280,-74.00600,'America/New_York',18800000,96,'The density argument for cities, made once and conclusively.','{4,5,9,10}'),
  ('US','San Francisco','san-francisco','California',37.77490,-122.41940,'America/Los_Angeles',3300000,84,'Fog, hills and the bay; small enough to walk, steep enough not to.','{9,10}'),
  ('CA','Vancouver','vancouver','British Columbia',49.28270,-123.12070,'America/Vancouver',2600000,79,'Mountains meeting ocean at the edge of the city.','{6,7,8,9}'),
  ('MX','Mexico City','mexico-city',NULL,19.43260,-99.13320,'America/Mexico_City',22000000,85,'Aztec ruins under colonial squares, and a food scene without equal.','{3,4,10,11}'),
  ('BR','Rio de Janeiro','rio-de-janeiro',NULL,-22.90680,-43.17290,'America/Sao_Paulo',13500000,86,'Beaches wedged between granite peaks.','{12,1,2,3}'),
  ('PE','Cusco','cusco',NULL,-13.53190,-71.96750,'America/Lima',430000,82,'Inca walls, Spanish arcades and the trailhead for Machu Picchu.','{5,6,7,8,9}'),
  ('EG','Cairo','cairo',NULL,30.04440,31.23570,'Africa/Cairo',21300000,83,'The pyramids, and a medieval Islamic quarter most visitors never reach.','{11,12,1,2,3}'),
  ('MA','Marrakesh','marrakesh',NULL,31.62950,-7.98110,'Africa/Casablanca',1000000,84,'Souks, riad courtyards and the Atlas an hour away.','{3,4,5,10,11}'),
  ('ZA','Cape Town','cape-town','Western Cape',-33.92490,18.42410,'Africa/Johannesburg',4700000,87,'Table Mountain over two oceans and the winelands.','{11,12,1,2,3}'),
  ('KE','Nairobi','nairobi',NULL,-1.28640,36.81720,'Africa/Nairobi',5100000,68,'A capital with a national park inside the city limits.','{1,2,6,7,8,9}'),
  ('AU','Sydney','sydney','New South Wales',-33.86880,151.20930,'Australia/Sydney',5300000,88,'Harbour, headlands and a coastal walk from Bondi to Coogee.','{10,11,3,4}'),
  ('NZ','Queenstown','queenstown','Otago',-45.03120,168.66260,'Pacific/Auckland',48000,80,'Adventure-sport capital wedged against the Remarkables.','{12,1,2,6,7}')
ON CONFLICT (country_code, slug) DO UPDATE
  SET name = EXCLUDED.name, summary = EXCLUDED.summary,
      popularity = EXCLUDED.popularity, best_months = EXCLUDED.best_months;

-- ---------------------------------------------------------- cost indices --
-- Derived from a per-country baseline scaled by the city's popularity, then
-- stored in that city's own currency. Hand-tuning 60 cities would be fake
-- precision; the shape (relative expense) is what the budget screen needs.
INSERT INTO city_cost_index (city_id, currency_code, daily_budget, daily_midrange, daily_luxury, meal_avg, transit_avg, as_of)
SELECT c.id,
       co.currency_code,
       ROUND((base * 0.45)::numeric, 2),
       ROUND((base * 1.00)::numeric, 2),
       ROUND((base * 2.60)::numeric, 2),
       ROUND((base * 0.18)::numeric, 2),
       ROUND((base * 0.07)::numeric, 2),
       DATE '2026-08-01'
  FROM cities c
  JOIN countries co ON co.code = c.country_code
 CROSS JOIN LATERAL (
   SELECT app.fx_convert(
            -- USD-equivalent midrange daily spend, scaled by popularity.
            (35 + (c.popularity - 60) * 1.9)::numeric,
            'USD', co.currency_code, DATE '2026-08-01') AS base
 ) b
 WHERE b.base > 0
ON CONFLICT (city_id, as_of) DO UPDATE
  SET daily_midrange = EXCLUDED.daily_midrange;
