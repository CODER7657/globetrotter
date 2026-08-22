-- ============================================================================
-- 005_activities — categories, real headline activities, generated long tail
-- ============================================================================
-- Two tiers on purpose:
--   * Named, real activities for the demo cities. Search has to return
--     "Louvre Museum", not "Museum visit in Paris" — that is the difference
--     between a search box that looks real and one that looks seeded.
--   * A generated long tail everywhere else, so filters, pagination and
--     ranking have enough volume to behave like production.
-- Opening hours are real closures where known (the Louvre really does shut on
-- Tuesdays); that is what the feasibility warnings key off.
-- ============================================================================

INSERT INTO activity_categories (id, slug, label, icon) VALUES
  (1,'sightseeing','Sightseeing','landmark'),
  (2,'food','Food & Drink','utensils'),
  (3,'adventure','Adventure','mountain'),
  (4,'culture','Arts & Culture','palette'),
  (5,'nature','Nature & Outdoors','tree'),
  (6,'nightlife','Nightlife','moon'),
  (7,'shopping','Shopping','shopping-bag'),
  (8,'wellness','Wellness','heart')
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, icon = EXCLUDED.icon;

-- ------------------------------------------------- named, real activities --
INSERT INTO activities (city_id, category_id, name, slug, description, duration_minutes, cost_amount, currency_code, rating, booking_required)
SELECT c.id, v.category_id, v.name, v.slug, v.description, v.duration, v.cost, co.currency_code, v.rating, v.booking
  FROM (VALUES
    -- Agra
    ('agra','IN',1,'Taj Mahal at Sunrise','taj-mahal-sunrise','The marble changes colour with the light; arriving at opening avoids both the heat and the crowds.',180,1300,4.9,true),
    ('agra','IN',1,'Agra Fort','agra-fort','Red sandstone Mughal fortress where Shah Jahan was imprisoned within sight of the Taj.',120,650,4.5,false),
    ('agra','IN',2,'Mughlai Food Walk','agra-food-walk','Petha, bedai and kebabs through the old city lanes with a local guide.',150,900,4.6,true),
    -- Jaipur
    ('jaipur','IN',1,'Amber Fort','amber-fort','Hilltop fort complex with the Sheesh Mahal mirror hall.',180,500,4.7,false),
    ('jaipur','IN',1,'Hawa Mahal','hawa-mahal','The honeycomb facade built so royal women could watch the street unseen.',60,200,4.3,false),
    ('jaipur','IN',7,'Johari Bazaar Textiles','johari-bazaar','Block-printed cotton and silver, with the haggling expected.',120,0,4.2,false),
    -- Mumbai
    ('mumbai','IN',1,'Gateway of India & Colaba','gateway-of-india','Basalt arch on the harbour, then the Art Deco and Victorian Gothic ensemble behind it.',90,0,4.4,false),
    ('mumbai','IN',2,'Mohammed Ali Road Food Crawl','mohammed-ali-road','Seekh kebabs, malpua and phirni; best after sunset.',180,800,4.8,false),
    ('mumbai','IN',4,'Elephanta Caves','elephanta-caves','Rock-cut Shiva temples on an island an hour by ferry. Closed Mondays.',300,1200,4.5,true),
    -- New Delhi
    ('new-delhi','IN',1,'Humayun''s Tomb','humayuns-tomb','The Mughal garden tomb that the Taj Mahal was modelled on.',120,600,4.7,false),
    ('new-delhi','IN',1,'Qutub Minar','qutub-minar','The tallest brick minaret in the world, begun in 1199.',90,600,4.5,false),
    ('new-delhi','IN',2,'Old Delhi Street Food by Rickshaw','old-delhi-food','Paranthe Wali Gali and Chandni Chowk, eaten properly.',210,1100,4.8,true),
    -- Kerala
    ('alleppey','IN',5,'Backwater Houseboat Overnight','backwater-houseboat','A converted rice barge, a cook on board, and no schedule at all.',1080,9500,4.8,true),
    ('munnar','IN',5,'Tea Estate Trek','munnar-tea-trek','Walk the plantation contours to a ridge viewpoint above the mist.',300,1500,4.6,true),
    ('kochi','IN',4,'Kathakali Performance','kochi-kathakali','Arrive early to watch the two hours of makeup before the performance.',150,700,4.4,true),
    -- Goa / Hampi / Varanasi
    ('goa','IN',5,'South Goa Beach Day','south-goa-beaches','Palolem and Agonda, markedly quieter than the north.',360,0,4.5,false),
    ('goa','IN',2,'Spice Plantation & Goan Lunch','goa-spice-plantation','Cardamom and vanilla under the canopy, then a thali on banana leaf.',240,1400,4.4,true),
    ('hampi','IN',1,'Vittala Temple & Stone Chariot','hampi-vittala','Musical pillars and the chariot that is on the fifty-rupee note.',180,600,4.8,false),
    ('varanasi','IN',4,'Dawn Boat Ride on the Ganges','varanasi-dawn-boat','Push off at 05:30 to watch the ghats wake up.',120,800,4.9,true),
    ('varanasi','IN',4,'Ganga Aarti at Dashashwamedh','varanasi-aarti','The evening fire ceremony; arrive an hour early for a seat.',90,0,4.7,false),
    -- Rishikesh / Leh / Amritsar
    ('rishikesh','IN',3,'Ganges White-Water Rafting','rishikesh-rafting','16km of Grade III rapids from Shivpuri.',240,1800,4.7,true),
    ('rishikesh','IN',8,'Sunrise Yoga by the River','rishikesh-yoga','Hatha practice on a ghat platform.',90,600,4.5,true),
    ('leh','IN',5,'Pangong Tso Day Trip','pangong-tso','Five hours each way over Chang La for a lake that changes colour hourly.',720,6500,4.8,true),
    ('amritsar','IN',1,'Golden Temple & Langar','golden-temple','The shrine, then volunteering in the kitchen that feeds 50,000 a day.',180,0,4.9,false),
    -- Paris
    ('paris','FR',4,'Louvre Museum','louvre-museum','Pick three wings and accept you will not see the rest. Closed Tuesdays.',240,22,4.7,true),
    ('paris','FR',1,'Eiffel Tower Summit','eiffel-tower','Book the lift to the top; the second floor has the better view of the tower itself.',150,29,4.6,true),
    ('paris','FR',4,'Musée d''Orsay','musee-orsay','The Impressionist collection, in a converted railway station. Closed Mondays.',180,16,4.8,true),
    ('paris','FR',2,'Le Marais Food Walk','marais-food-walk','Falafel, fromagerie and a patisserie that has been there since 1932.',180,85,4.7,true),
    -- Rome / Venice / Florence
    ('rome','IT',1,'Colosseum & Roman Forum','colosseum','Combined ticket; the Forum is the half most people rush.',210,18,4.8,true),
    ('rome','IT',4,'Vatican Museums & Sistine Chapel','vatican-museums','Book the earliest slot. Closed Sundays except the last of the month.',240,20,4.7,true),
    ('venice','IT',1,'St Mark''s Basilica','st-marks-basilica','Byzantine mosaics; the skip-the-line booking is worth it.',90,15,4.6,true),
    ('florence','IT',4,'Uffizi Gallery','uffizi-gallery','Botticelli and the early Renaissance. Closed Mondays.',210,25,4.8,true),
    -- Barcelona / Lisbon / Amsterdam / Prague
    ('barcelona','ES',1,'Sagrada Família','sagrada-familia','Still unfinished; go late afternoon for the west-facing glass.',120,26,4.8,true),
    ('barcelona','ES',1,'Park Güell','park-guell','Gaudí''s mosaic terrace over the whole city.',120,10,4.5,true),
    ('barcelona','ES',2,'Tapas Crawl in El Born','el-born-tapas','Four bars, one dish each, standing up.',180,60,4.7,true),
    ('lisbon','PT',1,'Tram 28 & Alfama','tram-28-alfama','The full route, then walk back down through the oldest quarter.',180,15,4.4,false),
    ('amsterdam','NL',4,'Van Gogh Museum','van-gogh-museum','Chronological and devastating in the last two rooms.',150,22,4.7,true),
    ('amsterdam','NL',4,'Anne Frank House','anne-frank-house','Timed entry only, released two months ahead.',90,16,4.8,true),
    ('prague','CZ',1,'Prague Castle Complex','prague-castle','St Vitus, the Golden Lane and the changing of the guard.',210,17,4.6,false),
    -- London / Tokyo / Kyoto
    ('london','GB',4,'British Museum','british-museum','Free. The Enlightenment gallery is the one people miss.',180,0,4.7,false),
    ('london','GB',1,'Tower of London','tower-of-london','Go at opening and do the Crown Jewels first.',180,35,4.6,true),
    ('tokyo','JP',1,'Senso-ji & Asakusa','senso-ji','Tokyo''s oldest temple, best before 08:00.',120,0,4.5,false),
    ('tokyo','JP',2,'Tsukiji Outer Market Breakfast','tsukiji-breakfast','Tamagoyaki, uni and knife shops.',150,4000,4.7,false),
    ('kyoto','JP',1,'Fushimi Inari Shrine','fushimi-inari','Ten thousand torii gates; walk past the first turn and the crowd evaporates.',180,0,4.8,false),
    ('kyoto','JP',5,'Arashiyama Bamboo Grove','arashiyama-bamboo','Go at dawn or not at all.',90,0,4.4,false),
    -- Istanbul / Marrakesh / Cairo / Cape Town
    ('istanbul','TR',1,'Hagia Sophia','hagia-sophia','Cathedral, then mosque, then museum, now mosque again.',120,25,4.7,false),
    ('istanbul','TR',7,'Grand Bazaar','grand-bazaar','4,000 shops. Closed Sundays.',150,0,4.3,false),
    ('marrakesh','MA',7,'Souks of the Medina','marrakesh-souks','Get lost deliberately; the way out is always downhill.',180,0,4.5,false),
    ('cairo','EG',1,'Pyramids of Giza & Sphinx','giza-pyramids','Enter the Great Pyramid if you are not claustrophobic.',240,540,4.7,true),
    ('cape-town','ZA',5,'Table Mountain Cableway','table-mountain','Check the wind before booking; it closes often.',180,420,4.8,true),
    -- New York / Rio / Cusco / Sydney
    ('new-york','US',4,'The Met','the-met','Pay-what-you-wish for New York State residents; three hours minimum.',210,30,4.8,false),
    ('new-york','US',1,'Brooklyn Bridge Walk','brooklyn-bridge','Manhattan to Dumbo at sunset.',90,0,4.7,false),
    ('rio-de-janeiro','BR',1,'Christ the Redeemer','christ-redeemer','Cog train up through the Tijuca forest.',180,95,4.6,true),
    ('cusco','PE',3,'Machu Picchu Day Trip','machu-picchu','Train to Aguas Calientes; entry is by timed circuit.',720,650,4.9,true),
    ('sydney','AU',5,'Bondi to Coogee Coastal Walk','bondi-coogee','6km of cliff path, four beaches, no ticket.',180,0,4.8,false),
    ('sydney','AU',1,'Sydney Opera House Tour','opera-house-tour','Inside the shells, including the concert hall when not in use.',60,45,4.5,true),
    -- Bangkok / Bali / Singapore / Dubai
    ('bangkok','TH',1,'Grand Palace & Wat Phra Kaew','grand-palace','Strict dress code, enforced at the gate.',180,500,4.6,false),
    ('bangkok','TH',2,'Chinatown Street Food','yaowarat-food','Yaowarat Road after dark.',180,400,4.8,false),
    ('bali','ID',5,'Tegallalang Rice Terraces','tegallalang','Go early; the light and the emptiness both improve it.',120,50000,4.4,false),
    ('singapore','SG',2,'Hawker Centre Tour','singapore-hawkers','Maxwell and Chinatown Complex, two Michelin-listed stalls.',150,35,4.7,true),
    ('dubai','AE',1,'Burj Khalifa At the Top','burj-khalifa','Level 124; book a sunset slot weeks ahead.',90,169,4.5,true),
    ('dubai','AE',3,'Desert Safari & Dune Bashing','dubai-desert-safari','4x4 dunes, camels and dinner under the stars.',360,250,4.6,true)
  ) AS v(city_slug, cc, category_id, name, slug, description, duration, cost, rating, booking)
  JOIN cities    c  ON c.slug = v.city_slug AND c.country_code = v.cc
  JOIN countries co ON co.code = c.country_code
