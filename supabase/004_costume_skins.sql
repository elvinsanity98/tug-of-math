-- Tug of Math update 4: four full-body costume skins in the shop.
-- Run once, after 003: SQL Editor -> New query -> paste this file -> Run. Safe to run again.
-- Prices here are the ones the database charges; keep them in step with catalog.js.
insert into public.skins (id, name, price, min_stars, sort) values
  ('straw', 'Straw Hat',   1300, 0, 20),
  ('web',   'Web Slinger', 1400, 0, 21),
  ('iron',  'Iron Armor',  1600, 0, 22),
  ('doom',  'Doom Lord',   1600, 0, 23)
on conflict (id) do update
  set name = excluded.name, price = excluded.price, min_stars = excluded.min_stars, sort = excluded.sort;
