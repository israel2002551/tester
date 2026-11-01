-- Keep products in the right category.
--
-- Products arrive from the seller form, the WhatsApp and Telegram importers and
-- the partner API, and several of those guess the category (some with an AI
-- reading the photo). That left perfume sets under Fashion, a necklace under
-- Electronics and tables and chairs under Other. This migration:
--
--   1. adds public.buysell_category_from_text(), one set of keyword rules that
--      reads a product name and returns its category when the name points to
--      exactly one (a name such as "Perfume and Watch Combo" points to two,
--      so it returns null and the product is left as it is);
--   2. adds a trigger so every new product, whichever way it arrives, is
--      placed by those rules: "Other" or a blank category is filled in from
--      the name (or, failing that, the description), and a built-in category
--      that the name plainly contradicts is corrected. Later edits are never
--      overridden, so a seller or admin can still deliberately change it;
--   3. adds public.buysell_suggest_category() so the Add Product form can
--      pick the category as the seller types the name;
--   4. corrects the listings already in the wrong category, recording every
--      change in public.product_category_fixes. Listings whose names say
--      nothing ("Boxed Item", "2 Pieces") were placed by their photos.
--
-- To undo step 4:
--   alter table public.products disable trigger buysell_products_assign_category;
--   update public.products p set category = f.old_category
--     from public.product_category_fixes f where f.product_id = p.id;
--   alter table public.products enable trigger buysell_products_assign_category;

