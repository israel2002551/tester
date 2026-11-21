-- The products in "Other" again, sorted into proper categories and renamed.
--
-- On 21 November 2026, 18 products were in Other (17 live, 1 paused). They
-- were WhatsApp imports with captions such as "On sales", "Sales price" or
-- "for. 10pcs": the importer's AI was unavailable, so it used the caption as
-- the name and filed them under Other. Each was looked at photo by photo
-- (and frame by frame for videos) and now has a main category, a name that
-- says what it is, and who it is for:
--   fashion  16   (dresses, sets, tank-top bundles, sandals, slides, watches)
--   beauty    1   (perfume and body spray)
--   arts      1   (resin keychains)
--
-- Every change is recorded in public.other_category_review. Running this
-- again changes nothing: only products still in Other are touched.
--
-- To undo:
--   alter table public.products disable trigger on_product_published;
--   update public.products p set name = r.old_name, category = r.old_category,
--          audience = r.old_audience, status = r.old_status
--     from public.other_category_review r where r.product_id = p.id;
--   alter table public.products enable trigger on_product_published;

drop table if exists buysell_other_review;
create temporary table buysell_other_review (
  id uuid primary key,
  category text not null,
  audience text,
  name text not null
);
insert into buysell_other_review (id, category, audience, name) values
  ('305a25e4-3362-4136-9d7b-c65220754a90', 'arts', null, 'Customised Alphabet Resin Keychains'), -- was: Customised Alphabet Resin Keychains
  ('eb2c22a3-4f69-4ea0-98b7-b328f74ee3ec', 'fashion', 'women', 'Women''s Lilac Wide-Leg Drawstring Trousers'), -- was: Discount price
  ('95012b51-9ae0-435a-b26e-b32bc8ca3dca', 'fashion', 'women', 'Women''s Button-Up Shirt and Wide-Leg Trousers Set (Pink, Brown, Wine, Purple)'), -- was: 2 Pieces
  ('46c55fea-0cef-42a8-975c-ee1fa9ea47cc', 'fashion', 'women', 'Women''s Red Halter-Neck Fringe Maxi Dress'), -- was: Sales price (video; paused)
  ('421b7499-4df6-41da-9f03-a33f123e8a32', 'fashion', 'women', 'Women''s Ruffled Tiered Mini Dresses (Yellow, White, Brown, Red)'), -- was: On sales
  ('2eefac89-408e-4802-94da-63d580f1a70c', 'fashion', 'women', 'Women''s Clear Bow Square-Toe Heeled Mules'), -- was: On sales
  ('34f0b266-1fff-4bb1-9f2e-0dd737df98a8', 'fashion', 'women', 'Women''s Quilted Logo Flat Slides (Brown, Blue, Yellow, Black, White)'), -- was: On sales
  ('7a4a0989-077b-471e-a55b-4b927fb7b597', 'fashion', 'women', 'Women''s Slingback Heels and Handbag Combo (White, Red, Black)'), -- was: Combo
  ('e88bb756-fd8d-49e9-8a3d-a31a4e5add15', 'beauty', 'unisex', 'Oud for Glory Perfume and Storm Elixir Body Spray'), -- was: Both available
  ('78179c54-a644-4a9d-9986-b0d35ba36a95', 'fashion', 'women', 'Women''s Girly Tank Tops (Bundle of 10)'), -- was: for. 10pcs (video)
  ('e7976312-ac1a-412d-802b-c101b4190041', 'fashion', 'women', 'Women''s Girly Tank Tops (Bundle of 5)'), -- was: . for. 5pcs (same video)
  ('13437672-87d9-4643-b289-84e270da9f48', 'fashion', 'women', 'Women''s Two-Tone Basic Tank Tops (Bundle of 10)'), -- was: for. 10pcs (video)
  ('2e4f00d0-d238-42a5-bd0a-9fef9a1096e7', 'fashion', 'women', 'Women''s Two-Tone Basic Tank Tops (Bundle of 5)'), -- was: . for. 5pcs (same video)
  ('7b661806-e639-4249-8b89-8e81441f63af', 'fashion', 'kids', 'Girls'' Bow Wedge Sandals (Sizes 25-36)'), -- was: 25 to 30
  ('05a5f60c-62ff-4c00-96e7-8da878f12417', 'fashion', 'unisex', 'Casio Vintage Digital and Skeleton Chronograph Watches'), -- was: Montblanc Pen (the photos are watches)
  ('944f2cfb-dac4-4383-b47a-2fbab7436855', 'fashion', 'women', 'Women''s Open-Back Crop Top and Flared Trousers Set (Yellow, Pink, Black)'), -- was: On sales
  ('0939d949-d2c4-495c-bf9e-981b32744e8d', 'fashion', 'women', 'Women''s Halter Top and Bubble Skirt Set (Yellow, Blue, Black, Wine)'), -- was: Sales price
  ('e9cc3067-852d-4aed-89e1-bcbb5b3a69aa', 'fashion', 'women', 'Women''s Graphic Baby Tees (Assorted Designs)'); -- was: On sales

-- Products touched here: those still in Other.
drop table if exists buysell_other_targets;
create temporary table buysell_other_targets as
select p.id, p.name, p.category, p.audience, p.status, r.name as new_name, r.category as new_category, r.audience as new_audience
from public.products p
join buysell_other_review r on r.id = p.id
where lower(btrim(coalesce(p.category, ''))) = 'other';

insert into public.other_category_review
  (product_id, old_name, old_category, old_audience, old_status, new_name, new_category, new_audience, new_status)
select id, name, category, audience, status, new_name, new_category, new_audience, status
from buysell_other_targets
on conflict (product_id) do update
  set new_name = excluded.new_name,
      new_category = excluded.new_category,
      new_audience = excluded.new_audience,
      reviewed_at = now();

-- Renaming is not a new listing: skip the per-row call to notify-new-product.
alter table public.products disable trigger on_product_published;

update public.products p
set name = t.new_name,
    category = t.new_category,
    audience = t.new_audience
from buysell_other_targets t
where t.id = p.id;

alter table public.products enable trigger on_product_published;

drop table buysell_other_targets;
drop table buysell_other_review;