ON CONFLICT (city_id, slug) DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description, rating = EXCLUDED.rating;

-- ------------------------------------------------------- generated tail ---
-- Every city gets one activity per category it is missing, so filters and
-- pagination have something to work with everywhere, not just the demo cities.
INSERT INTO activities (city_id, category_id, name, slug, description, duration_minutes, cost_amount, currency_code, rating, booking_required)
SELECT c.id,
       cat.id,
       tpl.title || ' in ' || c.name,
       cat.slug || '-' || c.slug,
       tpl.blurb || ' ' || c.name || '.',
       tpl.duration,
       ROUND(app.fx_convert((tpl.usd * (0.6 + c.popularity / 120.0))::numeric, 'USD', co.currency_code, DATE '2026-08-01'), 2),
       co.currency_code,
       ROUND((3.6 + (c.popularity % 13) / 10.0)::numeric, 1),
       tpl.booking
  FROM cities c
  JOIN countries co ON co.code = c.country_code
  CROSS JOIN (VALUES
    (1,'Historic Centre Walking Tour','A two-hour orientation on foot through the old quarter of',150,25,false),
    (2,'Local Flavours Tasting','Six tastings from the markets and family kitchens of',180,45,true),
    (3,'Half-Day Outdoor Adventure','Guided activity in the landscape just outside',300,70,true),
    (4,'Museums & Galleries Pass','Skip-the-line access to the principal collections of',240,30,true),
    (5,'Sunrise Viewpoint Hike','An early climb to the best vantage point over',210,20,false),
    (6,'Evening Bar District Crawl','Three venues with a local host, after dark in',210,50,true),
    (7,'Artisan Market Browse','Craft workshops and independent makers around',120,0,false),
    (8,'Traditional Spa Treatment','A ninety-minute treatment in the local tradition of',90,55,true)
  ) AS tpl(cat_id, title, blurb, duration, usd, booking)
  JOIN activity_categories cat ON cat.id = tpl.cat_id
 WHERE NOT EXISTS (
   SELECT 1 FROM activities a WHERE a.city_id = c.id AND a.category_id = cat.id
 )