create or replace function public.buysell_category_from_text(p_text text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  t text := ' ' || regexp_replace(lower(coalesce(p_text, '')), '[''‘’`]', '', 'g') || ' ';
  found text[] := array[]::text[];
  rule record;
begin
  -- Phrases first. Each is removed once matched, so "car fragrance" is not
  -- also read as a perfume, nor "ring light" as jewellery.
  for rule in
    select * from (values
      (1, 'home', '\m(car|room) (fragrances?|perfumes?|air fresheners?|fresheners?)\M|\mair fresheners?\M|\m(reed |aroma |oil )?diffusers?\M|\mdecorative\M|\mornaments?\M|\m(potted |artificial )?plants?\M|\mdinner sets?\M|\mceramics? sets?\M|\mcutlery sets?\M|\mcookware\M|\mhot plates?\M|\mneck pillows?\M|\mfragrance oils? for humidifiers?\M|\m(shoe |laundry )?washing bags?\M|\mwashing machines?\M|\mlaundry\M'),
      (2, 'phones', '\mphones?( \w+){0,3} (cases?|covers?|pouch(es)?|holders?|stands?|bags?|grips?|chargers?|mounts?)\M|\mscreen (protectors?|guards?)\M|\mtempered glass\M'),
      (3, 'electronics', '\mring lights?\M|\mled (lights?|strips?)\M|\msmart ?watch(es)?\M|\mpower (stations?|tanks?|banks?)\M|\msolar (panels?|generators?|power|lights?)\M'),
      (4, 'fashion', '\mlaptop (bags?|backpacks?)\M|\m(football|sports?) (jerseys?|kits?)\M|\mjerseys?\M'),
      (5, 'beauty', '\mhair (straighteners?|clippers?|dryers?|curlers?|growth|extensions?|oils?|tools?|serums?)\M|\mbody (mists?|sprays?|oils?|lotions?|creams?|wash|butters?|scrubs?)\M|\mface (wash|masks?|creams?|serums?)\M|\mlip ?(gloss|sticks?|balms?)\M|\mnail (polish|kits?|lamps?|dryers?|art)\M|\mskin ?care\M')
    ) as phrases(position, category, pattern)
    order by position
  loop
    if t ~ rule.pattern then
      found := found || rule.category;
      t := regexp_replace(t, rule.pattern, ' ', 'g');
    end if;
  end loop;

  -- Then single product words. Words that often mean something else in a
  -- listing ("cream" the colour, "foundation", "set", "oil") are left out.
  for rule in
    select * from (values
      ('beauty', '\m(perfumes?|parfums?|fragrances?|colognes?|deodorants?|roll-?ons?|lotions?|serums?|cleansers?|toners?|sunscreens?|soaps?|make-?up|lipsticks?|lashes|wigs?|straighteners?|clippers?|shavers?|trimmers?|supplements?|vitamins?|menstrual|sanitary|eau de (parfum|toilette))\M'),
      ('phones', '\m(iphones?|ipads?|smartphones?|tablets?|phones?|samsung galaxy|galaxy [a-z]?\d+|galaxy (fold|flip|note|tab)|tecno|infinix|itel|redmi|xiaomi|oppo|oneplus|nokia|huawei|pixel \d+)\M'),
      ('electronics', '\m(laptops?|macbooks?|thinkpads?|thinkbooks?|chromebooks?|elitebooks?|ideapads?|desktops?|monitors?|tvs?|televisions?|speakers?|soundbars?|headphones?|headsets?|earbuds?|airpods|earphones?|cameras?|webcams?|inverters?|generators?|playstation|ps[345]|xbox|nintendo|routers?|modems?|mifi|printers?|projectors?|esp32|arduino|raspberry pi|microcontrollers?|sensors?|keyboards?|stabili[sz]ers?|drones?|lenovo|asus|acer|dell)\M'),
      ('home', '\m(chairs?|tables?|sofas?|couch(es)?|beds?|bedframes?|mattress(es)?|wardrobes?|shelf|shelves|stools?|cabinets?|drawers?|furniture|dining|blenders?|microwaves?|air ?fryers?|airfryers?|kettles?|cookers?|pots?|pans?|plates?|mugs?|cups?|flasks?|cutlery|spoons?|knife|knives|kitchen|fridges?|refrigerators?|freezers?|fans?|vacuum|humidifiers?|curtains?|rugs?|carpets?|duvets?|bed ?sheets?|pillows?|towels?|clocks?|vases?|candles?|lamps?|bulbs?|organi[sz]ers?|hangers?|buckets?|dustbins?)\M'),
      ('sports', '\m(dumbbells?|kettlebells?|barbells?|treadmills?|yoga mats?|gym|fitness|skipping ropes?|jump ropes?|resistance bands?|boxing gloves?|footballs?|basketballs?|volleyballs?|tennis rackets?|bicycles?|exercise bikes?)\M'),
      ('fashion', '\m(gowns?|dress(es)?|shirts?|t-?shirts?|tees?|tops?|blouses?|trousers?|jeans?|skirts?|jumpsuits?|rompers?|hoodies?|tracksuits?|sweatshirts?|sweatpants|joggers?|shorts|jackets?|blazers?|coats?|suits?|abayas?|kaftans?|agbadas?|ankara|bubu|boubou|kimonos?|nightw(ear|are)s?|pajamas?|pyjamas?|lingerie|bras?|panties|underwears?|boxers?|socks|leggings|vests?|polos?|co-?ords?|shoes?|sneakers?|heels?|sandals?|slippers?|slides?|loafers?|boots?|crocs|mules?|flats|bags?|handbags?|backpacks?|purses?|totes?|wallets?|watch(es)?|wristwatch(es)?|jewe?l+e?ry|jewlery|necklaces?|bracelets?|bangles?|rings?|earrings?|pendants?|chains?|anklets?|sunglasses|eyeglasses|caps?|hats?|beanies?|berets?|belts?|scarf|scarves|bonnets?|durags?|beads?|cufflinks?|brooch(es)?)\M')
    ) as words(category, pattern)
  loop
    if t ~ rule.pattern then
      found := found || rule.category;
    end if;
  end loop;

  select coalesce(array_agg(distinct category), array[]::text[]) into found from unnest(found) as category;
  return case when cardinality(found) = 1 then found[1] end;
end;
$$;

-- For the Add Product form: the category the name (or description) points to.
create or replace function public.buysell_suggest_category(p_name text, p_description text default '')
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(public.buysell_category_from_text(p_name), public.buysell_category_from_text(p_description));
$$;

grant execute on function public.buysell_category_from_text(text) to anon, authenticated, service_role;
grant execute on function public.buysell_suggest_category(text, text) to anon, authenticated, service_role;

create or replace function public.buysell_products_assign_category()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  current_category text := lower(btrim(coalesce(new.category, '')));
  from_name text := public.buysell_category_from_text(new.name);
begin
  if current_category in ('', 'other') then
    new.category := coalesce(from_name, public.buysell_category_from_text(new.description), 'other');
  elsif current_category in ('electronics', 'fashion', 'home', 'phones', 'beauty', 'sports', 'dropship') then
    new.category := current_category;
    -- Only when a product is added: a later edit is a deliberate choice.
    if tg_op = 'INSERT' and current_category <> 'dropship' and from_name is not null and from_name <> current_category then
      new.category := from_name;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists buysell_products_assign_category on public.products;
create trigger buysell_products_assign_category
before insert or update of name, description, category on public.products
for each row execute function public.buysell_products_assign_category();

-- Correct the listings already in the wrong category, keeping a record.
create table if not exists public.product_category_fixes (
  product_id uuid not null,
  old_category text,
  new_category text not null,
  fixed_at timestamptz not null default now()
);
-- Only the SQL editor and service role read this; no API access.
alter table public.product_category_fixes enable row level security;

-- Listings whose names say nothing about them ("Boxed Item", "2 Pieces",
-- "Combo", "7feet by 10feet") or say the wrong thing ("Black Wine Gold" is a
-- pair of heels), placed by looking at their photos on 1 November 2026.
drop table if exists buysell_photo_checked;
create temporary table buysell_photo_checked (id uuid primary key, category text not null);
insert into buysell_photo_checked (id, category) values
  ('cd03b499-28b3-4132-8985-c850ecdec6b1', 'beauty'), -- 100ml Product
  ('2fe039d8-ecad-45ef-bee9-b5c8d13b9bb6', 'fashion'), -- 17000 boxed
  ('1546678b-f729-4578-86d7-903bb8115437', 'fashion'), -- 19000 boxed
  ('64bf23ef-77de-4fb5-82ee-33f48ceb60e8', 'fashion'), -- 19000 boxed
  ('bfd144a7-ce47-499b-818a-a633ba34aec5', 'fashion'), -- 2 Pcs Peak Milk
  ('997f30ec-7bfb-4cad-abd7-50177eb5a0a7', 'fashion'), -- 2 Pieces
  ('2506a4d4-f4b0-482c-b851-3f3e0b601c67', 'fashion'), -- 2 Pieces
  ('3b37a65b-ddaf-45ee-8d02-5bb83c2f620a', 'fashion'), -- 2 Pieces
  ('731293c3-cd86-4d90-b513-9246caf13290', 'fashion'), -- 2 Pieces
  ('b130d076-4b82-4d93-9b82-57702b95d08d', 'fashion'), -- 2 Pieces
  ('20699cb0-9c22-44be-99b4-7dd91a32aab1', 'fashion'), -- 2 Pieces
  ('2316d096-dd55-47d4-90d7-7f76453c8031', 'fashion'), -- 2 Pieces
  ('2967ea42-69cc-4d3f-aa3d-1f54028bc2bd', 'fashion'), -- 2 Pieces
  ('dbbdb084-8047-4aed-ac92-ee6c2b4ad4bb', 'fashion'), -- 2 Pieces
  ('b041f5c3-e46a-4cdb-ae05-6b3b35634656', 'fashion'), -- 2 Pieces
  ('9d16d49d-4e06-4ac1-a7fb-3f7d0644f3fe', 'fashion'), -- 2 Pieces
  ('1fd9e7bd-d7e0-4a0b-a116-3875874f072d', 'fashion'), -- 2 Pieces of Product
  ('06f51b61-6758-49e0-a43a-c0bcd14610fa', 'fashion'), -- 2 Pieces of Product
  ('86928888-da09-44e0-9ee6-d1df63a9337c', 'fashion'), -- 2 Pieces of Unspecified Item
  ('fd6688b0-6fc2-4a83-ac6b-d0872ec26a1a', 'fashion'), -- 2 Pieces of Unspecified Item
  ('9235b902-e697-4a98-bc57-c2c9289048da', 'fashion'), -- 2 Pieces of Unspecified Item
  ('0cbede9c-065e-4165-ad49-e1d28d3a1989', 'fashion'), -- 2 pcs (unspecified item)
  ('27076ab6-febd-4072-87ee-bf145d1e3a7d', 'fashion'), -- 2 pcs item
  ('14602aae-322d-4a44-bbe1-d693e453eaba', 'fashion'), -- 2 pcs item
  ('5d8c4990-3bb5-447a-90c8-b786d34d4a9b', 'fashion'), -- 2-in-1 Product
  ('dfea4288-e52e-4780-b485-47ca5fa87226', 'fashion'), -- 2-in-1 Product
  ('3ec28ee3-8671-4ffb-9cc6-73bb78ef7f0a', 'fashion'), -- 21cm boxed item
  ('183352bf-eec4-43ad-9149-a30e51907a33', 'home'), -- 24pcs Set
  ('dae70709-e4eb-4027-b36b-67ec915fcb64', 'beauty'), -- 25ml
  ('e38ee42b-2c7e-4c56-bd69-38fa18c7ca76', 'beauty'), -- 25ml
  ('722ee4a6-45ed-42be-a29a-a135f16d741e', 'fashion'), -- 2in1.18500
  ('3400b3fa-78bd-4957-9637-087db4efb0e9', 'fashion'), -- 2in1.21500
  ('988f8246-c2d2-4b47-9ee7-2aad54d2f567', 'fashion'), -- 2pcs
  ('c48394d7-3c6f-4b89-b585-d2bf5c7b1cfe', 'fashion'), -- 2pcs Long Strap
  ('90acd104-bd97-4795-ad29-03e1ad0332f7', 'fashion'), -- 2pcs Men's Item
  ('5d298da1-7f3e-47a1-8556-a4cac05ba28c', 'fashion'), -- 2pcs Men's Items
  ('d2cb1f18-e202-474a-b179-7a17e5061915', 'fashion'), -- 3 in 1 Bundle
  ('c52ff4cc-2ff6-4c03-a556-d01b8c3f7c56', 'beauty'), -- 30ml product
  ('785b7570-a36c-437c-8bf4-f38642fe9b44', 'fashion'), -- 37-71 Available on displayed colours
  ('d3c239d7-c489-4b01-9102-0ee1dc32d301', 'fashion'), -- 40-45
  ('05cf2f9e-c35c-45e8-9e34-4ae2bb647439', 'beauty'), -- 50ml
  ('3b2cef13-9b92-444b-8521-8744e4f264ab', 'beauty'), -- 55ml
  ('a5da3dab-b833-4b52-98dd-c1c9d657015e', 'home'), -- 5feet by 7 feet
  ('199266d6-56b1-4031-ac30-2c072442e261', 'home'), -- 5feet by 7 feet
  ('ddc95d74-9f8d-4958-990e-4a181ca4334f', 'home'), -- 5feet by 7 feet
  ('c6faf9e2-6561-4e60-b29e-eaec7ded39ff', 'home'), -- 5feet by 7 feet
  ('92ba2f1e-a26f-437b-8115-f07ad3518fa5', 'home'), -- 5feet by 7 feet
  ('347b7be0-c28f-4b67-9c7b-bcf16cba0eb9', 'beauty'), -- 700 each
  ('555cc860-58b7-45e0-aa0a-a4fe03639ad3', 'fashion'), -- 7500
  ('e1eea58e-4f12-496d-96a4-87f68932e193', 'fashion'), -- 7500 only
  ('2db37249-c26a-452d-b065-b897f381fbe5', 'home'), -- 7feet by 10feet
  ('b8fc7de8-4411-42f6-883c-45d144053f0a', 'home'), -- 7feet by 10feet
  ('bc89cfee-f9ba-4d78-badb-c5b58eeac0c9', 'home'), -- 7feet by 10feet
  ('e928d076-4911-4cb0-8bec-afa5c951b1ba', 'home'), -- 7feet by 10feet
  ('6628d49c-062e-4094-aa55-8d296266d10a', 'home'), -- 7feet by 10feet
  ('42f81db4-ea0d-4929-bd6d-f62b2088de88', 'home'), -- 7feet by 10feet
  ('249e88a5-2608-4d51-9581-ee866952bf68', 'fashion'), -- 8500 only
  ('0aaec570-8287-4b47-b2aa-85586013904b', 'fashion'), -- ASH 14500
  ('02882ac6-240a-4452-81f0-32dd6d68d0d0', 'fashion'), -- Anime Merchandise
  ('9d9922a5-12ce-4711-bbdb-ff3f81fbaf66', 'fashion'), -- Another Colour
  ('6d567c00-2816-42be-ba1d-66a65485cac9', 'fashion'), -- Another Colour
  ('08c5d61d-9347-4230-b072-be36609242d2', 'fashion'), -- Assorted Item (2 pcs)
  ('e7a48a95-9b32-49fe-a3bf-8cf82f5ca34f', 'fashion'), -- Assorted items (2 pcs)
  ('9257fcd6-86b1-457e-abd0-9b732811fec0', 'beauty'), -- Available
  ('39bbcfc0-3638-4217-a672-a0e077c11762', 'fashion'), -- Available in Colors
  ('4eb98714-0c82-4f54-8251-02d5714ff841', 'fashion'), -- Available in colors
  ('29f2a239-c6af-4eee-ace7-4e2ff3c76867', 'fashion'), -- BLACK 15600
  ('fa1da0c7-a2df-4dee-ab82-d7552d8e747d', 'fashion'), -- Best seller landed
  ('8e423f17-a23f-4b08-b5b7-025146995f17', 'fashion'), -- Best seller landed
  ('5f417e34-12fc-4ee5-8924-a6926438d7e2', 'fashion'), -- Black 15500
  ('36d144a6-2e8a-4540-ae4d-877a6c6babd9', 'fashion'), -- Black Wine Gold
  ('8ef35ef7-e644-44dc-b62f-f745d929ce2d', 'fashion'), -- Black Wine Gold
  ('b586afb8-5b48-488e-95d3-e4c136f5f614', 'fashion'), -- Black and White Product
  ('8c83178a-3ab6-4775-958b-e4c14d6126c2', 'fashion'), -- Black blue nude
  ('ab8ad8ca-02bf-442a-8fb9-56cd0e21986e', 'fashion'), -- Boxed
  ('6bad2973-4f65-4204-a002-5e205d2e4102', 'fashion'), -- Boxed Item
  ('668682bb-c5bb-4094-8c01-ea2a10bd83e2', 'fashion'), -- Boxed Item
  ('40c2bb14-c9d2-49aa-9c68-3bc3b68878c6', 'fashion'), -- Boxed Item
  ('e6191575-065f-4df7-8e14-329025e53ff5', 'fashion'), -- Boxed Item
  ('7043a793-666c-4e57-a7b0-93d21072c837', 'fashion'), -- Boxed Item
  ('08c95958-9b37-4323-85a8-4a9d9a966fd8', 'fashion'), -- Boxed Item
  ('62d45052-0f36-4274-b898-30d93b381022', 'fashion'), -- Boxed Item
  ('86d1e70d-2f8e-421f-a71b-9f61fd956de2', 'fashion'), -- Boxed Item for Sale
  ('ac250a29-93d1-4b89-9f18-4a60699a9f96', 'fashion'), -- Boxed Item for Sale
  ('6fdae32d-ee1b-4aa7-891b-32afc561604e', 'fashion'), -- Boxed Product
  ('cb627471-f20e-406b-a700-8fd08971b783', 'fashion'), -- Boxed Product
  ('74d3e438-d858-4db1-81e1-52f928b0f54d', 'fashion'), -- Boxed Product
  ('b8f0baf4-f06b-4ed7-837d-7f0439fad7be', 'fashion'), -- Boxed Product
  ('2ffc648d-60dd-4177-9ba7-332a45bfb2da', 'fashion'), -- Boxed item for sale
  ('3c669da9-3096-480b-9cfa-8c2d28ce4ebe', 'fashion'), -- Brown, Black, or Dark Blue Item
  ('cde87ae0-dd5e-4cdc-99cc-21f9e475b224', 'fashion'), -- Chinese Product Available in Multiple Co
  ('f304e287-bf73-4ae8-884d-70a5ec83f989', 'beauty'), -- Combo
  ('39ad4836-8eee-4016-8704-d864eec0905a', 'beauty'), -- Combo
  ('9f571186-503a-4f2e-ad01-efc9a158ee79', 'beauty'), -- Combo
  ('022b6ebc-ae2a-404b-962b-0482be587bb3', 'beauty'), -- Combo
  ('f8a795a5-8c94-44bd-83c0-d156251a3bd0', 'fashion'), -- Combo for Her
  ('9a246e2b-307f-4950-9aef-76b8c8955719', 'fashion'), -- Corporate Combo
  ('9d9adaa1-0649-4730-be28-cf9735060cf4', 'fashion'), -- Corporate Combo
  ('9a6eaca0-cbc3-4e89-940d-335cdf9d35fe', 'beauty'), -- Diamond gloom
  ('84c6d54b-ece0-454b-bb01-2cd0447204d0', 'fashion'), -- Discounted Item
  ('61326f33-745c-4b02-ae7a-1cf026fcd4eb', 'electronics'), -- Extreme 2
  ('09d0eda7-36e0-4e49-8827-43aa3149349b', 'fashion'), -- Female Combo
  ('98370963-b50e-4938-8fc6-67d218f8457b', 'fashion'), -- Foreign
  ('a9c8cbb7-7872-466e-88ce-47d865ba059f', 'fashion'), -- Foreign Used Item
  ('183cdea8-20a2-422c-a04e-c0dd9e6c52a3', 'fashion'), -- Foreign item
  ('1969bd3c-3f10-4809-8710-e18447d72b8f', 'electronics'), -- Fully Boxed Item
  ('03579a83-ddf5-437b-b77e-5a55abb46db3', 'fashion'), -- Ikweji
  ('fe8bab1c-91c1-48f2-aa78-89ec8a29d180', 'fashion'), -- Item (2 pcs)
  ('d653c9e3-7b3c-4884-b379-e54f68541d79', 'fashion'), -- Item for sale
  ('8ec6b63f-92ad-47bf-a9c9-aad9b84c0e43', 'fashion'), -- Item for sale
  ('7872757b-e881-49e9-9fde-160f91223073', 'fashion'), -- Item for sale
  ('5adc4174-26a4-476c-b7f3-6b713ef4b823', 'fashion'), -- Item size 3741
  ('b303c8f7-7add-49c6-be52-4be38fe3c0ca', 'fashion'), -- Landed Umbrellas (Black & Brown)
  ('5db2e132-9aaf-4f54-9b70-20fb49a3fe37', 'fashion'), -- Luxury
  ('718f91cc-131f-4a6c-8d49-3c07490c337c', 'fashion'), -- Luxury 37 41 Fully Boxed
  ('b7ae6c56-9dc2-47ce-8458-dee82e1137c1', 'home'), -- Luxury Intelligent Car Fragrance with LE
  ('b8542e6c-dd0e-47ac-97e5-944727585e41', 'fashion'), -- Luxury
  ('29a3758a-dbc1-4392-bb98-78c5c96e29a2', 'fashion'), -- Max selection
  ('fcd638e3-9b00-49ca-947d-f8191d9489d6', 'fashion'), -- Men's Item (2pcs)
  ('b9013c25-65b5-49a0-bf2b-c5d25e3c3f0d', 'fashion'), -- Mk item (size 37-42)
  ('0f7fa4f9-1c6c-47e2-bbe4-5a7070fd5e79', 'fashion'), -- Montblanc Pen
  ('ceddf473-0694-4cb6-b070-e6dbf47e5f78', 'fashion'), -- Naked Wolfe
  ('c1f6f35f-3bf4-475b-a362-ff1c19bc2f5f', 'fashion'), -- New Luxury Chinese Item
  ('d9592d35-53bd-4dfb-ae2d-ba0d41457107', 'fashion'), -- New Luxury Chinese Product
  ('48498e24-5e1d-46ee-9312-65a9ee3f602d', 'fashion'), -- Not your regular
  ('dc77de37-1448-430b-893d-74a8c9d60275', 'fashion'), -- Now
  ('0826f31f-608f-44be-b0ff-4dcdb3c6039f', 'fashion'), -- Now
  ('8aa51e91-f26a-49f0-8838-0d7d802f18d9', 'fashion'), -- Now restocked 12500
  ('86d865c6-1c7e-41ed-863f-19ce2959c96d', 'fashion'), -- Orange Brown and Black Marked Colors
  ('c8004a5f-0e25-487a-b19f-8294198936cb', 'fashion'), -- Original product  all colours available
  ('16caa195-b87b-4c97-a744-d68b47e34fd1', 'home'), -- Padded
  ('b95cadb7-3966-4ff6-81eb-03d97cda984f', 'beauty'), -- Pineapple Scented Product
  ('aa860255-99f1-4bf3-8a22-dfd1acdb3515', 'fashion'), -- Pink Blue Green Items
  ('7530d907-9281-4bc6-9c20-94c130fdf191', 'fashion'), -- Pink and Cream Item
  ('46e16dfe-d4cd-4d43-bda0-48801515c9af', 'fashion'), -- Poedagar leather
  ('1b3f8b29-424e-4a6e-aede-72f71f197f34', 'fashion'), -- Product
  ('0e8a63cb-b760-49df-8aba-23f90287ba4a', 'fashion'), -- Quality 3pcs (3-11yrs)
  ('70abc10c-e9fd-49ba-96a5-525c67bfb898', 'fashion'), -- Red, Pink, and White Items
  ('07bf1a6b-50ff-462e-82d2-a010f924956d', 'home'), -- Restocked
  ('9b801b99-4efc-4c07-bb21-6d2e45a914ca', 'beauty'), -- Skin doctor
  ('9b8747dc-4f9c-4397-b7ed-7c4073dbe1d9', 'fashion'), -- Stock 38-43
  ('547d114d-e647-4e30-b8f0-6c8ae38e2f8d', 'fashion'), -- Stock 40-45
  ('b30c532b-0310-4b4c-8366-2b2196882d03', 'beauty'), -- Student Combo Bundle
  ('2cb49351-725b-484a-9c27-b98ad9e03525', 'home'), -- Stylish and Functional Item
  ('f3d4524f-57b8-4c5d-ab7b-ca24595780ec', 'home'), -- Stylish and Functional Item
  ('19ac09bc-613a-46a2-a908-c07ce8c0082b', 'fashion'), -- Two pieces (2 pcs)
  ('a62ea1f9-2608-480c-8346-94b78036b8a8', 'home'), -- Unpadded
  ('82ac5639-3cf5-4410-bf7d-a95efc0ca0fb', 'fashion'), -- Unspecified Item
  ('4d1cd1a9-85e5-4476-a27e-66ce66e2c1c8', 'fashion'), -- Unspecified Item
  ('df5ab698-29b9-4bdd-b72a-5327be61ec44', 'fashion'), -- Unspecified item (2 pcs)
  ('884bfce9-f65f-4c0a-afd6-97351d69701c', 'fashion'), -- Waterproof Item
  ('27bf5dad-86e2-4782-b012-29ca90f71335', 'fashion'), -- each
  ('8fb38560-e98e-4bae-be20-6b1eab22a048', 'fashion'), -- ladies delight
  ('679c9743-cffe-4759-b21e-1cc43dbd33b6', 'fashion'), -- only
  ('2ff801a1-924b-4d16-bd52-ec06cc7fb1ef', 'fashion'), -- up nd down
  ('6f75fec0-01e5-4a4d-9d0e-0a688662c510', 'fashion'); -- With fan

-- Everything else: by the rules above.
with proposed as (
  select
    id,
    category as old_category,
    case
      when lower(btrim(coalesce(category, ''))) in ('', 'other')
        then coalesce(public.buysell_category_from_text(name), public.buysell_category_from_text(description))
      when lower(btrim(category)) in ('electronics', 'fashion', 'home', 'phones', 'beauty', 'sports')
        then public.buysell_category_from_text(name)
    end as new_category
  from public.products
  where id not in (select id from buysell_photo_checked)
),
changed as (
  update public.products p
  set category = proposed.new_category
  from proposed
  where proposed.id = p.id
    and proposed.new_category is not null
    and proposed.new_category <> lower(btrim(coalesce(p.category, '')))
  returning p.id, proposed.old_category, proposed.new_category
)
insert into public.product_category_fixes (product_id, old_category, new_category)
select id, old_category, new_category from changed;

with photo as (
  select p.id, p.category as old_category, c.category as new_category
  from public.products p
  join buysell_photo_checked c on c.id = p.id
  where lower(btrim(coalesce(p.category, ''))) <> c.category
),
changed as (
  update public.products p
  set category = photo.new_category
  from photo
  where photo.id = p.id
  returning p.id, photo.old_category, photo.new_category
)
insert into public.product_category_fixes (product_id, old_category, new_category)
select id, old_category, new_category from changed;

drop table buysell_photo_checked;
