-- Local and staging sample data. Prices, capacity and rules are placeholders
-- until Yorgos sets the real ones in Admin (T6.9).

insert into public.property (name, address, phone, email, social_links) values (
  'Casa Filakopi',
  'Epar. Od. Triovasalou-Apollonion, Filakopi, Potamia, 84800, Milos',
  '+306934707765',
  'host@miloscasa.com',
  '{"instagram": "https://www.instagram.com/casa_filakopi/", "facebook": "https://www.facebook.com/CasaFilakopi/"}'
);

insert into public.rooms (id, slug, name, description, max_adults, max_children, base_occupancy, base_price_cents, cleaning_fee_cents)
values (
  '00000000-0000-4000-8000-000000000001',
  'casa-filakopi',
  '{"en": "Casa Filakopi", "el": "Casa Filakopi"}',
  '{"en": "A traditional Cycladic farmhouse near Pollonia.", "el": "Παραδοσιακή κυκλαδίτικη αγροικία κοντά στην Πολλώνια."}',
  4, 2, 2, 12000, 4000
);

insert into public.amenities (name, sort_order) values
  ('{"en": "Hammock", "el": "Αιώρα"}', 1),
  ('{"en": "Exterior shower", "el": "Εξωτερικό ντους"}', 2),
  ('{"en": "Gas BBQ", "el": "Μπάρμπεκιου υγραερίου"}', 3),
  ('{"en": "Air conditioner", "el": "Κλιματισμός"}', 4),
  ('{"en": "Wi-Fi", "el": "Wi-Fi"}', 5),
  ('{"en": "TV", "el": "Τηλεόραση"}', 6),
  ('{"en": "Hair dryer", "el": "Πιστολάκι μαλλιών"}', 7),
  ('{"en": "Yoga mattress", "el": "Στρώμα γιόγκα"}', 8),
  ('{"en": "Snorkeling equipment", "el": "Εξοπλισμός κατάδυσης"}', 9),
  ('{"en": "Beach towels", "el": "Πετσέτες θαλάσσης"}', 10);

insert into public.room_amenities (room_id, amenity_id)
select '00000000-0000-4000-8000-000000000001', id from public.amenities;

insert into public.settings (key, value, is_public) values
  ('booking', '{"holdMinutes": 35, "checkoutSessionMinutes": 30, "sameDayCutoffHour": 12, "horizonMonths": 18}', false),
  ('payment', '{"mode": "deposit", "deposit": {"kind": "percent", "percent": 30}, "balanceDaysBefore": 14}', false),
  ('languages', '{"enabled": ["en", "el"]}', true),
  ('channel_sync', '{"enabled": true, "intervalMinutes": 15}', false);

insert into public.cancellation_policies (name, tiers, is_default) values (
  '{"en": "Standard", "el": "Τυπική"}',
  '[{"daysBefore": 30, "refundPercent": 100}, {"daysBefore": 0, "refundPercent": 0}]',
  true
);

insert into public.seasons (room_id, name, start_date, end_date, nightly_cents, weekend_cents) values
  ('00000000-0000-4000-8000-000000000001', 'High 2027', '2027-07-01', '2027-08-31', 22000, 24000);

insert into public.taxes_fees (name, kind, amount_cents, sort_order) values
  ('{"en": "Climate resilience fee", "el": "Τέλος ανθεκτικότητας στην κλιματική κρίση"}', 'per_night', 200, 1);

insert into public.external_calendars (room_id, channel, is_enabled) values
  ('00000000-0000-4000-8000-000000000001', 'airbnb', false),
  ('00000000-0000-4000-8000-000000000001', 'booking_com', false);

-- Dummy business details. Every document stays provisional until the
-- accountant confirms the setup (D4).
insert into public.settings (key, value, is_public) values (
  'invoicing',
  '{"isProvisional": true, "defaultDocType": "receipt", "myDataMode": "off", "issuer": {"legalName": "DUMMY Business Name", "vatNumber": "000000000", "taxOffice": "DUMMY Tax Office", "address": "Dummy Street 1, 84800 Milos", "phone": "+30 000 000 0000", "email": "host@miloscasa.com"}}',
  false
);

insert into public.invoice_series (doc_type, prefix) values
  ('receipt', 'TEST-R'),
  ('invoice', 'TEST-I'),
  ('credit_note', 'TEST-CN');