ON CONFLICT (city_id, slug) DO NOTHING;

-- --------------------------------------------------------- opening hours --
-- Default: open Tue–Sun 09:00–18:00, closed Monday. Overridden below for the
-- real closures, which is what the feasibility warnings actually key off.
INSERT INTO activity_schedules (activity_id, day_of_week, opens_at, closes_at)
SELECT a.id, d.dow, TIME '09:00', TIME '18:00'
  FROM activities a
 CROSS JOIN (VALUES (0),(2),(3),(4),(5),(6)) AS d(dow)
 WHERE NOT EXISTS (SELECT 1 FROM activity_schedules s WHERE s.activity_id = a.id);

-- The Louvre and the Uffizi close Mondays, not Tuesdays; Orsay closes Monday;
-- the Grand Bazaar closes Sunday. Fix the ones we assert on.
DELETE FROM activity_schedules s USING activities a
 WHERE s.activity_id = a.id AND a.slug = 'louvre-museum' AND s.day_of_week = 2;   -- closed Tuesday
DELETE FROM activity_schedules s USING activities a
 WHERE s.activity_id = a.id AND a.slug = 'grand-bazaar'  AND s.day_of_week = 0;   -- closed Sunday
DELETE FROM activity_schedules s USING activities a
 WHERE s.activity_id = a.id AND a.slug = 'elephanta-caves' AND s.day_of_week IN (1); -- closed Monday

-- Nightlife runs late; sunrise activities run early. A single 09:00–18:00
-- window for everything would make the feasibility check nonsense.
UPDATE activity_schedules s SET opens_at = TIME '19:00', closes_at = TIME '23:59'
  FROM activities a WHERE s.activity_id = a.id AND a.category_id = 6;
UPDATE activity_schedules s SET opens_at = TIME '05:00', closes_at = TIME '09:00'
  FROM activities a WHERE s.activity_id = a.id
   AND (a.slug LIKE '%sunrise%' OR a.slug LIKE '%dawn%');
