-- Men's and Women's sections, and a photo review of every product.
--
-- Shoppers can now browse Men and Women as well as the existing categories.
-- A product keeps its category (Fashion, Beauty, ...) and gains an audience:
--
--   1. public.products.audience says who a fashion or beauty listing is for:
--      men, women, unisex or kids. The Men page lists men's and unisex
--      products, the Women page women's and unisex ones; the Fashion and
--      Beauty pages are unchanged. Other categories have no audience.
--   2. public.buysell_audience_from_text() reads it from a listing's words:
--      first what the listing says ("Women's", "for men", "Unisex", "Kids",
--      "2-12 years"), then a shoe size range (40-45 is men's, 37-41 women's),
--      then items made almost only for one of them (gowns, heels, handbags;
--      agbada, boxers, beard oil). When the words do not say, it returns null
--      and the product stays on its Fashion or Beauty page only.
--   3. public.buysell_category_from_text() also knows houses and rooms for
--      rent (Other, not Home), perfume brands (Beauty), luggage and umbrellas
--      (Fashion) and tripods (Phones).
--   4. The category trigger fills in the audience of every new or edited
--      fashion or beauty product that has none, and clears it from other
--      categories. An audience the seller chose is kept.
--   5. Every product photo was reviewed on 8 November 2026. 110 products
--      move to the category their photo shows (recorded in
--      public.product_category_fixes) and 989 get the audience it shows.
--      Products added after the review are placed by the rules above.
--
-- To undo step 5's category moves:
--   alter table public.products disable trigger buysell_products_assign_category;
--   update public.products p set category = f.old_category
--     from public.product_category_fixes f
--     where f.product_id = p.id and f.fixed_at >= '2026-11-08';
--   alter table public.products enable trigger buysell_products_assign_category;

alter table public.products add column if not exists audience text;
alter table public.products drop constraint if exists products_audience_check;
alter table public.products add constraint products_audience_check
  check (audience in ('men', 'women', 'unisex', 'kids'));

create or replace function public.buysell_audience_from_text(p_text text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  t text := ' ' || regexp_replace(lower(coalesce(p_text, '')), '[''‘’`]', '', 'g') || ' ';
  sizes text[];
  smallest int;
  largest int;
  for_women boolean;
  for_men boolean;
begin
  -- Words that only look like the ones below: characters and teams, colours,
  -- men's formal wear, and the safety line printed on beauty products.
  t := regexp_replace(t, '\m(spider|iron|bat|super|he|pac)[ -]?man\M|\mman (city|utd|united)\M|\mbaby (pink|blue)\M|\m(out of (the )?reach of|away from) (kids|children)\M|\ma couple of\M', ' ', 'g');
  t := regexp_replace(t, '\mdress (shirts?|shoes|trousers|pants|socks)\M', ' formal \1 ', 'g');

  -- 1. What the listing says.
  if t ~ '\m(kids?|children|childrens|baby|babies|toddlers?|infants?|newborns?)\M|\m\d{1,2} ?(-|to) ?\d{1,2} ?(yrs|years|months)\M' then
    return 'kids';
  end if;
  if t ~ '\munisex\M|\mhis (and|&) hers\M|\m(him (and|&) her|her (and|&) him)\M|\mcouples?\M' then
    return 'unisex';
  end if;
  for_women := t ~ '\m(women|womens|woman|ladies|lady|female|females|feminine)\M|\mfor her\M';
  for_men := t ~ '\m(men|mens|man|male|males|gents?|gentlemen|gentleman|masculine)\M|\mfor him\M';
  if for_women and for_men then
    return 'unisex';
  elsif for_women then
    return 'women';
  elsif for_men then
    return 'men';
  end if;

  -- 2. Shoe sizes: a range from 39-40 up to 44-46 is men's, one up to 41-42 women's.
  if t ~ '\m(shoes?|sneakers?|slides?|slippers?|sandals?|loafers?|boots?|heels?|footwears?|crocs|palms?|pams?)\M' then
    sizes := regexp_match(t, '\m(3[5-9]|4[0-9])\s*(?:-|–|to|/)\s*(3[5-9]|4[0-9])\M');
    if sizes is not null then
      smallest := least(sizes[1]::int, sizes[2]::int);
      largest := greatest(sizes[1]::int, sizes[2]::int);
      if smallest >= 39 and largest >= 44 then
        return 'men';
      elsif smallest <= 38 and largest <= 42 then
        return 'women';
      end if;
    end if;
  end if;

  -- 3. Things made almost only for one of them.
  for_women := t ~ '\m(gowns?|dress(es)?|skirts?|blouses?|heels?|stilettos?|slingbacks?|pumps|mules|wedges|bras?|bralettes?|lingerie|panties|bodysuits?|bodycon|jumpsuits?|rompers?|playsuits?|leggings|abayas?|bubu|boubou|kimonos?|handbags?|purses?|clutch(es)?|totes?|earrings?|anklets?|bangles?|headbands?|bonnets?|corsets?|camisoles?|peplum|maxi|midi|lip ?(gloss|sticks?|balms?)|lashes|wigs?|nail (polish|kits?)|make-?up|body mists?|sanitary|menstrual)\M|\m(crop|tube|halter) tops?\M';
  -- Kaftans and jalabiyas are left out: women wear them too.
  for_men := t ~ '\m(agbadas?|senators?|boxers|briefs|singlets?|cufflinks?|beards?|aftershaves?|shav(er|ers|ing))\M|\m(hublot|rolex|patek|audemars|richard mille|vacheron|iwc|tag heuer|g-?shock|poedagar|naviforce|curren)\M';
  if for_women and not for_men then
    return 'women';
  elsif for_men and not for_women then
    return 'men';
  end if;
  return null;
end;
$$;

grant execute on function public.buysell_audience_from_text(text) to anon, authenticated, service_role;

-- As in 20261101000000_product_categories.sql, plus: houses and rooms for rent
-- are Other whatever else the name mentions (a flat "with kitchen cabinets"
-- is not furniture); perfume brands; luggage and umbrellas; tripods and
-- selfie sticks; oils for humidifiers.
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
  if t ~ '\m(\d+|one|two|three|four|five)[ -]?bed ?rooms?\M|\mself[ -]?contain(ed)?\M|\mselfcon\M|\mroom (and|&) parlou?r\M|\m(flats?|apartments?|houses?|duplex(es)?|bungalows?|rooms?|shops?|shop spaces?|office spaces?|warehouses?|land|plots?) (for|to) (rent|let|lease|sale)\M|\mfor rent\M|\mto let\M|\msublet\M|\mroommates?\M|\mhostels?\M|\mhall \d+\M|\mbed ?spaces?\M|\mapartments?\M|\mplots? of land\M' then
    return 'other';
  end if;

  -- Phrases first. Each is removed once matched, so "car fragrance" is not
  -- also read as a perfume, nor "ring light" as jewellery.
  for rule in
    select * from (values
      (1, 'home', '\m(car|room) (fragrances?|perfumes?|air fresheners?|fresheners?)\M|\mair fresheners?\M|\m(reed |aroma |oil )?diffusers?\M|\mdecorative\M|\mornaments?\M|\m(potted |artificial )?plants?\M|\mdinner sets?\M|\mceramics? sets?\M|\mcutlery sets?\M|\mcookware\M|\mhot plates?\M|\mneck pillows?\M|\mfragrance oils? for humidifiers?\M|\maroma oils?\M|\mhumidifier (essential |fragrance )?oils?\M|\m(shoe |laundry )?washing bags?\M|\mwashing machines?\M|\mlaundry\M'),
      (2, 'phones', '\mphones?( \w+){0,3} (cases?|covers?|pouch(es)?|holders?|stands?|bags?|grips?|chargers?|mounts?)\M|\mscreen (protectors?|guards?)\M|\mtempered glass\M|\mtripods?\M|\mselfie sticks?\M'),
      (3, 'electronics', '\mring lights?\M|\mled (lights?|strips?)\M|\msmart ?watch(es)?\M|\mpower (stations?|tanks?|banks?)\M|\msolar (panels?|generators?|power|lights?)\M'),
      (4, 'fashion', '\mlaptop (bags?|backpacks?)\M|\m(football|sports?) (jerseys?|kits?)\M|\mjerseys?\M'),
      (5, 'beauty', '\mhair (straighteners?|clippers?|dryers?|curlers?|growth|extensions?|oils?|tools?|serums?)\M|\mbody (mists?|sprays?|oils?|lotions?|creams?|wash|butters?|scrubs?|splash)\M|\mface (wash|masks?|creams?|serums?)\M|\mlip ?(gloss|sticks?|balms?)\M|\mnail (polish|kits?|lamps?|dryers?|art)\M|\mskin ?care\M')
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
      ('beauty', '\m(perfumes?|parfums?|fragrances?|colognes?|deodorants?|roll-?ons?|lotions?|serums?|cleansers?|toners?|sunscreens?|soaps?|make-?up|lipsticks?|lashes|wigs?|straighteners?|clippers?|shavers?|trimmers?|supplements?|vitamins?|menstrual|sanitary|eau de (parfum|toilette)|edp|edt|oud|attar|lattafa|armaf|rasasi|afnan|al haramain|ajmal|maison alhambra|fragrance world|french avenue|zimaya|khamrah|hawas|club de nuit|9pm|ramz|qaed al fursan|musamam|bharara)\M'),
      ('phones', '\m(iphones?|ipads?|smartphones?|tablets?|phones?|samsung galaxy|galaxy [a-z]?\d+|galaxy (fold|flip|note|tab)|tecno|infinix|itel|redmi|xiaomi|oppo|oneplus|nokia|huawei|pixel \d+)\M'),
      ('electronics', '\m(laptops?|macbooks?|thinkpads?|thinkbooks?|chromebooks?|elitebooks?|ideapads?|desktops?|monitors?|tvs?|televisions?|speakers?|soundbars?|headphones?|headsets?|earbuds?|airpods|earphones?|cameras?|webcams?|inverters?|generators?|playstation|ps[345]|xbox|nintendo|routers?|modems?|mifi|printers?|projectors?|esp32|arduino|raspberry pi|microcontrollers?|sensors?|keyboards?|stabili[sz]ers?|drones?|lenovo|asus|acer|dell)\M'),
      ('home', '\m(chairs?|tables?|sofas?|couch(es)?|beds?|bedframes?|mattress(es)?|wardrobes?|shelf|shelves|stools?|cabinets?|drawers?|furniture|dining|blenders?|microwaves?|air ?fryers?|airfryers?|kettles?|cookers?|pots?|pans?|plates?|mugs?|cups?|flasks?|cutlery|spoons?|knife|knives|kitchen|fridges?|refrigerators?|freezers?|fans?|vacuum|humidifiers?|curtains?|rugs?|carpets?|duvets?|bed ?sheets?|pillows?|towels?|clocks?|vases?|candles?|lamps?|bulbs?|organi[sz]ers?|hangers?|buckets?|dustbins?)\M'),
      ('sports', '\m(dumbbells?|kettlebells?|barbells?|treadmills?|yoga mats?|gym|fitness|skipping ropes?|jump ropes?|resistance bands?|boxing gloves?|footballs?|basketballs?|volleyballs?|tennis rackets?|bicycles?|exercise bikes?)\M'),
      ('fashion', '\m(gowns?|dress(es)?|shirts?|t-?shirts?|tees?|tops?|blouses?|trousers?|jeans?|skirts?|jumpsuits?|rompers?|hoodies?|tracksuits?|sweatshirts?|sweatpants|joggers?|shorts|jackets?|blazers?|coats?|suits?|abayas?|kaftans?|agbadas?|ankara|bubu|boubou|kimonos?|nightw(ear|are)s?|pajamas?|pyjamas?|lingerie|bras?|panties|underwears?|boxers?|socks|leggings|vests?|polos?|co-?ords?|shoes?|sneakers?|heels?|sandals?|slippers?|slides?|loafers?|boots?|crocs|mules?|flats|bags?|handbags?|backpacks?|purses?|totes?|wallets?|watch(es)?|wristwatch(es)?|jewe?l+e?ry|jewlery|necklaces?|bracelets?|bangles?|rings?|earrings?|pendants?|chains?|anklets?|sunglasses|eyeglasses|caps?|hats?|beanies?|berets?|belts?|scarf|scarves|bonnets?|durags?|beads?|cufflinks?|brooch(es)?|luggages?|suitcases?|umbrellas?)\M')
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

grant execute on function public.buysell_category_from_text(text) to anon, authenticated, service_role;

create or replace function public.buysell_products_assign_category()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  current_category text := lower(btrim(coalesce(new.category, '')));
  from_name text := public.buysell_category_from_text(new.name);
  chosen_audience text := lower(btrim(coalesce(new.audience, '')));
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

  -- Who it is for. Only fashion, beauty and sellers' own categories have one.
  if new.category in ('electronics', 'home', 'phones', 'sports', 'dropship', 'other') then
    new.audience := null;
  elsif chosen_audience in ('men', 'women', 'unisex', 'kids') then
    new.audience := chosen_audience;
  else
    new.audience := coalesce(public.buysell_audience_from_text(new.name), public.buysell_audience_from_text(new.description));
  end if;
  return new;
end;
$$;

drop trigger if exists buysell_products_assign_category on public.products;
create trigger buysell_products_assign_category
before insert or update of name, description, category, audience on public.products
for each row execute function public.buysell_products_assign_category();

-- The photo review of 8 November 2026: products whose photo shows another
-- category, and every product whose photo shows who it is for.
drop table if exists buysell_photo_review;
create temporary table buysell_photo_review (id uuid primary key, category text not null, audience text);
insert into buysell_photo_review (id, category, audience) values
  ('06e3f7c2-8eaa-4d26-8b64-3b4d039cc6a6', 'beauty', 'men'), -- 3 in 1 clipper
  ('99894322-fca0-4283-afe3-8ec768249121', 'beauty', 'men'), -- 5-in-1 Masculine Perfume Combo
  ('cb7498bf-5029-4e06-8154-7635a17e958a', 'beauty', 'men'), -- 9PM by Afnan Perfume
  ('80bcfb68-ce12-4802-81ff-908fe2b60aff', 'beauty', 'men'), -- 9pm Fragrance
  ('053d1b9f-04c1-4353-bcfe-8075ff801d95', 'beauty', 'men'), -- 9pm night out+Ramz lattafa +Asad elixir(All 50ml) (was fashion)
  ('93887ce1-324d-44eb-a498-9e06df0ff003', 'beauty', 'men'), -- Hanna's Secret Black Suction Eau de Parfum
  ('e2085793-be66-406e-9c64-b87f7fd516dd', 'beauty', 'men'), -- Hannah Secret Collection 50ml Masculine Fragrance
  ('8fa5ad8c-252c-4cf3-9cc7-9aff36d2ec96', 'beauty', 'men'), -- Intense Noir Combo (was fashion)
  ('c9bbf827-d245-4343-b3d5-57bddcad33b6', 'beauty', 'men'), -- Luxury Pure Vibe Masculine Scent Combo
  ('27774056-5301-4042-987b-52cfe51db82a', 'beauty', 'men'), -- Men Combo (was fashion)
  ('4709a2f9-1495-44dd-b9d5-7e53cc085414', 'beauty', 'men'), -- Now and 9pm Combo (was fashion)
  ('ab78b946-f7ee-4525-ae88-94e5557d50f0', 'beauty', 'men'), -- Pour Homme Eau de Parfum 100ml
  ('2288f740-83e4-4a4d-a8e1-6c8c304e5de4', 'beauty', 'men'), -- Riggs London Perfumed Deodorant Body Spray
  ('32582dda-941a-4b4e-8ff7-df1820d9990e', 'beauty', 'men'), -- Upgraded Vintage Professional Hair Clipper SX-A51
  ('9a6a3872-adc5-491a-be91-ea5221cc2efe', 'beauty', 'men'), -- VIP Luxury Gold In A Bottle Combo For Him
  ('94e276d2-8c54-42bd-b011-fd0c95d18108', 'beauty', null), -- 4 Piece Trace Set (was fashion)
  ('485a3cca-0431-4eef-b890-c41941350bce', 'beauty', null), -- Available (was other)
  ('0129af1f-d1fa-4116-8440-eadb0a68f4ac', 'beauty', null), -- Black Combo (was fashion)
  ('fe91d580-6baf-423f-ba46-6adc3db11ffc', 'beauty', null), -- Chocolate and vanilla combo (was fashion)
  ('65c08e64-46d0-4ce8-bf1f-13f94f8724d6', 'beauty', null), -- Enclaire 50ml (was fashion)
  ('3ca479fb-aec4-4d4c-9ecf-4b45fe1770b1', 'beauty', null), -- Matelot (was fashion)
  ('db51e834-371f-4093-bb29-6a7ab9d9fe20', 'beauty', null), -- Musamam 50ml (was fashion)
  ('191e3e41-50c2-46f7-902e-689db82fc7ff', 'beauty', null), -- Qaed Al Fursan Combo (was fashion)
  ('82217f9c-3286-49fe-b829-03fd2abb06da', 'beauty', null), -- Rage and Rave 100ml (was fashion)
  ('ce3c6118-bf08-4e93-abd0-222c6449c5d6', 'beauty', null), -- Ramz silverLattafa 50ml (was fashion)
  ('e4dc0a28-e33c-4686-8b97-857a7d8a4648', 'beauty', null), -- Red Combo (was fashion)
  ('4644f71b-dab9-464b-83e8-32c7f8fd8134', 'beauty', null), -- Unisex Fashion Combo (was fashion)
  ('dc16c20b-9f77-4a5a-9e99-f93836be8bfc', 'beauty', null), -- Victoria's Secret Item (was fashion)
  ('947fe6b3-9ee0-49b9-87ba-5017b138c500', 'beauty', 'women'), -- 10 Inch Human Hair Extensions
  ('1a37d32c-6bbc-4d9a-9b76-6fbe5ee3416e', 'beauty', 'women'), -- 4in1 perfume set
  ('6f8dae04-ec66-4492-bafb-6c65dfc4da0b', 'beauty', 'women'), -- Extra Long Lily Pad (was home)
  ('ef3a4285-6bd9-4d01-9b32-94bdc18ce520', 'beauty', 'women'), -- Extra Long Pad
  ('3345943e-a8b1-438d-a546-8b3fbaedf3ee', 'beauty', 'women'), -- Feminine Combo
  ('91728718-91d6-4263-bb44-47541b0180aa', 'beauty', 'women'), -- Girlie Combo Set
  ('62c688f4-d172-47d9-9bca-177ee46e49b5', 'beauty', 'women'), -- Hanna's Secret Pink Romance Eau de Parfum
  ('3897758c-501f-429d-b7a3-2b13414dc8c3', 'beauty', 'women'), -- LilyPad Maxi Comfort Sanitary Pads (8 Pack)
  ('94bb8df3-b51a-4f2f-89d0-0a890a521fc7', 'beauty', 'women'), -- LilyPad Ultra Soft Sanitary Pads (14 Pack)
  ('414791cf-b329-4b9f-aab8-a745443faa06', 'beauty', 'women'), -- LilyPad Ultra Soft Sanitary Pads (8 Pack)
  ('1a6bede9-17cd-461d-ab4e-6875df058e6f', 'beauty', 'women'), -- Marshmallow blush (was fashion)
  ('ba202f12-5739-4828-98f8-db0e1159aed6', 'beauty', 'women'), -- Menstrual belt
  ('9a8fd5e4-a712-499f-9159-7d7a97e69543', 'beauty', 'women'), -- Menstrual Cramp Relief Belt
  ('f42f043a-7902-48c4-bfcc-e4b3322f3e57', 'beauty', 'women'), -- Menstrual Pain Relief Product
  ('eb53767a-eb1b-4803-aae7-aee222063710', 'beauty', 'women'), -- Nova 3-in-1 Perfect Curl and Straightener Hair Tool
  ('bbeea7b9-c0b9-4420-ad6e-ea0af56fffd4', 'beauty', 'women'), -- NOVA Hair Straightener
  ('fc2a70d2-34ba-4591-94e6-a3e70674e5a2', 'beauty', 'women'), -- Pink Girlie Perfume
  ('5f9646d8-e747-443f-9f77-1e701d4efbfc', 'beauty', 'women'), -- Restore Women's Probiotic Gummies with Cranberry
  ('1c5e255f-994e-4484-b2a6-440d64e8ff0e', 'beauty', 'women'), -- SUNone UVLED Nail Lamp
  ('e919c270-b515-4934-978f-1aa0c25fb0ad', 'beauty', 'women'), -- Sweet Feminine Combo Imperio Way, Sugar Pink & Genie Mist
  ('9c0d0f5a-ffa0-46a4-b4b6-65224992f04c', 'beauty', 'women'), -- Sweet Feminine Combo Perfume, Body Mist & Deodorant
  ('5516ea53-eed3-4143-abdd-a7b90433853e', 'beauty', 'women'), -- Sweet Feminine Fragrance
  ('d7d55456-d902-4975-8265-0ba78e519507', 'electronics', null), -- 50 MXChip IoT DevKit is being given out tomorrow (was other)
  ('3d2a896a-42a5-47be-85ff-104e4a531130', 'electronics', null), -- Zealot S67 Smartphone (was phones)
  ('3a11f0c8-b33e-4f13-b0f5-8653edf38f6b', 'fashion', 'kids'), -- Children's Christmas Pajamas
  ('aa3491e5-42c0-494c-ba90-2dc92e91e082', 'fashion', 'kids'), -- five-piece student backpack (schoolbag)
  ('fbfd0811-2f47-4901-a667-6b5e22544f5e', 'fashion', 'kids'), -- Gold Set (2pcs)
  ('c6adce34-f08c-44ba-98a6-bdbb9d4e355f', 'fashion', 'kids'), -- Hiway Best Black Patent Leather Kids' Shoes
  ('3967d962-5ca4-4468-a940-f7082a1f0fc0', 'fashion', 'kids'), -- Hiway Black Patent Leather Kids Shoes
  ('ddda41e6-d957-4df4-b7dc-b31b2f6e53ab', 'fashion', 'kids'), -- Hiway Black Patent Leather Kids' Loafers
  ('5db2e132-9aaf-4f54-9b70-20fb49a3fe37', 'fashion', 'kids'), -- Luxury
  ('0e8a63cb-b760-49df-8aba-23f90287ba4a', 'fashion', 'kids'), -- Quality 3pcs (3-11yrs)
  ('9c61cb25-ccc5-46a3-ad7c-ae70cb4bf36d', 'fashion', 'kids'), -- Unisex 2-12 Years Clothing (3 Pieces)
  ('9a094f9d-d983-4c0e-9d97-1963b23e8c7d', 'fashion', 'kids'), -- Unisex Kids' Clothing (2-12 Years)
  ('90acd104-bd97-4795-ad29-03e1ad0332f7', 'fashion', 'men'), -- 2pcs Men's Item
  ('5d298da1-7f3e-47a1-8556-a4cac05ba28c', 'fashion', 'men'), -- 2pcs Men's Items
  ('e2ae6418-d14b-4ee8-a7eb-f82bf8b3a858', 'fashion', 'men'), -- 40-45 Size Shoes Fully Boxed
  ('d3c239d7-c489-4b01-9102-0ee1dc32d301', 'fashion', 'men'), -- 40-45
  ('5d4690f0-b6fc-44ee-833c-f6fe0e839d91', 'fashion', 'men'), -- Bestwin Watch
  ('29d2e6d2-ad34-4965-ac89-c58506723c9e', 'fashion', 'men'), -- Black Men's Striped Track Pants
  ('d8194d94-f70e-44e8-91a2-7918e95dfa45', 'fashion', 'men'), -- Calvin Klein Men's Drawstring Shorts
  ('0fd6b0b0-a2f0-4580-bb15-adcc18581a6c', 'fashion', 'men'), -- Calvin Klein Shorts
  ('cd8693d7-0cf5-45c9-b13f-616c2d69bd5a', 'fashion', 'men'), -- Casio Watch
  ('baf3eafe-b94c-4187-80cf-15cc73e9ca37', 'fashion', 'men'), -- Casio Watches
  ('7380d22d-87cf-49ae-b881-c2753a4d0a7a', 'fashion', 'men'), -- Certina DS Action World Chronograph Quartz Watch
  ('2ec6ff8f-0996-45ea-a28b-f13eaaa47d57', 'fashion', 'men'), -- Chenxi (was other)
  ('9d9adaa1-0649-4730-be28-cf9735060cf4', 'fashion', 'men'), -- Corporate Combo
  ('9a246e2b-307f-4950-9aef-76b8c8955719', 'fashion', 'men'), -- Corporate Combo
  ('e96ba85b-5648-428d-ba4c-339efb1a0450', 'fashion', 'men'), -- FRANCK MULLER LEATHER WATCH
  ('0abd0a22-c6cf-4894-b962-181e9f5b0ef0', 'fashion', 'men'), -- G-Shock Watch
  ('76b4f557-f45e-4ba0-8b27-e4aea964f4ac', 'fashion', 'men'), -- G-Shock Watch
  ('e2796c9a-bc7e-4634-965d-35ee5fe2ddb5', 'fashion', 'men'), -- G-Shock Watch
  ('9028f09c-18fa-4b11-b328-db0d01508230', 'fashion', 'men'), -- GShock Watch
  ('a2d7c37e-87a3-422c-8a19-57c33a4d1a16', 'fashion', 'men'), -- Gold 44
  ('5e7749a2-41b9-4614-8a96-9a89a11167ee', 'fashion', 'men'), -- Green 43
  ('4a1ae277-f1d7-4e46-a0d6-2050881077ae', 'fashion', 'men'), -- Grey Minimalist Steel Wristwatch with Box
  ('759846b6-7f5d-4440-aba6-77ccead915d8', 'fashion', 'men'), -- Gucci Slide Sandals & Studded Leather Sandals
  ('3c2c5557-61df-4860-a96c-065965023b72', 'fashion', 'men'), -- Gucci Style Monogram Crossbody Bag
  ('95dfada3-3e59-4187-b526-cfcb4234b140', 'fashion', 'men'), -- High Quality Arsenal Emirates Fly Better Jersey
  ('037003e4-6cc3-4838-bd68-a8bbb59e0660', 'fashion', 'men'), -- High Quality Arsenal Football Jersey
  ('535ba045-d707-42eb-b8c9-4dafefe95e53', 'fashion', 'men'), -- High Quality Boutique Standard Men Baggy Jeans
  ('80c7aa5a-9ee2-4865-9679-12c8193eea94', 'fashion', 'men'), -- High Quality Durable Polo Shirt
  ('8ad69bbb-ae5e-4013-9975-4d74ff2d162f', 'fashion', 'men'), -- High Quality front and back Tee designer shirt
  ('5256c1c6-29c6-467b-a97d-a8bd26673ada', 'fashion', 'men'), -- High Quality G-Shock Watch
  ('26638527-ddc5-42a4-9736-1bec90a9bd36', 'fashion', 'men'), -- High Quality Joggers
  ('2c1a0cbd-51f3-4eb7-a2e4-d793aa8d0ab5', 'fashion', 'men'), -- High Quality Pams Shoes
  ('38399b3e-190c-451e-8f80-6dde237a897c', 'fashion', 'men'), -- High Quality Polo Shirt
  ('c5d19a4d-b130-4d3e-9869-bf5c082bfcd8', 'fashion', 'men'), -- High Quality Sweatshirt
  ('26ab8a7a-962a-41a3-a847-2e56a0500b1d', 'fashion', 'men'), -- High Quality Sweatshirts
  ('e483ba38-6a9d-43b7-a89a-456e23c18964', 'fashion', 'men'), -- High Quality T-Shirt
  ('68a4234f-737f-42c1-b0da-4008134042e8', 'fashion', 'men'), -- High School Coat
  ('d5dbc8f1-faf8-466b-8d71-e2a63312c9ac', 'fashion', 'men'), -- High School Coat
  ('f3060657-17f3-456e-9246-2c6fa3284c57', 'fashion', 'men'), -- Hublot Big Bang Signature Tourbillon Watch
  ('2221f04b-e5a3-4877-a61a-c5c1ee401c39', 'fashion', 'men'), -- HUBLOT LEATHER WATCH
  ('7e4caeb8-8996-44e1-b975-67823d7778d8', 'fashion', 'men'), -- Hublot Watch
  ('b1e5e476-8e37-41ba-84ef-8386a2085c4e', 'fashion', 'men'), -- Hublot Watch
  ('77e0e9a5-d8ad-4084-93e4-20b68bbd31a7', 'fashion', 'men'), -- Hublot Watch
  ('4f1da178-faa5-4ffa-9851-fe79b8462244', 'fashion', 'men'), -- IWC Ingenieur Automatic Watch
  ('8c8c1525-1a85-41c2-939c-bbeb1bc30be9', 'fashion', 'men'), -- Jersey
  ('f4a2d709-0d37-4f0a-97c3-1ad0c0d3f19a', 'fashion', 'men'), -- Landed Shoes Size 40-45
  ('1dc12f01-7684-4684-a2a0-f7bd00ff565f', 'fashion', 'men'), -- Long Bar Pendant Necklace
  ('f8d85540-a7a8-4764-98cb-65303560faaf', 'fashion', 'men'), -- Long Bar Pendant Necklace
  ('33c2ea38-9528-4a82-a5bb-269b07e8751f', 'fashion', 'men'), -- Long Sleeve Polo Shirt
  ('d0bdecfb-8841-43b1-8fd0-416d83650c71', 'fashion', 'men'), -- Long Sleeve Polo Shirt
  ('d67ea85d-f2c9-4cd6-9b9d-bbe09105bdcd', 'fashion', 'men'), -- Lookworld Watch
  ('35c81686-8748-43cf-be94-5ce0266d5340', 'fashion', 'men'), -- Lookworld Watch
  ('5712006f-765e-45e7-afe2-6471f8003b65', 'fashion', 'men'), -- Luxury Jalabia in Black, Brown, Wine, Blue, and Fayrous
  ('8b48fa54-f88f-4957-b74c-0f8c66a0d0b5', 'fashion', 'men'), -- Luxury jeans short size 32/34
  ('68b29f49-20ad-42d9-b7b0-72c0c7cde8bf', 'fashion', 'men'), -- Luxury jeans short size 34/36
  ('239f1bff-9a65-420c-9ade-7fd97c86910a', 'fashion', 'men'), -- Luxury jeans short size 36/38
  ('b156ab33-7015-4e50-ab6c-912f15eaece6', 'fashion', 'men'), -- Luxury Men Crop Top
  ('580c8377-741a-45fc-99b2-7403d66ea7ec', 'fashion', 'men'), -- Male Neck Chain
  ('896a454f-7c87-4ccc-9555-04bc48fe4ef8', 'fashion', 'men'), -- Male two piece (complete)
  ('0e25891d-57e5-4c8b-a33d-9bceda17c623', 'fashion', 'men'), -- Matturi Leather Strap
  ('11aa5a33-d677-4427-b8db-e2fb99214d83', 'fashion', 'men'), -- Matturi sport chronograph watch
  ('f7f0069e-9c27-4ece-8247-42e0ae704f60', 'fashion', 'men'), -- Men suit trousers variety of colors available
  ('873dd506-0976-4baf-92a0-d045f438b2dd', 'fashion', 'men'), -- Men watch
  ('2349052b-1c02-417d-92a6-aa29ee2d9818', 'fashion', 'men'), -- Men watch set
  ('f26eae86-cbc6-4c81-9146-0177575613b8', 'fashion', 'men'), -- Mens baggy jean
  ('e8c56cc4-1f5c-4a2f-b64a-7ca132ac21dd', 'fashion', 'men'), -- Men's Baggy Jeans
  ('43c8eb9d-2559-46d4-9da9-8ffafad01ceb', 'fashion', 'men'), -- Mens collared shirts
  ('3b4a0791-9230-4712-9896-05a12e7aa6e9', 'fashion', 'men'), -- Men's Genuine Leather Crossbody Bag
  ('fcd638e3-9b00-49ca-947d-f8191d9489d6', 'fashion', 'men'), -- Men's Item (2pcs)
  ('57b14305-079c-455f-b6b2-c6e4f6657d21', 'fashion', 'men'), -- Men's Premium Half-Zip Polo Shirt
  ('856e2d82-d4ad-4570-b35c-07008137bc71', 'fashion', 'men'), -- Mens straight pants jeans
  ('3f4208be-c362-4659-b89e-e04029021c90', 'fashion', 'men'), -- Men's Suede Slip-On Casual Shoes
  ('10641dd2-b7ef-4b29-98e4-5dfc7a2c16d7', 'fashion', 'men'), -- Mens sweatshirt
  ('0b2305c7-d109-4438-aa5e-251aa341c1be', 'fashion', 'men'), -- Miu Miu Sneakers (Sizes 40-45)
  ('3ad989d7-7b90-4abd-82f8-b32edab774f8', 'fashion', 'men'), -- Miu Miu Sneakers (Sizes 40-45)
  ('31c12c5d-ff4e-4bf5-b8e6-7efbde88565f', 'fashion', 'men'), -- Miu Miu Sneakers (Sizes 40-45)
  ('e32ad2b2-52b5-4f1b-a4d6-ac325fb521b2', 'fashion', 'men'), -- Montblanc Pen
  ('0f7fa4f9-1c6c-47e2-bbe4-5a7070fd5e79', 'fashion', 'men'), -- Montblanc Pen
  ('ceddf473-0694-4cb6-b070-e6dbf47e5f78', 'fashion', 'men'), -- Naked Wolfe
  ('9534675e-4626-490b-9781-5d490eb74cfb', 'fashion', 'men'), -- Naked Wolfe Shoes Size 40-46
  ('72e58f4a-4cd7-426b-9ae3-e0c6e6b4cb99', 'fashion', 'men'), -- Navy & White Yacht Club Graphic Polo Shirt
  ('bb9dcd5e-697b-463c-acb2-721d0bef32a9', 'fashion', 'men'), -- Navy & White Yacht Club Graphic Polo Shirt
  ('37868f56-9c88-4c08-bcb1-c57728cd89e3', 'fashion', 'men'), -- New luxury shirt
  ('2e679d09-4259-4a1d-8467-bd450b8e5dbb', 'fashion', 'men'), -- Nice quality shirt
  ('38bd8e31-51da-41ec-8f29-d1b91dc74745', 'fashion', 'men'), -- Nike watch
  ('7d897750-7a6c-41bf-9972-2429c396433a', 'fashion', 'men'), -- Omega Luxury Watch
  ('50a7f6c4-ad58-477b-bad5-8f647f80a8d0', 'fashion', 'men'), -- Omega Watch
  ('679c9743-cffe-4759-b21e-1cc43dbd33b6', 'fashion', 'men'), -- only
  ('85584b81-85f9-4edb-aaaa-9671dea48e90', 'fashion', 'men'), -- Patek Philippe Gold Quartz Watch with Bracelet
  ('68e24fae-95c0-4aec-a587-ab5b2340a352', 'fashion', 'men'), -- Patek Philippe Luxury Watch
  ('8ad4af8d-76b8-403f-acd0-02751856793a', 'fashion', 'men'), -- Patek Philippe Watch
  ('23e6e13d-646d-4d20-8d23-84860fe42c6d', 'fashion', 'men'), -- Patek Philippe Working Chronograph
  ('5c8b4465-e27a-46a6-a2ce-35e6eb9470bb', 'fashion', 'men'), -- POEDAGAR CHAIN WATCH
  ('46e16dfe-d4cd-4d43-bda0-48801515c9af', 'fashion', 'men'), -- Poedagar leather
  ('64fd265d-3680-453f-8594-e6efc1c05892', 'fashion', 'men'), -- Poedagar Leather
  ('6a2c8668-5817-4408-a1d8-04df5577c573', 'fashion', 'men'), -- Poedagar Leather
  ('63a26ae3-a7f6-482a-9931-ff0eb5086dc0', 'fashion', 'men'), -- Poedagar Leather Item
  ('02efc16b-45c5-46dc-a3bb-5e69dd907023', 'fashion', 'men'), -- POEDAGAR QUARTZ MOVEMENT WRISTWATCH
  ('d41092f2-9f30-4a3e-af79-18d56be29d86', 'fashion', 'men'), -- POEDAGAR WATCH
  ('2ce97847-8e88-4a07-a5c7-3eac715c4cc3', 'fashion', 'men'), -- Polo Shirt
  ('c8374dd9-db93-420c-af46-6a9193b4d5d1', 'fashion', 'men'), -- Puma Slide Sandals - Brown, Yellow, Green & Black
  ('753a8723-604a-4946-a895-d2146359718c', 'fashion', 'men'), -- Quality G-Shock Watch
  ('069c3152-80f2-4d7e-973a-ba773aff9f24', 'fashion', 'men'), -- Quality GShock Watch
  ('723c6d69-6759-4bbd-94c2-27ceb5f664a8', 'fashion', 'men'), -- Quality Jonkoso Shoes
  ('0128b678-d5c7-466c-bf3f-8e9ef256cc36', 'fashion', 'men'), -- Quality Sneakers Size 40-45
  ('16801b9c-dccd-4efe-bfee-df48ee15c563', 'fashion', 'men'), -- Quality Vintage Shirts
  ('c9f2f81a-1f27-49fb-a48f-2812febb0f04', 'fashion', 'men'), -- Richard Mille Watch
  ('13d19775-4156-4ef9-be68-66ff958715b4', 'fashion', 'men'), -- Rick spin watch
  ('6a93bacb-557f-4efe-8077-8bd016445051', 'fashion', 'men'), -- Rick Watch with Blue Silicone Strap
  ('52cb66fd-5a73-46a4-b5af-e9b0ca96caf5', 'fashion', 'men'), -- Rick Watch with Silicone Strap
  ('c31df32f-06d1-4539-bc01-7dcc20e6fa7c', 'fashion', 'men'), -- Rolex Watch
  ('8a8ee5c1-65d1-497b-b9aa-1be49fcc10a5', 'fashion', 'men'), -- Rolex Watch
  ('f87446db-e439-4ef2-a28b-f966d15f59ce', 'fashion', 'men'), -- Rolex Watch
  ('4bf94940-6c15-45e8-9c3a-274011f06ad3', 'fashion', 'men'), -- Round Neck T-Shirt
  ('da6e3b2d-4172-4094-b2b0-36d8f783e172', 'fashion', 'men'), -- Round Neck T-Shirt
  ('01782332-b450-4442-b5ff-4c1e0426aa41', 'fashion', 'men'), -- Skechers Men's Platform Slides
  ('e8d48764-cca6-4026-b83e-8b8e31a8fc6c', 'fashion', 'men'), -- Skechers Men's Platform Slides
  ('bf4b0d0c-22f7-479b-afc3-2151fae814ca', 'fashion', 'men'), -- Small Band 3-in-1 Condom Boxers
  ('547d114d-e647-4e30-b8f0-6c8ae38e2f8d', 'fashion', 'men'), -- Stock 40-45
  ('d38aa389-4433-45cc-af78-a9bc90f2a8ea', 'fashion', 'men'), -- Tissot Watch
  ('90df228a-17d2-4523-8253-c35aa318c2d2', 'fashion', 'men'), -- Tissot Watch
  ('a854d567-4fb5-418c-9ea5-e17fe7fd4f0e', 'fashion', 'men'), -- Toblerich Men's Watch Set with Beaded Bracelet
  ('ba8d99fb-0bd9-42af-a322-bd7ea51decaf', 'fashion', 'men'), -- Tomi Luxury Analog Watch with Metal Bracelet
  ('4d1cd1a9-85e5-4476-a27e-66ce66e2c1c8', 'fashion', 'men'), -- Unspecified Item
  ('7d453e80-8ba5-454f-96c9-ea41508f7cde', 'fashion', 'men'), -- Vacheron Luxury Watch
  ('7155fde5-eedf-4dbf-999c-8fe22a10af58', 'fashion', 'men'), -- Vacheron Watch
  ('af7ff090-9ad5-481b-8b82-9e6c179a12f6', 'fashion', 'men'), -- Waterproof Cross Body Bag with USB Port
  ('884bfce9-f65f-4c0a-afd6-97351d69701c', 'fashion', 'men'), -- Waterproof Item
  ('ede4f899-cf52-44cd-b1fa-b13dd2b92b3d', 'fashion', 'men'), -- Wine 42
  ('504dd3f3-1086-4586-8f2c-bf4acb249a1b', 'fashion', 'men'), -- Wine 43
  ('950a0ee8-b023-4f4b-95fd-ee0305446c27', 'fashion', 'unisex'), -- . Available in brown color only. (was other)
  ('c6ac4dc8-7b7b-4241-bb1d-61c7e86a4882', 'fashion', 'unisex'), -- . White, pink,available (was other)
  ('a30c03d6-b32c-4bd5-902d-0b92fa7db182', 'fashion', 'unisex'), -- BELVOUARDIANS (was other)
  ('70ded581-ac49-4a4d-9ae4-b47ad000e232', 'fashion', 'unisex'), -- 4-in-1 Unbreakable Product (was other)
  ('633dfd2e-1ed8-4c44-835a-4133111bd8be', 'fashion', 'unisex'), -- 66 Jersey
  ('e1eea58e-4f12-496d-96a4-87f68932e193', 'fashion', 'unisex'), -- 7500 only
  ('249e88a5-2608-4d51-9581-ee866952bf68', 'fashion', 'unisex'), -- 8500 only
  ('7d321fab-b9e0-4b3a-af3b-9cda428eefb3', 'fashion', 'unisex'), -- Adidas Slide Sandals
  ('3826f9fa-32e1-4249-801b-f5784ed346b4', 'fashion', 'unisex'), -- Adult Christmas Pajamas
  ('505f1ba3-7778-4c4f-9aae-21ecbb5b6b3a', 'fashion', 'unisex'), -- Alphabet Pendant with Chain
  ('e1f6fd8d-eca7-436a-8065-db61bed3b363', 'fashion', 'unisex'), -- Alphabet Pendant with Leather Cord
  ('02882ac6-240a-4452-81f0-32dd6d68d0d0', 'fashion', 'unisex'), -- Anime Merchandise
  ('6d567c00-2816-42be-ba1d-66a65485cac9', 'fashion', 'unisex'), -- Another Colour
  ('9d9922a5-12ce-4711-bbdb-ff3f81fbaf66', 'fashion', 'unisex'), -- Another Colour
  ('19b6373e-acf2-40c7-8780-0bf32a62e8b3', 'fashion', 'unisex'), -- Arsenal Emirates Jersey
  ('0aaec570-8287-4b47-b2aa-85586013904b', 'fashion', 'unisex'), -- ASH 14500
  ('0fda0a53-e681-4204-9d2f-ad6f404ecd3e', 'fashion', 'unisex'), -- Available in Brown and wine only no black oh (was other)
  ('89edf3c2-9be6-47ee-88c9-86f62be0a45f', 'fashion', 'unisex'), -- Available in Brown, black, pink only. (was other)
  ('ab1c52e6-c806-43f3-b597-766274a4155b', 'fashion', 'unisex'), -- Birkenstock Arizona Sandals - Black, Brown & Grey
  ('29f2a239-c6af-4eee-ace7-4e2ff3c76867', 'fashion', 'unisex'), -- BLACK 15600
  ('07d09f98-6841-444e-8952-5daa629b0e71', 'fashion', 'unisex'), -- Black 40
  ('d9ebfe45-5497-4fb8-9f5e-0d35755e83b7', 'fashion', 'unisex'), -- Black and White King 66 Sports Jersey
  ('9bcc41af-dda9-4953-a4e5-05435be871c3', 'fashion', 'unisex'), -- Black and White King 66 Sports Jersey
  ('1e100050-06b2-465c-872d-0e14b10195c0', 'fashion', 'unisex'), -- Black Corecry Polo Sweatshirt
  ('b6fe7a16-532e-4e21-9063-716cd4f94e92', 'fashion', 'unisex'), -- Black Coreevry Polo Sweatshirt
  ('9cfe78bb-3fe5-4fe3-83b3-1b69cf82b0b8', 'fashion', 'unisex'), -- Black Cross Pendant Necklace with Engraved Prayer
  ('aa025b4c-1b11-4807-b88f-9aeebbae5d61', 'fashion', 'unisex'), -- Black Spider Graphic Fleece Sweatshirt
  ('45f7d773-146e-4e7e-9a5d-74d16ee710b8', 'fashion', 'unisex'), -- California 23 College Style Jersey T-Shirt
  ('701d6043-7e8e-4542-ac2e-d5309cb253a8', 'fashion', 'unisex'), -- Chrome Heart Glasses
  ('946d029a-97a0-48fc-b680-8f37aa70e1d2', 'fashion', 'unisex'), -- Classic Sweatshirts
  ('426062a9-8d90-43f5-ac25-ebfbcfd70cda', 'fashion', 'unisex'), -- Couple Wristwatch for Him & Her
  ('d9f1bf4a-93d6-43f9-a135-3cc45aae09bd', 'fashion', 'unisex'), -- Cross Body Bags in Various Colours
  ('daffc247-d086-4825-bda3-47a7e801ec5b', 'fashion', 'unisex'), -- Custom Ash 18 Jersey T-Shirt
  ('a8b05c05-a2a5-41e0-8e95-185ce6fd5166', 'fashion', 'unisex'), -- Custom Bead Collection
  ('27bf5dad-86e2-4782-b012-29ca90f71335', 'fashion', 'unisex'), -- each
  ('5ad0ce39-e43f-41f5-b399-1f87161a2187', 'fashion', 'unisex'), -- EXTRI Square Analog-Digital Watch (Red, Blue & Green)
  ('10a6a6f4-3920-40da-a703-4032e036177a', 'fashion', 'unisex'), -- Extri Square Analog-Digital Watch with Green Strap
  ('6eeeeb2e-5ef7-4425-9c4c-285d6e8b93ce', 'fashion', 'unisex'), -- Fitted high-necked ribbed knitted top
  ('1d24853c-dc9c-4524-b412-7c838ded2027', 'fashion', 'unisex'), -- GRAPHI TEE
  ('81747b45-6270-4a32-8ce8-c2ef0e65aeb0', 'fashion', 'unisex'), -- Graphic Tee - New Collection
  ('8c0e19f8-956e-4273-97c2-fe58564e7da2', 'fashion', 'unisex'), -- Handmade Gift Items (was other)
  ('032688df-2abf-4161-ad95-0837b8c8db50', 'fashion', 'unisex'), -- Heart-Shaped Keychain
  ('730858e0-8433-403b-ae9d-317516ddeb38', 'fashion', 'unisex'), -- High Quality Poedagar His & Hers Chain
  ('dd9968f8-b834-4ed5-abce-3846ceda3145', 'fashion', 'unisex'), -- High Quality Sweatshirts
  ('f52e599b-a14b-47a9-889e-1cc1fab12e85', 'fashion', 'unisex'), -- High Quality Sweatshirts
  ('807d4628-6b73-4f67-862d-1c856c391095', 'fashion', 'unisex'), -- High Quality Sweatshirts
  ('9a63b360-9f05-4e46-8e0b-4daef38b6328', 'fashion', 'unisex'), -- High Quality Sweatshirts
  ('27345b76-9ecb-49b3-80c6-fb7cd4bdb434', 'fashion', 'unisex'), -- High Quality Thick Vest
  ('d688482e-6a41-4cd7-ab9e-9ed099b98906', 'fashion', 'unisex'), -- High Quality Thick Vest
  ('5c3c252d-9fa6-444f-a70a-155563722e34', 'fashion', 'unisex'), -- High Quality Unisex Pinstripe Jersey Shirt
  ('d895dba1-7033-448b-a641-495448c48bec', 'fashion', 'unisex'), -- Jersey
  ('7bbec0d3-7741-4bcf-9fdd-f04277cc7757', 'fashion', 'unisex'), -- Konvesdy Striped T-Shirt
  ('af65a25d-5ade-4f9d-8269-bbb68204a02b', 'fashion', 'unisex'), -- Konvesdy Striped T-Shirt
  ('33dfc99c-450f-418c-9874-81de8871756c', 'fashion', 'unisex'), -- KONVSKDY Black and White Striped T-Shirt
  ('d27a0bc3-08f6-4406-98a3-12aefc445cd3', 'fashion', 'unisex'), -- KONVSKDY Black and White Striped T-Shirt
  ('db8bc6ea-9018-4d4a-a69b-ef0e182eecb2', 'fashion', 'unisex'), -- Louis Vuitton Monogram Double Buckle Slide Sandals
  ('8b641804-b83d-409c-b17b-5a9c56fbf09b', 'fashion', 'unisex'), -- Luxury Baggy Jeans
  ('e2a49c8a-51c1-4176-ab47-4da9ef2fde52', 'fashion', 'unisex'), -- Men's & Women's Casual Striped Crew Neck T-Shirt
  ('36ec9f10-9fe9-4e57-9acd-9ef174de9260', 'fashion', 'unisex'), -- Men's & Women's Casual Striped Crew Neck T-Shirt
  ('8a14021b-04fe-4178-adfe-d8e542bd2c56', 'fashion', 'unisex'), -- MNMK Graphic Short-Sleeved T-Shirt (Black & White)
  ('156fb27d-53cf-404b-a687-1a8c995c2fb3', 'fashion', 'unisex'), -- Mr Dream Chasin Oversized V-Neck Top
  ('37059409-85ef-4c35-b872-518d7699ad0c', 'fashion', 'unisex'), -- NY Yankees Logo Sneakers (Beige, Black & Gold Variants)
  ('2a60ad27-9031-4013-9be9-eb1e5a1caee4', 'fashion', 'unisex'), -- Plaster Rubber Shoes (Pink, White, Blue/Brown)
  ('859c8405-1d11-4fa1-aadc-0635d8321e7f', 'fashion', 'unisex'), -- Premium Luxury Jacket
  ('77329d5c-71a6-40df-8381-7b8b6039f9c6', 'fashion', 'unisex'), -- Quality Shoes Size 37 - 43
  ('8b66b65c-2d69-4427-a06d-4338a61128b8', 'fashion', 'unisex'), -- Quality Shorts
  ('51358da3-8036-4b35-b143-41c7ac066640', 'fashion', 'unisex'), -- Quality T-Shirts
  ('4af4681f-d344-4e73-b973-4ecdb650fa2a', 'fashion', 'unisex'), -- Red Shoes Size 40
  ('3438ffd6-26fd-4a80-9097-46a0d42bc494', 'fashion', 'unisex'), -- Set of 2 Items (was other)
  ('9b8747dc-4f9c-4397-b7ed-7c4073dbe1d9', 'fashion', 'unisex'), -- Stock 38-43
  ('645cbe82-fc45-4ad5-aec9-3c020f68ceb8', 'fashion', 'unisex'), -- Two Piece Collar T-Shirt and Sweatshirt Set
  ('7cc52e7f-0e61-442e-8da9-ebddbb54d76e', 'fashion', 'unisex'), -- Two Piece Collar T-Shirt and Sweatshirt Set
  ('bf78eb6b-36e5-4912-8d2e-7a2e0f116f4a', 'fashion', 'unisex'), -- Umbrella (was beauty)
  ('498b6467-923e-4a63-8fff-a1547fec7981', 'fashion', 'unisex'), -- Unisex Polo
  ('1c35a660-59aa-42ea-a26c-487b6789fcf4', 'fashion', 'unisex'), -- Unisex Steel Chain
  ('e837e19a-0043-4a08-bb38-a2998dcdee0a', 'fashion', 'unisex'), -- Unisex Steel Chain
  ('d128b774-88c3-4970-a887-d57caadc36a3', 'fashion', 'unisex'), -- Unisex Up and Down Shoes
  ('e2031027-a4b1-469c-8ab0-ddabbf88a2d9', 'fashion', 'unisex'), -- Unisex Vintage Shirts
  ('82ac5639-3cf5-4410-bf7d-a95efc0ca0fb', 'fashion', 'unisex'), -- Unspecified Item
  ('df5ab698-29b9-4bdd-b72a-5327be61ec44', 'fashion', 'unisex'), -- Unspecified item (2 pcs)
  ('417af6c9-2dc1-4a4b-8e6f-cb218365aabd', 'fashion', 'unisex'), -- Unusual Original 23 Baseball Jacket
  ('2885e993-0513-475b-85d3-edd9a541ec8e', 'fashion', 'unisex'), -- Unusual Original 23 Baseball Jacket
  ('808aa507-c1a7-49c7-94ab-28e0a9fe2b25', 'fashion', 'unisex'), -- Versatile Fashion Pants Chain, High-End Stylish Trendy Acces
  ('8cafe127-444b-4d95-8c04-aed66f12f069', 'fashion', 'unisex'), -- Watch and Bracelet Bead Set
  ('2cf5ff97-1109-45c8-b3b5-1a09d2155c22', 'fashion', 'unisex'), -- White & Brown Printed Sweatpants
  ('3e93023b-6262-4cfa-b5bd-f4f670174edd', 'fashion', 'unisex'), -- White Up and Down Shoes
  ('b284703a-4dae-4537-a17e-7d34a010d72d', 'fashion', 'unisex'), -- White, brown available only (was other)
  ('0e312bd5-755c-4495-ab0e-60f2e7cd71d0', 'fashion', 'women'), -- promo (was other)
  ('e85a0fc2-f389-47c4-9420-1e73bf97d9ce', 'fashion', 'women'), -- Small size (was other)
  ('2ff801a1-924b-4d16-bd52-ec06cc7fb1ef', 'fashion', 'women'), -- up nd down
  ('52cb2d89-1043-4743-b16c-a86509e438ae', 'fashion', 'women'), -- ANNOUNCEMENT
  ('2fe039d8-ecad-45ef-bee9-b5c8d13b9bb6', 'fashion', 'women'), -- 17000 boxed
  ('64bf23ef-77de-4fb5-82ee-33f48ceb60e8', 'fashion', 'women'), -- 19000 boxed
  ('1546678b-f729-4578-86d7-903bb8115437', 'fashion', 'women'), -- 19000 boxed
  ('0cbede9c-065e-4165-ad49-e1d28d3a1989', 'fashion', 'women'), -- 2 pcs (unspecified item)
  ('27076ab6-febd-4072-87ee-bf145d1e3a7d', 'fashion', 'women'), -- 2 pcs item
  ('14602aae-322d-4a44-bbe1-d693e453eaba', 'fashion', 'women'), -- 2 pcs item
  ('bfd144a7-ce47-499b-818a-a633ba34aec5', 'fashion', 'women'), -- 2 Pcs Peak Milk
  ('51df9779-350d-4169-ab2b-bb3c37f75b63', 'fashion', 'women'), -- 2 Pcs Set (L, XL, XXL)
  ('6615652a-306b-424c-a609-677b118cc57e', 'fashion', 'women'), -- 2 Pcs Set (Sizes S, M, L)
  ('1cab008e-297c-4ffa-9a3f-9c455d085369', 'fashion', 'women'), -- 2 Pcs Set (Sizes S, M, L)
  ('46d8e88d-c5a2-488a-9db7-720f8d0a9036', 'fashion', 'women'), -- 2 Pcs Set (Sizes S, M, L)
  ('f943868d-e615-422d-8395-d95885da1a21', 'fashion', 'women'), -- 2 Pcs Set (Sizes S, M, L)
  ('b041f5c3-e46a-4cdb-ae05-6b3b35634656', 'fashion', 'women'), -- 2 Pieces
  ('2316d096-dd55-47d4-90d7-7f76453c8031', 'fashion', 'women'), -- 2 Pieces
  ('731293c3-cd86-4d90-b513-9246caf13290', 'fashion', 'women'), -- 2 Pieces
  ('997f30ec-7bfb-4cad-abd7-50177eb5a0a7', 'fashion', 'women'), -- 2 Pieces
  ('9d16d49d-4e06-4ac1-a7fb-3f7d0644f3fe', 'fashion', 'women'), -- 2 Pieces
  ('3b37a65b-ddaf-45ee-8d02-5bb83c2f620a', 'fashion', 'women'), -- 2 Pieces
  ('2506a4d4-f4b0-482c-b851-3f3e0b601c67', 'fashion', 'women'), -- 2 Pieces
  ('b130d076-4b82-4d93-9b82-57702b95d08d', 'fashion', 'women'), -- 2 Pieces
  ('20699cb0-9c22-44be-99b4-7dd91a32aab1', 'fashion', 'women'), -- 2 Pieces
  ('dbbdb084-8047-4aed-ac92-ee6c2b4ad4bb', 'fashion', 'women'), -- 2 Pieces
  ('2967ea42-69cc-4d3f-aa3d-1f54028bc2bd', 'fashion', 'women'), -- 2 Pieces
  ('1fd9e7bd-d7e0-4a0b-a116-3875874f072d', 'fashion', 'women'), -- 2 Pieces of Product
  ('06f51b61-6758-49e0-a43a-c0bcd14610fa', 'fashion', 'women'), -- 2 Pieces of Product
  ('fd6688b0-6fc2-4a83-ac6b-d0872ec26a1a', 'fashion', 'women'), -- 2 Pieces of Unspecified Item
  ('86928888-da09-44e0-9ee6-d1df63a9337c', 'fashion', 'women'), -- 2 Pieces of Unspecified Item
  ('9235b902-e697-4a98-bc57-c2c9289048da', 'fashion', 'women'), -- 2 Pieces of Unspecified Item
  ('0416c9ba-2dfd-4c0d-8a30-d62deb3bf987', 'fashion', 'women'), -- 2-in-1 Chrisrosy Bag
  ('9f862660-4c93-443c-88d5-77cccb3b0bb1', 'fashion', 'women'), -- 2-in-1 Device (was electronics)
  ('51ba8485-c26b-44f6-a008-927403596684', 'fashion', 'women'), -- 2-in-1 Device (was electronics)
  ('98a464f0-d6e9-4486-8a5f-b1aeb5f1bf11', 'fashion', 'women'), -- 2-in-1 Device (was electronics)
  ('4e547b13-10e2-461d-8853-b87ace85e1e0', 'fashion', 'women'), -- 2-in-1 Device (was electronics)
  ('a13d4b54-8257-4b69-b5c0-e9d4c60c468c', 'fashion', 'women'), -- 2-in-1 Device (was electronics)
  ('75a32e37-ac65-4be7-9945-291b01219f89', 'fashion', 'women'), -- 2-in-1 Device (was electronics)
  ('9e9e38a8-d10e-4da6-92b5-c2ced1792840', 'fashion', 'women'), -- 2-in-1 Device (was electronics)
  ('5d8c4990-3bb5-447a-90c8-b786d34d4a9b', 'fashion', 'women'), -- 2-in-1 Product
  ('dfea4288-e52e-4780-b485-47ca5fa87226', 'fashion', 'women'), -- 2-in-1 Product
  ('3ec28ee3-8671-4ffb-9cc6-73bb78ef7f0a', 'fashion', 'women'), -- 21cm boxed item
  ('2ad1ad90-e052-4a4f-a11c-a90f06526539', 'fashion', 'women'), -- 2500 each Dozen 19500 by 12pcs (was other)
  ('722ee4a6-45ed-42be-a29a-a135f16d741e', 'fashion', 'women'), -- 2in1.18500
  ('3400b3fa-78bd-4957-9637-087db4efb0e9', 'fashion', 'women'), -- 2in1.21500
  ('988f8246-c2d2-4b47-9ee7-2aad54d2f567', 'fashion', 'women'), -- 2pcs
  ('c48394d7-3c6f-4b89-b585-d2bf5c7b1cfe', 'fashion', 'women'), -- 2pcs Long Strap
  ('15f146e8-1685-47ee-a490-972a6b9b31b6', 'fashion', 'women'), -- 2pcs Set Mesh Top
  ('313e31f3-d952-4b8d-929b-da30eb5f64d7', 'fashion', 'women'), -- 3 in 1 (was electronics)
  ('d2cb1f18-e202-474a-b179-7a17e5061915', 'fashion', 'women'), -- 3 in 1 Bundle
  ('ab14b5f4-22c0-4941-aea7-4d0294411c9e', 'fashion', 'women'), -- 3 in 1 Kora Bag (Black)
  ('4388f12c-3628-4949-8aa6-d6f26fc48471', 'fashion', 'women'), -- 3 piece jewelry set
  ('9f858e60-4eea-4eb0-8741-6487508f180f', 'fashion', 'women'), -- 3 piece jewelry set
  ('0b3dd632-c481-44b9-bbb0-81eda0fd9164', 'fashion', 'women'), -- 3-in-1 Corporate Wear Set (Black & White)
  ('6d2bfb99-bf3f-452f-af1d-360505ac7a0f', 'fashion', 'women'), -- 37 to 42 20500 (was other)
  ('83dcf5b9-7338-469c-a0e6-2727b9e35f1b', 'fashion', 'women'), -- 37 to 42 slashed (was other)
  ('785b7570-a36c-437c-8bf4-f38642fe9b44', 'fashion', 'women'), -- 37-71 Available on displayed colours
  ('555cc860-58b7-45e0-aa0a-a4fe03639ad3', 'fashion', 'women'), -- 7500
  ('5fdf6040-8c01-490d-83e9-2ad246463190', 'fashion', 'women'), -- 9500 promo (was other)
  ('d6b6d5d9-c2b0-4c6e-b11b-2645906fb087', 'fashion', 'women'), -- AGU Fashion Pearl-Embellished Two-Piece Set
  ('d24b8760-a48e-41d1-af77-3714559515e5', 'fashion', 'women'), -- Aisy Zebra Print Maxi Dress
  ('d6895fc5-d509-45d4-8477-0bdc7057b5c4', 'fashion', 'women'), -- Alatio Women's Patent Leather Flat Sandals (Black & Burgundy
  ('341efa30-fecd-4b73-b4db-cb4183ed4816', 'fashion', 'women'), -- Allo & Miuu Leggings Set
  ('997931d5-3efe-4799-b700-819e8d39191e', 'fashion', 'women'), -- Alo Leggings
  ('711c9c45-6b37-4205-b158-eac7e07c135a', 'fashion', 'women'), -- Alo Yoga Crop Top T-Shirt
  ('12eb0f6f-755b-4fd0-8923-6c67af8fa23f', 'fashion', 'women'), -- Ami Bag - All Colors Available
  ('4ac2c90a-d739-4845-a48c-a188632a15ae', 'fashion', 'women'), -- Animal Skin Gown
  ('dd5a67c7-db4c-4b6b-89a4-a0c0e2192e21', 'fashion', 'women'), -- Are you looking for cute tops, classy outfits, fine shoes, b
  ('0e11e43b-9d03-4bab-8d33-4da60da98261', 'fashion', 'women'), -- Assorted Color Shoes Sizes 37 to 40
  ('08c5d61d-9347-4230-b072-be36609242d2', 'fashion', 'women'), -- Assorted Item (2 pcs)
  ('e7a48a95-9b32-49fe-a3bf-8cf82f5ca34f', 'fashion', 'women'), -- Assorted items (2 pcs)
  ('b4bd42a4-093e-483a-b1d4-3882c129424b', 'fashion', 'women'), -- Aura Tote Bag - Black
  ('39bbcfc0-3638-4217-a672-a0e077c11762', 'fashion', 'women'), -- Available in Colors
  ('4eb98714-0c82-4f54-8251-02d5714ff841', 'fashion', 'women'), -- Available in colors
  ('59048803-1520-4655-b1d5-f48a62f0c187', 'fashion', 'women'), -- Awoof Shoes Size 37-42
  ('5164910c-aff1-4e24-88e0-00fb54d1c469', 'fashion', 'women'), -- Baby Romper
  ('4e21c0ef-bd32-441b-b5ee-e3b5d8960139', 'fashion', 'women'), -- Bag and Cap Combo
  ('d594fe34-5168-456d-9e64-40e99f9d65a4', 'fashion', 'women'), -- Bag With Long Strap
  ('dab48d62-7c4b-4a9c-abff-65dfdd266505', 'fashion', 'women'), -- Balenciaga Quilted Chain Shoulder Bag
  ('80eacb2d-6321-437a-97f6-73e2fa47c59a', 'fashion', 'women'), -- Basic top
  ('07db2e02-61b1-459b-9e5a-6204649a6734', 'fashion', 'women'), -- Basic Top
  ('1c06cc1c-c898-4e44-a4b4-0190cbdcff80', 'fashion', 'women'), -- Basic Top (Set of 4)
  ('0fe608c2-a200-4590-ae6d-6d79580692e9', 'fashion', 'women'), -- Basic Top & Cooperate Trouser
  ('1586fbdf-c072-4892-af70-0f955bfe5dff', 'fashion', 'women'), -- Beach wear
  ('984d1a26-ce66-484e-9fa4-d813a8ee3534', 'fashion', 'women'), -- Beautiful Pearl Set
  ('d7b56dd4-0147-4e6d-a9ce-83eb45264669', 'fashion', 'women'), -- Beige 2-in-1 Leather Handbag & Wallet Set
  ('77f3d8cd-16ca-47b5-b7b8-970dfff2a624', 'fashion', 'women'), -- Best seller (was other)
  ('fa1da0c7-a2df-4dee-ab82-d7552d8e747d', 'fashion', 'women'), -- Best seller landed
  ('8e423f17-a23f-4b08-b5b7-025146995f17', 'fashion', 'women'), -- Best seller landed
  ('925399d0-a4cf-4043-acac-f09e11b7d0f9', 'fashion', 'women'), -- Best seller landed (was other)
  ('7af50ce4-c64e-4e5e-944b-98afb332fe86', 'fashion', 'women'), -- Bijou For You Multicolour Crystal Necklace & Earrings Set
  ('57c6cef8-7c75-49ca-a484-b6b6f2c5ee1c', 'fashion', 'women'), -- Black & Pink Cut-Out Two Piece Gown
  ('54844d9b-133b-4fb0-8d8f-415b4e70f9b9', 'fashion', 'women'), -- Black & Pink Floral Embroidered Bodycon Dress
  ('25ee89c2-26e0-4fd3-9c09-dc00a29a26c8', 'fashion', 'women'), -- Black & White Polka Dot Two-Piece Set
  ('010dfb0c-f59e-461f-b860-363dad3e8a96', 'fashion', 'women'), -- Black & White Rhinestone Sweatpants
  ('5f417e34-12fc-4ee5-8924-a6926438d7e2', 'fashion', 'women'), -- Black 15500
  ('fa89d5d8-1963-4aaa-9249-25e04f196a8c', 'fashion', 'women'), -- Black and Pink Watches
  ('885ce2f7-b799-496e-9d28-a73bc5b15a20', 'fashion', 'women'), -- Black and White Floral Lace Jumpsuit
  ('b586afb8-5b48-488e-95d3-e4c136f5f614', 'fashion', 'women'), -- Black and White Product
  ('f1c66f7b-7195-4bb6-9713-3055f7de080e', 'fashion', 'women'), -- Black and White Striped Wide Leg Trousers
  ('8c83178a-3ab6-4775-958b-e4c14d6126c2', 'fashion', 'women'), -- Black blue nude
  ('e1dacd3a-b5ee-49db-8b7d-573a135812a0', 'fashion', 'women'), -- Black Checkered Leather Handbag
  ('5394438e-5517-4118-9038-1d04a5201b40', 'fashion', 'women'), -- Black Denim Skort with Purple Logo Embroidery
  ('5e2bab0b-695c-4070-86f8-5e8687a2c4a2', 'fashion', 'women'), -- Black Halter Top with Brown Houndstooth Skirt
  ('66ac017f-36d1-4420-bbf0-607b456f7a0d', 'fashion', 'women'), -- Black High-Waist Seamless Shorts
  ('aff0d0f3-115f-440b-b9dc-ccb721c15f8a', 'fashion', 'women'), -- Black Long Island City 74 Ringer T-Shirt
  ('8c33d5e1-4c2a-427a-ba98-28f3471977b2', 'fashion', 'women'), -- Black Patent Leather Bow Shoes Size 38
  ('3a7289fe-0063-4ddf-995c-8aa6ae7b563f', 'fashion', 'women'), -- Black Patent Leather Pointed-Toe High Heels
  ('50609a47-5f4c-455e-91a2-d59ed3352e9d', 'fashion', 'women'), -- Black Play Tote Bag
  ('38bae838-fd33-4303-9f86-dd93714d797b', 'fashion', 'women'), -- Black Polka Dot 2-Piece Co-ord Set
  ('10974eed-ca82-4241-b4db-3e896790778b', 'fashion', 'women'), -- Black Polo Ralph Lauren Tracksuit Set
  ('d4110222-0ba4-47f0-a149-7ba75253457f', 'fashion', 'women'), -- Black Polo Zip-Up Tracksuit Set
  ('c9996cac-f31e-4af8-8ba7-101e3975ff08', 'fashion', 'women'), -- Black Ribbed Tank Top
  ('d9ac3c61-aace-42dc-b62b-60dfa2c0413c', 'fashion', 'women'), -- Black Satin Rhinestone Bow Mule Heels
  ('b37c84d1-6bb7-43ce-97e5-88560b284de0', 'fashion', 'women'), -- Black Sequined Halter Mini Dress
  ('b5e5a966-824a-4814-ab41-06c88b3944cb', 'fashion', 'women'), -- Black Sheer Mesh Long Sleeve Dress
  ('61666801-a5e9-48dc-aafe-3ed4d4cde5cd', 'fashion', 'women'), -- Black Shoes Size 37 & 38
  ('067188ff-7e7d-4aa9-9bae-a5c70f726de2', 'fashion', 'women'), -- Black Shoes Size 38
  ('b691a2c4-2d5a-4875-8c74-fba627e7faf5', 'fashion', 'women'), -- Black Short Sleeve Bodycon Midi Gown
  ('c9dcca44-9903-47f3-bc42-445a29c846d3', 'fashion', 'women'), -- Black Size 39 Shoes
  ('0e1c618d-7d44-4506-97aa-9f4c0a5e7c39', 'fashion', 'women'), -- Black Strappy High Heel Sandals
  ('8ef35ef7-e644-44dc-b62f-f745d929ce2d', 'fashion', 'women'), -- Black Wine Gold
  ('36d144a6-2e8a-4540-ae4d-877a6c6babd9', 'fashion', 'women'), -- Black Wine Gold
  ('746f44d4-8e81-4c72-a679-e606312c3d2f', 'fashion', 'women'), -- Black, Red & Brown Shoes (Sizes 37-42)
  ('d5e5cc9a-f362-4f2a-87b9-921b90cddfa8', 'fashion', 'women'), -- Blue 'I Regret Them' Graphic Crop Top
  ('4af5d613-7118-4b9e-9cf8-e2daacf80bd1', 'fashion', 'women'), -- Blue & Yellow Hockey Jersey Dress
  ('b411123c-8989-4aa2-a342-5db8317fc32c', 'fashion', 'women'), -- Blue and Red Two-Piece Co-ord Set
  ('0400fb23-9fc6-449d-82f4-7340509ee6ce', 'fashion', 'women'), -- Blue and White Striped Wide Leg Trousers
  ('98241952-ff0b-4449-8c1a-2c668bc4e067', 'fashion', 'women'), -- Blue Bubu Gown with Lace Trim
  ('96eb9ab8-51ac-4cb5-b4c1-19cca7b12f68', 'fashion', 'women'), -- Blue Gift Set with Watch, Beads & Heart Pendant
  ('ee36f961-934c-44b9-8711-d50d32dcb4b7', 'fashion', 'women'), -- Blue Lace-Trimmed Long Sleeve Maxi Dress
  ('6368ba58-f070-43c0-95a2-3850079c97ce', 'fashion', 'women'), -- Blue Leopard Print Ruffle Dress
  ('09f71754-24b8-433c-b45c-bb2b7b77b4fc', 'fashion', 'women'), -- Blue Ribbed Tank Top
  ('a4324ab2-9ea9-4b5a-bcd9-63e2098056da', 'fashion', 'women'), -- Blue Ruched Bodycon Dress with Cutouts
  ('f675e61b-6eb2-4a20-a65b-a75a39f2fe31', 'fashion', 'women'), -- Blue Striped Shirt and Shorts Set
  ('eab6c504-c058-4536-98ff-89eeb1358a20', 'fashion', 'women'), -- Blue Two-Piece Fashion Set with Flared Sleeves
  ('abf8f701-df11-4d52-bda9-4cb7f4bd4c8d', 'fashion', 'women'), -- Blue Zip-Up Tracksuit with Red Waistband
  ('0f874442-cbb0-4b63-b772-19db500ef2dd', 'fashion', 'women'), -- Bold Statement Earrings
  ('14b80a9f-0c20-442d-9ce3-b764fe9269c7', 'fashion', 'women'), -- Booty Shorts (Dozen Pack)
  ('7ef73b12-1a66-4886-8bc2-4b2926424008', 'fashion', 'women'), -- Bow Jewellery Set
  ('3c7f609a-1b20-48ce-9d7e-07605a44ba60', 'fashion', 'women'), -- Bowie 1974 Graphic T-Shirt
  ('8f71170b-60d5-4758-84d8-c0bb892aa64c', 'fashion', 'women'), -- boxed (was other)
  ('ab8ad8ca-02bf-442a-8fb9-56cd0e21986e', 'fashion', 'women'), -- Boxed
  ('08c95958-9b37-4323-85a8-4a9d9a966fd8', 'fashion', 'women'), -- Boxed Item
  ('62d45052-0f36-4274-b898-30d93b381022', 'fashion', 'women'), -- Boxed Item
  ('40c2bb14-c9d2-49aa-9c68-3bc3b68878c6', 'fashion', 'women'), -- Boxed Item
  ('668682bb-c5bb-4094-8c01-ea2a10bd83e2', 'fashion', 'women'), -- Boxed Item
  ('7043a793-666c-4e57-a7b0-93d21072c837', 'fashion', 'women'), -- Boxed Item
  ('6bad2973-4f65-4204-a002-5e205d2e4102', 'fashion', 'women'), -- Boxed Item
  ('e6191575-065f-4df7-8e14-329025e53ff5', 'fashion', 'women'), -- Boxed Item
  ('2ffc648d-60dd-4177-9ba7-332a45bfb2da', 'fashion', 'women'), -- Boxed item for sale
  ('86d1e70d-2f8e-421f-a71b-9f61fd956de2', 'fashion', 'women'), -- Boxed Item for Sale
  ('ac250a29-93d1-4b89-9f18-4a60699a9f96', 'fashion', 'women'), -- Boxed Item for Sale
  ('cb627471-f20e-406b-a700-8fd08971b783', 'fashion', 'women'), -- Boxed Product
  ('6fdae32d-ee1b-4aa7-891b-32afc561604e', 'fashion', 'women'), -- Boxed Product
  ('b8f0baf4-f06b-4ed7-837d-7f0439fad7be', 'fashion', 'women'), -- Boxed Product
  ('74d3e438-d858-4db1-81e1-52f928b0f54d', 'fashion', 'women'), -- Boxed Product
  ('4d043005-9df1-4e31-8206-3046d15c72de', 'fashion', 'women'), -- Bracelet
  ('765229e9-b3fa-4510-9246-c8282a816e49', 'fashion', 'women'), -- Brown & White Striped Bodycon Dress
  ('83109af9-2d85-4e70-bbc0-cc9cba37fed0', 'fashion', 'women'), -- Brown Leather Shoes (Sizes 38-42)
  ('5e3fa0d7-5ee9-4d71-9cdc-0667aca25b22', 'fashion', 'women'), -- Brown Monogram Canvas Tote Bag
  ('cc161851-8452-4a82-a319-07ccb7224be8', 'fashion', 'women'), -- Brown One-Shoulder Crop Top and Skirt Set
  ('f5b43826-5e11-4210-8065-b1e2c14331e5', 'fashion', 'women'), -- Brown Patterned Knitted Polo Dress
  ('5f236395-9edd-49cf-8a15-ed630968a65e', 'fashion', 'women'), -- Brown Patterned Knitted Polo Romper
  ('8a42ae98-3e8a-4687-91ae-6d057cfad777', 'fashion', 'women'), -- Brown Polo Zip-Up Tracksuit Set
  ('1ebb0cf2-5c0e-4889-882f-f59b61dc78fc', 'fashion', 'women'), -- Brown Ruched High-Neck Dress
  ('d578e5a0-6c62-4da5-95cd-855c53451f29', 'fashion', 'women'), -- Brown Top and Leopard Print Skirt Set
  ('11aef8ac-a689-4b2d-9c16-282448c7a740', 'fashion', 'women'), -- Brown Women's Button-Down Shirt
  ('3c669da9-3096-480b-9cfa-8c2d28ce4ebe', 'fashion', 'women'), -- Brown, Black, or Dark Blue Item
  ('c795e279-b52e-4708-9252-a95f68272653', 'fashion', 'women'), -- Bubu Gown
  ('2a809945-93ec-4e67-ba12-e901b6f4d67d', 'fashion', 'women'), -- Bubu Gown & Unisex Crocs
  ('52bb75e0-01f9-4b54-a59b-a92a286325c2', 'fashion', 'women'), -- Burberry Check Asymmetric Shirt Set
  ('4ff8b845-1df8-4b53-ade6-b5d27ad854d8', 'fashion', 'women'), -- Butterfly Bra
  ('8c544d7a-a77b-4aca-9a9f-3c46dc750672', 'fashion', 'women'), -- Butterfly Earrings
  ('7267ad81-0435-40e1-92d5-49ee8eec5e1f', 'fashion', 'women'), -- C Twist Bag in Black and Nude
  ('b1b9ad0b-28c8-4f91-8a38-7241d86f4007', 'fashion', 'women'), -- Capri Pants
  ('06037879-3659-42b9-bdcd-2d7dd0c3150d', 'fashion', 'women'), -- Cassy Closet Beige Short-Sleeve Jumpsuit
  ('3cc9d6bd-ab03-4122-bfde-3bcb0e15ce7d', 'fashion', 'women'), -- Celine Triomphe Bucket Bag
  ('462de07e-b1ec-4878-a5ae-4a91b92ff517', 'fashion', 'women'), -- Chain Tote Bag
  ('1ab65722-b7fa-4ee1-b193-38825cb53efa', 'fashion', 'women'), -- Chanel Black Quilted Leather Handbag
  ('935a68a9-ce82-4b80-986d-ad0260ad1189', 'fashion', 'women'), -- Chanel Bubble Slides (Red & Black)
  ('f9b9a821-f0df-4049-bce2-f50b3a639b1e', 'fashion', 'women'), -- Channel bag
  ('6e80beb4-99c4-49d6-a59f-415d46a89ce3', 'fashion', 'women'), -- Channel Bag in Black, Brown, and Red
  ('e60b377c-3eb4-40a4-8ada-008052607d28', 'fashion', 'women'), -- Channel Original Tote Bag
  ('2cc0787f-9648-4bb6-a24d-7ec002567826', 'fashion', 'women'), -- Cherry 2pcs Set (was other)
  ('e2d7e977-a614-41d7-bb86-58ccce4acbc7', 'fashion', 'women'), -- Cherry bags
  ('64948639-7f9b-4296-8c45-3365fa74956f', 'fashion', 'women'), -- Chic 2pcs Set
  ('9d0042da-8707-4b9b-82b4-5fe3f9b1f142', 'fashion', 'women'), -- Chic Tote Bag in Black and Dark Brown
  ('83314ba2-4015-40c9-ad98-83cb523916b9', 'fashion', 'women'), -- Chinese Fashion Co-ord Sets (T1337)
  ('ecac3325-c08e-45b6-bed9-adb654763ae2', 'fashion', 'women'), -- Chinese Fashion Item (S/M/L)
  ('cde87ae0-dd5e-4cdc-99cc-21f9e475b224', 'fashion', 'women'), -- Chinese Product Available in Multiple Colors
  ('69316029-9598-48ad-9002-8364ff87fd7b', 'fashion', 'women'), -- Chinese Satin Tie-Dye Pajama Set
  ('649c514a-6d38-4c50-840b-0ce51b30da10', 'fashion', 'women'), -- Chinese Style Embroidered Kaftan
  ('2ede4a4b-d093-426b-8eb5-15df0d942edb', 'fashion', 'women'), -- Clothing Item (S, M, L)
  ('f34b9a73-a1bd-491b-b44c-6989872747a7', 'fashion', 'women'), -- Clothing Item (Size L & XXL)
  ('847cde37-0e93-4f0b-94d7-d40dbf86b92e', 'fashion', 'women'), -- Clothing Item (Sizes M, L, XL)
  ('fe40733b-6179-48cc-8634-316d8d687ac1', 'fashion', 'women'), -- Clothing Item (Sizes M, L, XL)
  ('5c603a1f-0ca3-425f-bfb7-f0a867360a78', 'fashion', 'women'), -- Clothing Item (Sizes S, M, L)
  ('8dea5405-0438-4138-9b34-f1c2ce513c17', 'fashion', 'women'), -- Clothing Item (Sizes S, M, L)
  ('65ed0b80-706a-4d9e-9024-fcd854e1fb2d', 'fashion', 'women'), -- Clothing Item (Sizes S, M, L)
  ('af749a0b-eab5-4e4f-a5e0-7ea20352e828', 'fashion', 'women'), -- Cloud Tote Bag with Teddy Bear
  ('8c1426c1-b2a9-46b3-8250-ebf4a0bbb550', 'fashion', 'women'), -- Clover Bracelet
  ('dec85c8e-985f-4c90-8332-c5b0c2b4c4a0', 'fashion', 'women'), -- Clover Earrings
  ('928e827c-cb88-4258-9d81-200869aeb5a7', 'fashion', 'women'), -- Clover Full Set (Earrings, Necklace, Bracelet)
  ('1a4e58ac-08ee-4849-9aad-5f86c34deac4', 'fashion', 'women'), -- Clover Jewellery Set
  ('8a039367-54b0-4099-9de6-d3fa14613bb4', 'fashion', 'women'), -- Clover Necklace
  ('b05cedf4-e531-47a6-b07f-8d949d7cf4fb', 'fashion', 'women'), -- Coach Bag Main Quality
  ('b3bc9657-8f77-40d2-9ba2-633358b5c205', 'fashion', 'women'), -- Coach Floral Embroidered Slide Sandals
  ('5e3e1cd8-6261-4fd1-a07c-00c4367c74e9', 'fashion', 'women'), -- Coch Luxury Bag
  ('42c9ef5e-ab2a-4c12-9d84-0936aa5ef7c0', 'fashion', 'women'), -- Coco Tote Bag
  ('f8a795a5-8c94-44bd-83c0-d156251a3bd0', 'fashion', 'women'), -- Combo for Her
  ('aa39514c-3710-4d72-b693-3e7db4e48924', 'fashion', 'women'), -- Cooperate top
  ('ec57cd61-f390-4ec0-9f73-135ce471fba1', 'fashion', 'women'), -- Cooperate Trouser (Discount Price)
  ('44e04b7b-9225-4bf1-988e-64dc448fff20', 'fashion', 'women'), -- Cooperate Trousers
  ('58ab474b-43c8-485e-b2fc-66dc8b0955b1', 'fashion', 'women'), -- Crop top
  ('80a73785-9b74-4beb-b514-8ac138eb0ae4', 'fashion', 'women'), -- Crop top
  ('8c059414-ea63-4598-bff0-cacce066a7ab', 'fashion', 'women'), -- Crystal Drop Earrings
  ('c63607e8-cdbf-46a4-bf71-d0e633842c3d', 'fashion', 'women'), -- Crystal Drop Earrings
  ('7e350363-fe21-486b-9aca-f8bc0739fc66', 'fashion', 'women'), -- Cubic Zirconia Necklace
  ('b87e4763-c2a7-4555-b06d-60963ac6095e', 'fashion', 'women'), -- Cultivator Designer Handbag
  ('147bb7b9-ffe3-4ae5-bb5a-bdb11dd25679', 'fashion', 'women'), -- Curly Gem Earrings
  ('b87ed6ac-e254-4d85-be10-2f38ba256695', 'fashion', 'women'), -- Curly Gem Set Earrings
  ('97312278-a880-47c2-bd63-665a71259488', 'fashion', 'women'), -- Curly Gem Set with Chain
  ('a37f18c9-4c8f-4b58-8c78-0742575e052a', 'fashion', 'women'), -- Daisy Drop Earrings
  ('39235174-7a47-4f83-91f8-41bc647a932f', 'fashion', 'women'), -- Daisy Petal Earrings
  ('e3ec268b-7abb-4418-9acb-7b521f611c80', 'fashion', 'women'), -- Designer Jeans
  ('1c8bf726-baf4-4bb5-85f9-08b4eeda4837', 'fashion', 'women'), -- Designer Patterned Handbags
  ('1f7f12fb-c54d-4785-bae2-7e756731ab5a', 'fashion', 'women'), -- Designer Patterned Tote Bags
  ('0f7330a8-1a56-4526-bf5a-ce1de660eeac', 'fashion', 'women'), -- Designer Style Leather Handbag
  ('af945fcb-95c2-4808-8e05-3126c5513b70', 'fashion', 'women'), -- Designer Style Leather Handbag with Chain Strap
  ('21154470-efb9-4e8b-a666-77688c2cfa74', 'fashion', 'women'), -- Designer Style Top-Handle Handbag
  ('04c87c72-00b8-4e76-be5d-2fae1cbdbf11', 'fashion', 'women'), -- Diamond ring
  ('bb4a04b0-b1b8-44df-b7dd-194ab0012ded', 'fashion', 'women'), -- Dinner Gown
  ('84c6d54b-ece0-454b-bb01-2cd0447204d0', 'fashion', 'women'), -- Discounted Item
  ('8a81fdab-47eb-430a-84ab-8fecaa4cfcb8', 'fashion', 'women'), -- Distressed Butterfly Embroidered Flare Jeans
  ('c06c855f-cdf3-472f-b8c1-c2b458d53161', 'fashion', 'women'), -- Dormer Black Platform Slides with Clear Strap
  ('2e5e100a-53df-4212-93af-c1af40c905f7', 'fashion', 'women'), -- DRD Wears Chocolate Brown Satin Two-Piece Set
  ('b306d7e3-d717-4627-8122-843ee82bae07', 'fashion', 'women'), -- DRD Wears Lime Green Satin Two-Piece Set
  ('65e2b9f0-477f-48b5-b822-dc3b339bbd8c', 'fashion', 'women'), -- DRD Wears Rust Brown Satin Two-Piece Set
  ('1660961a-92df-443a-a75c-6762e82ad33a', 'fashion', 'women'), -- DRD Wears White Floral Maxi Dress with Ruffles
  ('21a4475d-3fa4-4914-8f3b-efbed96dccca', 'fashion', 'women'), -- Elegant Black Cut-Out Bodycon Gown
  ('f9787c1f-c408-4bb6-9c4b-66da71560d9c', 'fashion', 'women'), -- Elegant Black Long Evening Gown
  ('b314d3cb-c938-40c0-828f-2d7f3b6e6551', 'fashion', 'women'), -- Elegant Bodycon Midi Dress in Multiple Colours
  ('0ffa5bbd-2b8f-4d1d-83c9-b47cff6dee61', 'fashion', 'women'), -- Elegant Burgundy Two-Piece Pleated Skirt Set
  ('e3f307ed-14e3-4849-b7fa-c3a957c0b337', 'fashion', 'women'), -- Elegant Button-Down Dress
  ('93c4f246-8149-44f5-bee8-03de461e8047', 'fashion', 'women'), -- Elegant Embroidered 2-Piece Suit Set
  ('7f29804c-a0f2-4da0-b4f6-22128e827caf', 'fashion', 'women'), -- Elegant Gown
  ('12929890-90d4-4659-afb8-ca3a36784c76', 'fashion', 'women'), -- Elegant Gown
  ('074ae759-0b3c-4097-b1a5-edbc1485ef87', 'fashion', 'women'), -- Elegant Gown
  ('03eab3b2-450b-461c-a6a2-f482bd13c647', 'fashion', 'women'), -- Elegant Gown
  ('7f289d35-73c2-4ce8-af2c-89ee6ba22d29', 'fashion', 'women'), -- Elegant Gown
  ('ae9e6037-44b0-4733-bf2f-fa9199a7a2a9', 'fashion', 'women'), -- Elegant Gown (Discounted)
  ('0d888248-ba49-4349-bc8e-26f6873fe260', 'fashion', 'women'), -- Elegant Ladies Gown
  ('337069c3-b740-4ea5-8bcd-df214431c764', 'fashion', 'women'), -- Elegant Ladies Handbag with Gold Hardware
  ('6993dd96-6181-4cb2-9f0c-0336f2ffc662', 'fashion', 'women'), -- Elegant Off-Shoulder Long Sleeve Maxi Dress
  ('66a18e53-282f-436f-af41-878bfc48e24d', 'fashion', 'women'), -- Elegant Off-Shoulder Ruched Maxi Dress
  ('60c5e4db-bad1-4725-8f8d-43149d95e1e1', 'fashion', 'women'), -- Elegant Off-Shoulder Ruched Maxi Dress
  ('9f39ee1b-6ea3-4504-a00b-eedab0f65e97', 'fashion', 'women'), -- Elegant Patent Leather Pointed-Toe Mules
  ('d7771fec-5c33-4c59-9de1-e10f43490324', 'fashion', 'women'), -- Elegant Rhinestone Flat Slides in Gold & Black
  ('0625296c-8a84-4a62-ac58-87c4e90e382d', 'fashion', 'women'), -- Elegant Solid Colour Faux Cover Women's High-Top Knee-High B
  ('0279a25e-64f7-4676-8335-841cea5ba985', 'fashion', 'women'), -- Elegant Women's Gown
  ('5b18fbff-136f-430d-a8f3-379f7a1d1ae2', 'fashion', 'women'), -- Elegant Women's Gown
  ('88c196af-b16c-4cc5-8124-ca90ea306de8', 'fashion', 'women'), -- Elegant Womens Gown
  ('49093094-e0d9-44a0-85ee-1aa1ebfb41cb', 'fashion', 'women'), -- Elegant Women's Pointed-Toe Mules
  ('95f5053f-e0d8-4afd-94a0-33c389e8b9d3', 'fashion', 'women'), -- Emma Collection Leopard Print Bodycon Gown
  ('0fc2c7cd-790d-419f-912c-73ec7f2b4278', 'fashion', 'women'), -- Engraved watch
  ('ee39f340-a21f-4e49-89d0-0d8d56684116', 'fashion', 'women'), -- Fancy Bag
  ('09d0eda7-36e0-4e49-8827-43aa3149349b', 'fashion', 'women'), -- Female Combo
  ('0e31359f-0bfd-48c2-bbb3-7bfe554d3131', 'fashion', 'women'), -- Female fancy slippers
  ('1758183d-01d0-425a-8e03-20cee7aa0a25', 'fashion', 'women'), -- Female Gowns, Beach Wear & Dinner Gowns
  ('89f7e682-8aa5-49e3-828d-03e00d80fbf1', 'fashion', 'women'), -- Female High Stiletto Heels. Pointed Toe Dress sandals with s
  ('97b09392-f620-42c7-9981-b054df772f5a', 'fashion', 'women'), -- Female quality mui mui slippers
  ('0544adf0-e972-4ff6-9205-98449a237ac4', 'fashion', 'women'), -- Female Top
  ('e1881a8b-a6b6-4bee-8dbc-23d2bf51a95e', 'fashion', 'women'), -- Female wrist stack set
  ('e8985823-2535-4a87-94d8-ac75cc107eb6', 'fashion', 'women'), -- Female Wristwatch
  ('06ee1828-9850-46e3-8531-041203a97f80', 'fashion', 'women'), -- Feminine Tops
  ('55cd88af-b172-4e0f-98c9-d2e6d5c70986', 'fashion', 'women'), -- Fendi Logo Chain Shoulder Bag GD-002
  ('6e3f3649-67cb-4384-af05-71df0ad2f3ec', 'fashion', 'women'), -- Flat glasses
  ('6c7e9955-cb76-41e3-b2c1-dc4ec7c23ce1', 'fashion', 'women'), -- Floral & Bow Jewellery Sets
  ('83065ba5-f901-44cd-b799-04aa41cb8c09', 'fashion', 'women'), -- Floral Drop Earrings
  ('3df13f43-c51f-4a63-94e7-6cac1a882406', 'fashion', 'women'), -- Floral Drop Earrings
  ('d79bd644-298a-469f-9b24-e5434066dba7', 'fashion', 'women'), -- Floral Embroidered Denim Bermuda Shorts
  ('79f1c7e6-68bd-40b4-95f9-151ed2831117', 'fashion', 'women'), -- Floral Pearl Handle Handbag
  ('fc3cad0c-37b6-4623-abac-63b16cb38ce1', 'fashion', 'women'), -- Floral Stud Earrings
  ('98370963-b50e-4938-8fc6-67d218f8457b', 'fashion', 'women'), -- Foreign
  ('bd182f8f-c99c-476b-8f66-f3a518aabfbf', 'fashion', 'women'), -- Foreign (was other)
  ('03e978eb-6463-45a1-a485-4b441e0fbcc8', 'fashion', 'women'), -- Foreign Basic Top
  ('8f3c4533-d2bc-4fe7-bc7c-7ae098baf1e0', 'fashion', 'women'), -- Foreign Gown
  ('183cdea8-20a2-422c-a04e-c0dd9e6c52a3', 'fashion', 'women'), -- Foreign item
  ('49f2ae6e-44bd-4759-b514-00f2861fda27', 'fashion', 'women'), -- Foreign quality cherry tote bag
  ('076cf1f7-3e17-417d-958a-cff7e11f7941', 'fashion', 'women'), -- Foreign Quality Cherry Tote Bag
  ('469bf6a9-4b99-47bd-86f2-48d061608e69', 'fashion', 'women'), -- Foreign Quality Cherry Tote Bag
  ('32ccd1a7-a397-47a8-a7be-4d304534f581', 'fashion', 'women'), -- Foreign Top
  ('a9c8cbb7-7872-466e-88ce-47d865ba059f', 'fashion', 'women'), -- Foreign Used Item
  ('81649a03-0999-440b-a031-f7a721087006', 'fashion', 'women'), -- Forever Young Tote Bag
  ('a7faed7a-acf6-4806-8be5-0663c0865eab', 'fashion', 'women'), -- Formula Top Landed
  ('e6134737-12eb-4c45-aa9f-1f2ad2e88de0', 'fashion', 'women'), -- Fringe Handbag with Gold Spiral Handle
  ('6db56683-1883-479d-ba5a-803d488e3332', 'fashion', 'women'), -- Fur bag and hat
  ('d1a23613-3134-4823-9f57-5bd6764be033', 'fashion', 'women'), -- God Things Are Coming Ringer T-Shirt Set
  ('0b382101-f597-423c-9cd0-8668b874bf82', 'fashion', 'women'), -- Gold Emerald Pendant & Diamond Stud Earrings Set
  ('f2b7f37e-c9b2-4beb-80e7-ed3b3fa8058a', 'fashion', 'women'), -- Gold Glitter Rhinestone Bow Mule Heels
  ('6867ec78-c824-4812-862b-399dff08ae4f', 'fashion', 'women'), -- Gold Jewelry
  ('9702154f-7929-4f3b-a15c-5f060cc57b33', 'fashion', 'women'), -- Gold Plated Floral Dangle Earrings and Pendant Set
  ('85223520-9c5b-464d-8ac6-2654f2deec5d', 'fashion', 'women'), -- Gold Plated Spiral Hoop Earrings
  ('f9c36ee1-dddb-48fc-a08a-ee351bfc1f93', 'fashion', 'women'), -- Gold Plated Versace Necklace and Earrings Set
  ('23177e04-689f-47f0-b577-0fd106e000c7', 'fashion', 'women'), -- Gold Starfish Waist Chain
  ('da18d6a1-8bca-4a63-81c4-f347f079d461', 'fashion', 'women'), -- Gold Textured Disc Waist Chain
  ('2e7b74e7-1dff-4713-be92-503466c5da06', 'fashion', 'women'), -- Gold-Plated Fashion Waist Chains
  ('1c0e247e-12ff-42c4-b1fa-f91867b60b3b', 'fashion', 'women'), -- Gown
  ('84a27284-8e8d-463f-86c5-6701ed8ae4ac', 'fashion', 'women'), -- Gown
  ('5cedb906-4b70-48a1-9895-9ccdd039e14c', 'fashion', 'women'), -- Gown
  ('eea1974e-fff5-43de-a645-55d0df897ab2', 'fashion', 'women'), -- Gown
  ('e98c9df3-b352-4d92-ba9c-ede7617f91e7', 'fashion', 'women'), -- Gown
  ('0cdb77f9-2fb5-4764-a6c2-e1d249267aa7', 'fashion', 'women'), -- Gown
  ('fd3eaccf-3020-4371-95ed-0318711ec2d5', 'fashion', 'women'), -- Gown
  ('1ef195a5-6c1d-457e-941b-11c080ae7c3e', 'fashion', 'women'), -- Gown
  ('1eb71b25-3b89-49ef-81dc-66793257f918', 'fashion', 'women'), -- Gown
  ('059f5c51-cf86-4a80-b67d-fe95b78eb5f5', 'fashion', 'women'), -- Gown
  ('54d4b449-a9c8-43d7-8ce2-17e183ef41ef', 'fashion', 'women'), -- Gown
  ('35e0a484-74b4-44f0-b081-27fdcdb22376', 'fashion', 'women'), -- Gown
  ('e602e8f9-70fd-44fb-bc7f-89a81c86c244', 'fashion', 'women'), -- Gown
  ('9db7643d-7fc8-4caf-94dd-4c4b44a1956e', 'fashion', 'women'), -- Gown
  ('96fa7d5e-3235-43e4-aa42-8a81faba0466', 'fashion', 'women'), -- Gown
  ('c8054418-9b42-409a-8060-6d91c1a0468c', 'fashion', 'women'), -- Gown
  ('6fa0efb4-3109-4fd1-9ddd-b570d934ca9d', 'fashion', 'women'), -- Gown
  ('11191b74-97a2-4ffb-8c27-a2baf33460e7', 'fashion', 'women'), -- Gown
  ('32c5f9cb-3fd6-4b3a-b33e-f4aad067cecc', 'fashion', 'women'), -- Gown
  ('46a4218b-9fbf-4158-ae2a-d2737aa905f7', 'fashion', 'women'), -- Gown Size 6-8
  ('0880612b-c138-45b8-ad3f-a317189e4cfc', 'fashion', 'women'), -- Gowns
  ('5361d583-7fa9-4746-be14-8a5803260285', 'fashion', 'women'), -- Green & White Striped Women's Two-Piece Set
  ('a8974667-dc44-4ab2-8f8a-06d6f1d3de03', 'fashion', 'women'), -- Grey Camo Cargo Shorts
  ('69ba2d8d-6ef0-45e6-8253-2d6d667d6380', 'fashion', 'women'), -- Grey Camouflage Cargo Shorts
  ('45339422-2a33-44d1-958d-b5c4df6f5eee', 'fashion', 'women'), -- Grey Gradient Bodycon Jumpsuit
  ('2a79af5e-33a0-467f-a8e9-63a2ad1f1e59', 'fashion', 'women'), -- Grey Zip-Up Hoodie and Jogger Set
  ('6b716d1d-c2a2-459b-a9c1-0630123fad0a', 'fashion', 'women'), -- Grey Zip-Up Hoodie and Sweatpants Set
  ('21d0cdd6-e3f6-4842-9ca7-d7b1cab6497d', 'fashion', 'women'), -- Grey Zip-Up Hoodie and Wide-Leg Pants Set
  ('ee85ccf7-6234-468d-b5be-0697f82a0686', 'fashion', 'women'), -- Grey Zip-Up Tracksuit Set
  ('1d2e23a1-9048-45f5-b868-e83156d976ba', 'fashion', 'women'), -- Gucci Black Leather Chunky Sneakers
  ('1fa863c4-b3e1-4180-87e9-877dbb652681', 'fashion', 'women'), -- Gucci Black Quilted Leather Slides
  ('4a6d700b-7b26-44b3-8b6a-bf9ffba04a9a', 'fashion', 'women'), -- Gucci Damier Check Tote Bag
  ('5d59e937-11db-456f-b82b-13610da8e11c', 'fashion', 'women'), -- Gucci GG Canvas Tote Bag
  ('659a6592-d8ab-4530-be6d-e8cd79d158be', 'fashion', 'women'), -- Gucci GG Canvas Tote Bag with Pouch
  ('0ab8a79a-552a-4117-8449-a1481198a468', 'fashion', 'women'), -- Gucci GG Monogram Tote Bag in Black
  ('a6bba10e-b7a0-4158-b080-ba30b7d4b0e7', 'fashion', 'women'), -- Gucci GG Monogram Tote Bag in Pink
  ('72deb3b6-197a-4ad8-babe-c9ece1d108a7', 'fashion', 'women'), -- Gucci Monogram Tote Bag
  ('42f75ce5-a5fe-4943-8097-dcdc09b5e7fa', 'fashion', 'women'), -- Gucci Pattern Handbag with Matching Wallet
  ('f8cc7877-8b7a-448d-ba89-7edfe833cd2d', 'fashion', 'women'), -- Gucci Quilted Leather Slides (Tan, Blue & Yellow)
  ('f9d35906-33ed-4fd4-9563-d2285b032310', 'fashion', 'women'), -- Gucci Tan Quilted Leather Slides
  ('ed068c5c-7d15-4854-a36b-dc7a84b17111', 'fashion', 'women'), -- Gummy Bear Pendant with Chain
  ('57905d7e-bc8a-4d62-b48c-48b11a1b1085', 'fashion', 'women'), -- Gummy Bear Pendant with Leather Cord
  ('daac9220-39ff-4419-a153-9696f45cb3a5', 'fashion', 'women'), -- Gummy Bear Pendants
  ('fa8dcbb4-1d5d-4e6f-9cf7-51cf24539147', 'fashion', 'women'), -- Heart-Embossed Leather Handbag with Coin Purse
  ('54edc5da-b273-482d-a9bb-cff1eb986a88', 'fashion', 'women'), -- Heart-shaped Jewellery Set
  ('38319fb3-363f-4c9d-80c4-985459952938', 'fashion', 'women'), -- Heart-Shaped Jewellery Set
  ('3840acc4-27cf-457a-98a3-2c31f49b5a6c', 'fashion', 'women'), -- Heart-Shaped Jewellery Set with Chain
  ('26003abd-3e40-434d-af57-d15486a861c3', 'fashion', 'women'), -- Heels (Size 3741)
  ('47b7f0f0-1660-4f7b-a948-c224b8a5ae0e', 'fashion', 'women'), -- Heels size 37-42
  ('f5a9b778-a10f-4805-ae50-e3bdbf25212a', 'fashion', 'women'), -- Hermes 37-4 Fully Boxed
  ('44129260-b693-4c0b-88fc-cb97d6a41d4b', 'fashion', 'women'), -- Hermes slippers Size 37 - 41
  ('29b6e9e3-7b31-4217-8577-093e990acbed', 'fashion', 'women'), -- High Quality 2 Pcs Set (L, XL, XXL)
  ('50305288-df02-4ec0-bca8-1ba5e1d4adb3', 'fashion', 'women'), -- HIGH QUALITY BAG, available in all colors
  ('98c72077-8151-47af-906d-2065c6048746', 'fashion', 'women'), -- High Quality Blazer
  ('0175f53d-e4e7-4e62-b01c-7f25a67f227c', 'fashion', 'women'), -- High Quality Tote Bag
  ('29bb5d76-a0c0-4c13-aa5b-1a59ccc78191', 'fashion', 'women'), -- High Quality Trendy Bags
  ('51ea5336-6df9-4f86-a96a-098e094e39f3', 'fashion', 'women'), -- High-Waist Trousers with Gold Chain Belt
  ('03579a83-ddf5-437b-b77e-5a55abb46db3', 'fashion', 'women'), -- Ikweji
  ('1936b105-9e7e-4da0-ace2-7941a2a1240b', 'fashion', 'women'), -- Iridescent Opal Drop Earrings
  ('8e1f8638-409d-47c3-867a-d1bc954de041', 'fashion', 'women'), -- Iridescent Pearl Drop Earrings
  ('fe8bab1c-91c1-48f2-aa78-89ec8a29d180', 'fashion', 'women'), -- Item (2 pcs)
  ('8ec6b63f-92ad-47bf-a9c9-aad9b84c0e43', 'fashion', 'women'), -- Item for sale
  ('7872757b-e881-49e9-9fde-160f91223073', 'fashion', 'women'), -- Item for sale
  ('d653c9e3-7b3c-4884-b379-e54f68541d79', 'fashion', 'women'), -- Item for sale
  ('5adc4174-26a4-476c-b7f3-6b713ef4b823', 'fashion', 'women'), -- Item size 3741
  ('551707ef-1153-477d-9fb9-66eedc3f3827', 'fashion', 'women'), -- Jalabia (Blue, Brown, Wine, Fayrous)
  ('3d83e2be-6103-40ae-a6df-5c466e1ba305', 'fashion', 'women'), -- Jersey scarf
  ('18aaa065-51fa-4a76-8a39-545564548849', 'fashion', 'women'), -- Jewlery set
  ('c32e324c-134e-4ba3-ab85-fc2895771038', 'fashion', 'women'), -- Joggers
  ('3ec08dfb-3faf-4d1f-b152-e635f0ed4f5f', 'fashion', 'women'), -- Joggers
  ('7363f8d9-83fb-4858-92e7-38f4fcde06ec', 'fashion', 'women'), -- Joggers
  ('515268aa-f3ab-451b-985c-079630e717e2', 'fashion', 'women'), -- Joggers
  ('285473a9-7db0-4078-8b93-71725bcdd20b', 'fashion', 'women'), -- Joggers
  ('3126bb40-e7fb-428d-9fbc-eb3174ae533d', 'fashion', 'women'), -- Joggers
  ('0e039d13-853b-4752-bde8-7bed71eb45c1', 'fashion', 'women'), -- Joggers
  ('e26f7509-e1f6-4791-96e5-cf1f7e6533d6', 'fashion', 'women'), -- Jort
  ('a6bb6af8-dc25-4d03-a33a-d7da6c62a768', 'fashion', 'women'), -- Jumpsuit
  ('1bc8fd79-1a67-4351-b473-8042b68ee133', 'fashion', 'women'), -- Knitted Dress
  ('18c72c44-613a-4a4e-8d00-afbde2645f63', 'fashion', 'women'), -- Korean Leggings
  ('64ad00f5-3ade-4768-9072-3a67a510eaeb', 'fashion', 'women'), -- Ladies bag
  ('96165f7b-23a2-4c8f-9c36-b8eae9579573', 'fashion', 'women'), -- Ladies Bliss (was beauty)
  ('8fb38560-e98e-4bae-be20-6b1eab22a048', 'fashion', 'women'), -- ladies delight
  ('6b059ff6-fdee-4b9a-81a0-c0ea455054fd', 'fashion', 'women'), -- Ladies shoes
  ('6e7054d4-9b54-4a1b-917e-3fe2edd5633c', 'fashion', 'women'), -- Ladies Top
  ('62d8bd7e-5ab3-4339-ae0f-489acc37cafb', 'fashion', 'women'), -- Landed Nude and Black Shoes
  ('b303c8f7-7add-49c6-be52-4be38fe3c0ca', 'fashion', 'women'), -- Landed Umbrellas (Black & Brown)
  ('96d97c9a-1463-44d9-bcd8-0b1c8dae7cee', 'fashion', 'women'), -- Laye Fashion Brown Wide-Leg Co-ord Set
  ('98763050-3c34-4946-9851-1059a1c22a23', 'fashion', 'women'), -- Laye Fashion Pink Wide-Leg Co-ord Set
  ('4515aba0-d2d9-4f7f-8c04-1b896c15dbc6', 'fashion', 'women'), -- Laye Fashion Purple Wide-Leg Co-ord Set
  ('efe023df-5cda-4e9b-b179-0e30306ef752', 'fashion', 'women'), -- Leopard Print Aso Ebi Co-ord Set
  ('5c645729-2c9c-43a0-bf67-ee1a01537809', 'fashion', 'women'), -- Leopard Print Halter Neck Jumpsuit
  ('e7253fba-14ef-43fc-b00a-96a574b1e99d', 'fashion', 'women'), -- Leopard Print Halter Neck Maxi Dress
  ('6358cc2f-f1ad-4037-9122-325842be653b', 'fashion', 'women'), -- Leopard Print Halter Neck Ruffled Maxi Dress
  ('76f1b6f8-4a27-40ca-94ad-bb5de3692f7b', 'fashion', 'women'), -- Leopard Print Jumpsuit
  ('9efa6cbc-5bb2-44d5-a43f-41533a9257a5', 'fashion', 'women'), -- Light Blue Distressed Flare Jeans
  ('efc42774-5359-4b28-adf6-b80bd8b75e8f', 'fashion', 'women'), -- Light Blue Wide Leg Denim Jeans
  ('0d270b1b-30ae-4c85-914b-31dde0a2e3c2', 'fashion', 'women'), -- Light Blue Wide Leg Denim Jeans
  ('16f42045-9105-430b-98df-243cdf3b1eed', 'fashion', 'women'), -- Light Blue Wide Leg Jeans C1514
  ('e8229697-30c3-4844-90b1-241a36e45ecb', 'fashion', 'women'), -- Louis Vuitton Lockit Chain Bag
  ('7d57e3e2-1be9-4f98-ab9c-591c042675be', 'fashion', 'women'), -- Louis Vuitton Monogram & Damier Neverfull Tote Bags
  ('cd5c022b-b186-4b57-acde-ede9bc3593ef', 'fashion', 'women'), -- Louis Vuitton Monogram Tote Bag
  ('8611f32d-ed44-49a9-a8e0-2a4ea6282fda', 'fashion', 'women'), -- Louis Vuitton Monogram Tote Bag Set
  ('e5b9d1b7-e955-4682-8449-fd67f8c73426', 'fashion', 'women'), -- Luxengxishi Black Leather Tote Bag with Chain Strap
  ('41c34f7f-3741-44e4-9d8b-0f7d00e1f383', 'fashion', 'women'), -- Luxengxishi Brown Leather Tote Bag with Chain Strap
  ('9a72b4b4-0202-4d2e-abd9-be0a91f29f5e', 'fashion', 'women'), -- Luxenxishi Geometric Quilted Tote Bag
  ('b8542e6c-dd0e-47ac-97e5-944727585e41', 'fashion', 'women'), -- Luxury
  ('c5873b2e-3977-48b9-a1ec-193a14fc8bb1', 'fashion', 'women'), -- Luxury 2pcs Set
  ('0a40ac13-b9a8-4910-add3-8c8828fffee8', 'fashion', 'women'), -- Luxury 2pcs Set
  ('64d082e9-e46b-455e-a247-d74faaa58c0c', 'fashion', 'women'), -- Luxury 2pcs Set
  ('36c24a85-b0bf-4ab2-9a34-07dfebf7e593', 'fashion', 'women'), -- Luxury 2pcs Set
  ('c30ee2be-695d-40c9-a4c5-aeadab9c88de', 'fashion', 'women'), -- Luxury 2pcs Set
  ('718f91cc-131f-4a6c-8d49-3c07490c337c', 'fashion', 'women'), -- Luxury 37 41 Fully Boxed
  ('79c69a98-5de7-4af8-aa54-cff98463a47f', 'fashion', 'women'), -- Luxury bag
  ('40bef1a7-5809-4b59-8176-5ff02b43d461', 'fashion', 'women'), -- Luxury bag
  ('2d836b82-020b-4ef7-a1ff-8b1ce809836e', 'fashion', 'women'), -- Luxury bag
  ('040447c4-9376-46df-8d9d-af8b00300ea3', 'fashion', 'women'), -- Luxury bag
  ('df801d14-b05d-4f34-9547-1de0ac03a93e', 'fashion', 'women'), -- Luxury bubu gown
  ('71f23e72-9cd5-4150-80a8-fc1b71a0ef3c', 'fashion', 'women'), -- Luxury Chain Shoulder Bag
  ('22f615f2-a5bb-4848-8921-d3a5a8693351', 'fashion', 'women'), -- Luxury Classy 2pcs Set
  ('9c78a72d-e550-4a77-abb9-e90c478ca1f9', 'fashion', 'women'), -- Luxury clothing
  ('39bd7c62-70dc-4d1c-8fa3-47341d3ce8de', 'fashion', 'women'), -- Luxury Crystal Necklace and Earring Set
  ('c8ac5338-b24b-41e5-8372-6d01cce55e8f', 'fashion', 'women'), -- Luxury Denim Dress
  ('99cf02eb-6509-4313-9dbc-152f8a5936cf', 'fashion', 'women'), -- Luxury Designer Style Handbag in Multiple Colours
  ('c7513ea2-52a6-4926-8c36-68c1ad3eeb8b', 'fashion', 'women'), -- Luxury dress
  ('4a649800-1be7-423e-ac56-af346aa320b4', 'fashion', 'women'), -- Luxury Dress
  ('9a7961bc-1557-4fff-bde1-18d02b132727', 'fashion', 'women'), -- Luxury Dress for Big Girls - Pink and Ash
  ('23fc7448-1854-480d-bb11-23ac5472ab4a', 'fashion', 'women'), -- Luxury Dubai Abaya Gown
  ('da9331b9-0942-43cd-a253-d83ef64497ff', 'fashion', 'women'), -- Luxury Embossed Leather Handbag
  ('79e0b947-8e3a-4559-b8fb-44c3f87dab6e', 'fashion', 'women'), -- Luxury Female Sandals
  ('242ce694-ad47-4523-97d7-d2d9125fecef', 'fashion', 'women'), -- Luxury female slippers
  ('d43b1154-a397-4ee2-bd73-3c4bb86e1863', 'fashion', 'women'), -- Luxury Floral Dress
  ('9fa5b8c5-1853-466e-aaef-d37660661baf', 'fashion', 'women'), -- Luxury Gown
  ('5134e760-0038-4535-ad57-e8797d32ca8a', 'fashion', 'women'), -- Luxury Gown
  ('762344c6-08e4-4a0b-91a9-81f57198e451', 'fashion', 'women'), -- Luxury lady wears
  ('243ff0a0-3b47-4f62-91c4-daa3e0f9ebb3', 'fashion', 'women'), -- Luxury Leather Tote Bag with Chain Strap
  ('7d0c0a83-7fcd-4b35-a634-43e8e511144e', 'fashion', 'women'), -- Luxury Metallic Pointed-Toe Slingback Heels
  ('130c5fa9-fcb3-4fe5-92df-7ef19515e8ad', 'fashion', 'women'), -- Luxury Monogram Tote Bags
  ('4bb1ba35-7d3e-4e59-bc8c-9d4d621fec83', 'fashion', 'women'), -- Luxury Quilted Slides in Multiple Colors
  ('4d211c71-1570-4fcc-b99d-a672fc145f0e', 'fashion', 'women'), -- Luxury Rhinestone Square Handbag
  ('cda77801-3ff5-4e8a-bab5-4afdb84c4d76', 'fashion', 'women'), -- LV Number 33 Sports Set (White & Black)
  ('8eb338d3-187f-4ac7-866d-09f63e842f56', 'fashion', 'women'), -- M Tote Bag
  ('b51aa341-a6d6-4299-a7a1-940cb45c074a', 'fashion', 'women'), -- Magenta Bubu Gown with Black Polka Dots
  ('99eea3f5-474d-4f2c-a457-fb9cf8385cdd', 'fashion', 'women'), -- MANGO and CHANEL Slodes
  ('1f7acc8b-3acd-4e1d-bb6e-c9c7651b8048', 'fashion', 'women'), -- Maroon Polka Dot Bubu Gown
  ('0b9fc3e9-5775-480f-b577-de2f8c3b6c00', 'fashion', 'women'), -- Maroon Two-Piece Co-ord Set
  ('29a3758a-dbc1-4392-bb98-78c5c96e29a2', 'fashion', 'women'), -- Max selection
  ('94bc6c40-5231-476b-a8cb-06a47bd0f438', 'fashion', 'women'), -- Maxi skirt
  ('cc6b87d0-6e55-4f79-9b76-2d3bf43547a9', 'fashion', 'women'), -- Maxi Skirt
  ('8166894d-977a-4adb-a18d-6ebddfdd1d9f', 'fashion', 'women'), -- Maxi Skirt
  ('59925152-8d6d-4901-8d6f-2a6b1f1fabe6', 'fashion', 'women'), -- Mesh Gown (Sizes M, L, XL)
  ('cb9f33e8-dc0b-4c91-8a78-61a6759e4db3', 'fashion', 'women'), -- Mesh Gown with Inner
  ('7bf5a778-83bf-4566-a60f-321576b9e24c', 'fashion', 'women'), -- Mesh Top
  ('bc75a4e5-e597-4b83-beb1-8e4998244ced', 'fashion', 'women'), -- Mesh Top
  ('c80593d7-0bc3-447b-b6f5-1289085594ee', 'fashion', 'women'), -- Mex Shoulder Bag
  ('18187df8-624d-434c-b99c-88b966ce5821', 'fashion', 'women'), -- Micas Brown Two-Piece Set
  ('2c7de716-53bc-4190-956d-eb4992978738', 'fashion', 'women'), -- Michael Kors Studded Leather Handbag
  ('c961680f-e1c7-4b83-ad95-d01a4bdcd05d', 'fashion', 'women'), -- Mini Top-Handle Handbag in Multiple Colours
  ('b9013c25-65b5-49a0-bf2b-c5d25e3c3f0d', 'fashion', 'women'), -- Mk item (size 37-42)
  ('18c26e48-862e-4fb5-b568-743d77c7e7d6', 'fashion', 'women'), -- MK Studded Leather Handbag
  ('1ad0a01d-4145-46c7-a428-4e5c3e03fa5d', 'fashion', 'women'), -- Multicolour Floral Long Sleeve Top
  ('470bc45c-1d40-4abf-9cae-a796fcc6e2fb', 'fashion', 'women'), -- Multicolour Halter Neck Ruffle Dress
  ('ab299416-ff92-4698-92cb-7029f49fc235', 'fashion', 'women'), -- Multicolour Patent Leather Slingback Pumps
  ('5cf29457-1e97-4221-b104-603e230fb874', 'fashion', 'women'), -- Multicolour Striped Polo Top
  ('875a1774-77b5-4f3c-b795-29b5a3294c01', 'fashion', 'women'), -- Navy Blue Custom Jersey Dress
  ('be0c2b7e-c626-4728-8def-1b27e696c151', 'fashion', 'women'), -- Navy Blue Off-Shoulder 90s Sweatshirt & Skirt Set
  ('4dcc3c2e-ea48-4b7d-80d1-781291ab22f3', 'fashion', 'women'), -- Necklace
  ('6a2277d3-01f0-42e8-be8b-17bbb46dd556', 'fashion', 'women'), -- Necklace set
  ('4525a0d0-9a32-40f2-9602-d07804b68466', 'fashion', 'women'), -- Necklace set
  ('dec57ac8-b455-42ce-bc2f-8d8a119eabe8', 'fashion', 'women'), -- New classic Chanel-style handbag with teddy pendant
  ('710841ba-5310-46a6-b597-c59240e9c70d', 'fashion', 'women'), -- New collection shoes
  ('dd488bb5-aec0-4613-8ca4-076999bce98e', 'fashion', 'women'), -- New collections, fancy shoes
  ('7b83c2d8-1b79-43de-81ce-dc37a370427c', 'fashion', 'women'), -- New Embroidery Tote Bag
  ('c1f6f35f-3bf4-475b-a362-ff1c19bc2f5f', 'fashion', 'women'), -- New Luxury Chinese Item
  ('d9592d35-53bd-4dfb-ae2d-ba0d41457107', 'fashion', 'women'), -- New Luxury Chinese Product
  ('d95cfbe2-ba49-4152-b572-0cc6cb8288ae', 'fashion', 'women'), -- New Tolani Tote Bag
  ('a46501cc-e25f-45e3-b9ea-9eafb8a87902', 'fashion', 'women'), -- New Trend Luxury Bubu Gown
  ('2e6136d9-06f0-4237-999e-aa66cf11e7b8', 'fashion', 'women'), -- New Trendy Top
  ('a1ea9343-4bcb-4a0d-9c35-ffc7a971a0ef', 'fashion', 'women'), -- New Vintage Small Square Shoulder Crossbody Bag
  ('0be2a92e-ef7b-4285-9d41-87c787e4c6e2', 'fashion', 'women'), -- New women bubu
  ('4cd99d4e-4f43-4372-a9fc-639054765988', 'fashion', 'women'), -- New York Giants NFL Jersey Top
  ('3614d273-cced-4cc3-8ed7-50f9484ce8fa', 'fashion', 'women'), -- Newly Restocked Shoes (Sizes 37-41)
  ('bc733df0-1d8a-42cf-95da-0a6cd82d3dfd', 'fashion', 'women'), -- Nice heels in black and red
  ('7375748b-a3ad-4d05-9fe4-4aee0b639c4a', 'fashion', 'women'), -- Nightware
  ('a87ee23e-1322-49ef-9c26-7c6e0f854157', 'fashion', 'women'), -- Nightware
  ('203fd0bf-dc5c-45ee-9c6e-427867fbb02f', 'fashion', 'women'), -- No yellow 6500 (was other)
  ('720d4917-65f8-4f15-a646-7f27d984705d', 'fashion', 'women'), -- Noble Collection Striped Flare Jumpsuit
  ('48498e24-5e1d-46ee-9312-65a9ee3f602d', 'fashion', 'women'), -- Not your regular
  ('0826f31f-608f-44be-b0ff-4dcdb3c6039f', 'fashion', 'women'), -- Now
  ('dc77de37-1448-430b-893d-74a8c9d60275', 'fashion', 'women'), -- Now
  ('8aa51e91-f26a-49f0-8838-0d7d802f18d9', 'fashion', 'women'), -- Now restocked 12500
  ('7a2fafb0-1f62-41f2-9003-7c9b6973f0f1', 'fashion', 'women'), -- Nude Shoes Size 37
  ('703335b7-220e-4c5b-be38-d7112c2e1cfe', 'fashion', 'women'), -- Nude Shoes Size 39
  ('6155ebeb-e518-41d5-a4bf-8c90f07cd8a1', 'fashion', 'women'), -- Nude, Brown & Black Shoes (Sizes 38-40)
  ('49ef3407-16a7-4a76-b474-486bb3732c21', 'fashion', 'women'), -- NYC Infinite Radiance Polo T-Shirt
  ('9972e168-804a-4521-90e9-5bfd65026bfd', 'fashion', 'women'), -- NYC Off-Shoulder Top
  ('bf6a6f10-9d8b-4bb5-bde2-56bf20d926fd', 'fashion', 'women'), -- Obiwhite Yellow and Blue Gradient Co-ord Set
  ('86d865c6-1c7e-41ed-863f-19ce2959c96d', 'fashion', 'women'), -- Orange Brown and Black Marked Colors
  ('6568dd75-4308-4093-9935-3119097f759f', 'fashion', 'women'), -- Orange Fringe Maxi Dress
  ('5a55a70f-2b53-4048-af36-a2376788f6aa', 'fashion', 'women'), -- Orange Lace-Up Wide Leg Trousers
  ('c8004a5f-0e25-487a-b19f-8294198936cb', 'fashion', 'women'), -- Original product all colours available
  ('b7ec78f5-7649-4585-ba5e-cfa740e3899f', 'fashion', 'women'), -- Pant Trouser
  ('459d679c-2f47-4cc8-b077-c7907b5b5742', 'fashion', 'women'), -- Patent Leather Slingback Heels with Buckle
  ('c38337cc-d1ce-484d-abe4-bace0e290810', 'fashion', 'women'), -- Petite Drop Earrings
  ('d2609b43-37a0-4c23-9282-20bab1309c3f', 'fashion', 'women'), -- Pink & Orange Abstract Print Long Sleeve Top
  ('7530d907-9281-4bc6-9c20-94c130fdf191', 'fashion', 'women'), -- Pink and Cream Item
  ('cf69c32d-1195-4abe-b886-660771741ba2', 'fashion', 'women'), -- Pink and Orange Ankara Gown
  ('aa860255-99f1-4bf3-8a22-dfd1acdb3515', 'fashion', 'women'), -- Pink Blue Green Items
  ('1c4c314b-514a-4eaf-8e44-fe3f275376b9', 'fashion', 'women'), -- Pink Bow Strap Party Dress
  ('074510ad-2950-4088-af21-7f8195228d41', 'fashion', 'women'), -- Pink Embroidered Bodycon Dress
  ('4700da99-e6b1-4c8c-b79e-e92642514010', 'fashion', 'women'), -- Pink Floral Maxi Dress
  ('c84dc1c7-7454-471f-8efd-d8c2914d5eb7', 'fashion', 'women'), -- Pink Floral Print Two-Piece Set
  ('f9195251-a921-45d5-b725-3803bb1a234b', 'fashion', 'women'), -- Pink Halter Top with Colorful Geometric Skirt
  ('a4ca820c-c4f4-4937-bd6b-269a1e4ed534', 'fashion', 'women'), -- Pink Halter Top with Floral Print Skirt
  ('3a703897-813a-4bdb-9445-dbdcc5e9faf3', 'fashion', 'women'), -- Pink Lace Bodysuit with Matching Fuzzy Cardigan
  ('5dbb2913-9ac9-44ce-9cc3-2ebbd1e355f6', 'fashion', 'women'), -- Pink Lace-Up Wide Leg Trousers
  ('a051d09c-a03d-4a0a-b32b-b202e859e0e5', 'fashion', 'women'), -- Pink Monogram Canvas Tote Bag
  ('54d7d92f-e2e6-499c-9231-8f6a914cd128', 'fashion', 'women'), -- Pink Polka Dot Bubu Gown
  ('b6ba83b2-77f7-4f2b-803a-21964553109e', 'fashion', 'women'), -- Pink Polo Zip-Up Tracksuit Set
  ('c297fc72-432d-45aa-8300-1c65e593bc21', 'fashion', 'women'), -- Pink Quilted Leather Handbag with Chain Strap
  ('4dda8216-5108-4786-a1b9-f7c2140477c2', 'fashion', 'women'), -- Pink Ribbed Sleeveless Tank Top
  ('e67778ec-6e14-4705-b488-6becfca1593e', 'fashion', 'women'), -- Pink Ruffled Foreign Gown
  ('9f249efa-1141-466b-819b-6587b58d087b', 'fashion', 'women'), -- Pink Ruffled Halter Neck Gown
  ('b90db85c-e7a8-427d-b751-7b227e714d49', 'fashion', 'women'), -- Pink Shoes Size 38
  ('035bf717-7962-4629-b51d-7ea856626006', 'fashion', 'women'), -- Pink Striped Two-Piece Co-ord Set
  ('a52859ee-c2f4-4d62-83c7-f0b9e38386cf', 'fashion', 'women'), -- Pink Women's Button-Down Shirt
  ('2dfefc39-cb4c-4409-93e7-4dec288b529b', 'fashion', 'women'), -- Pink Zip-Up Hoodie and Track Pants Set
  ('d499bbb1-c452-48f0-aedc-69d258b549a3', 'fashion', 'women'), -- Pink, Brown & White Shoes with Adjustable Straps
  ('67dd423f-32e0-4ecc-9b8b-8ef46465cd03', 'fashion', 'women'), -- Plain Basic Full-Length Top
  ('209cca75-3b05-41a5-91de-8a61c5b8f36f', 'fashion', 'women'), -- Play Tote Bag with Charm
  ('e18ab40a-a659-482d-9463-24d006aa3ba1', 'fashion', 'women'), -- Pleated Satin Handbags in Multiple Colors
  ('f9404b62-51b3-4714-8ad1-99958f55346f', 'fashion', 'women'), -- Plus Yellow (was other)
  ('bbe97173-6ff7-48da-9e8e-7360729302a8', 'fashion', 'women'), -- Polka Dot Co-ord Set (White & Black)
  ('f3d8638c-1cc1-4350-8d7d-7e52f79aff6b', 'fashion', 'women'), -- Polka Dot Off-Shoulder Top & Brown Leggings Set
  ('15501f4c-dc24-403e-ba8e-8516fd3cecb1', 'fashion', 'women'), -- Premium Black Glitter Heel Slides
  ('fb1c1be8-563f-4409-a5d7-f108d903ee4e', 'fashion', 'women'), -- Premium Heels (Sizes 37-41)
  ('a9c9c8ec-5141-4209-85e1-267f0988c736', 'fashion', 'women'), -- Premium Ladies Long Sleeve Pajama Set
  ('0c3eb443-8190-44b8-989b-7f1d9b27219d', 'fashion', 'women'), -- Price 25,000
  ('e64cde43-fc5b-4a20-bc57-5d72f43346eb', 'fashion', 'women'), -- Printed Women's T-Shirts in Multiple Colours
  ('1b3f8b29-424e-4a6e-aede-72f71f197f34', 'fashion', 'women'), -- Product
  ('f8045f73-193b-4b21-9ebc-f6f2f9269dfd', 'fashion', 'women'), -- Product Available in Multiple Colors (was other)
  ('317d6347-6eaa-4aca-ad17-db4815aa0691', 'fashion', 'women'), -- promo (was other)
  ('f9a4c206-71bf-404d-92a5-bb637202a680', 'fashion', 'women'), -- promo (was other)
  ('d3fddfbd-f7d2-4102-aa42-2b8077873f7e', 'fashion', 'women'), -- promo (was other)
  ('b0c6669d-4627-49be-aa8b-ce761a797f1d', 'fashion', 'women'), -- Purple Floral Halter Mini Dress
  ('dbd18ae3-f557-4f5d-aad9-4bc9d3f19157', 'fashion', 'women'), -- Purple Floral Pleated Maxi Skirt
  ('fc7a4e94-bcad-4450-8c94-654d62c76734', 'fashion', 'women'), -- Purple Lace-Up Wide Leg Trousers
  ('b02c83c1-51ee-48db-91dc-16cb7ec9d979', 'fashion', 'women'), -- Purple Lace-Up Wide Leg Trousers
  ('0d2947f6-a21c-41d6-8c0e-e275c96c56cb', 'fashion', 'women'), -- Purple Polka Dot Bubu Gown
  ('03470911-b6c5-4698-a6e7-401368b8effa', 'fashion', 'women'), -- Purple Two-Piece Set with Blouse and Wide-Leg Trousers
  ('22edaa1b-7228-4a81-b8bb-1d570486ab78', 'fashion', 'women'), -- Purple Women's 2-Piece Tracksuit Set
  ('6c0c99b7-a87a-4249-aee8-1f05ab47ce6f', 'fashion', 'women'), -- Purple Women's Button-Down Shirt
  ('63c74058-7405-4d1d-aa34-5310d5cf90c8', 'fashion', 'women'), -- Quality Black, Brown, and Wine Shoes (Sizes 38-42)
  ('dffd3c14-f075-4392-ad91-bfb8bc3a4712', 'fashion', 'women'), -- Quality fashion Female Slippers
  ('2477356c-b4ef-4f07-836a-2b4da57d751c', 'fashion', 'women'), -- Quality fashion slippers
  ('eb85619c-2ecc-42c8-bf04-d5719a38aaf6', 'fashion', 'women'), -- Quality Foreign Tote Bags
  ('9e751520-d554-4f20-b8d1-742cc93be63d', 'fashion', 'women'), -- Quality Foreign Tote Bags (White, Pink, Black)
  ('e6ccc5f9-68f5-43c8-b865-bee6139268b5', 'fashion', 'women'), -- Quality Gown (M, L, XL)
  ('57a3dfbe-e252-4cff-a86c-727b557c8056', 'fashion', 'women'), -- Quality Gown Size 46-52
  ('e47872ba-c5a7-465f-a7ea-85b269a62eec', 'fashion', 'women'), -- Quality Short Heels (Sizes 37-42)
  ('77e5cef1-148a-41bf-ab9b-5caad3935f84', 'fashion', 'women'), -- Quality Summer Vibes Tote Bag
  ('5a119137-dc76-4e18-bd1a-39a3bcb5c8f1', 'fashion', 'women'), -- Quality Turkey Wear
  ('ef3f4302-179d-45db-9bcd-3def0fff00c7', 'fashion', 'women'), -- Quality White Shoes Size 37
  ('48354edf-98fe-4142-a045-fc151a57321e', 'fashion', 'women'), -- Quality women Turkey Wear
  ('375dae98-98b4-413c-a5b7-cbaf53a0e40f', 'fashion', 'women'), -- Quilted Cherry Print Chain Shoulder Bag
  ('44140163-7fbe-49a6-af81-87ac85e4b0c7', 'fashion', 'women'), -- Quilted Ladies Handbag with Shoulder Strap
  ('d7b481aa-96ce-4210-96b5-9b7d71c834c8', 'fashion', 'women'), -- Quilted Leather Handbag with Chain Strap
  ('eae83184-cf13-4b4b-bfdb-7497d09bd245', 'fashion', 'women'), -- Red & Black Houndstooth Two-Piece Set
  ('82f0cf58-bb07-4231-aaf7-8577475c0384', 'fashion', 'women'), -- Red and White Two-Piece Tracksuit Set
  ('a8fed07e-e67d-428d-a51c-1644af874664', 'fashion', 'women'), -- Red Formal Evening Gown
  ('cbd5ad22-d799-4995-ad2f-10deb2ca2d7e', 'fashion', 'women'), -- Red Hoodie Tracksuit Set
  ('a9c5697c-4f18-4a1a-8f8b-0a9f422b86d6', 'fashion', 'women'), -- Red Plaid Sleeveless Top and Shorts Set
  ('6a17020c-5bb2-41d4-8351-b86663d68b09', 'fashion', 'women'), -- Red Polka Dot Halter Dress
  ('9ebf551a-7193-4174-b527-6b8120584d65', 'fashion', 'women'), -- Red Ribbed Sleeveless Tank Top
  ('e0387f94-676a-4418-97ac-8fa914f0930c', 'fashion', 'women'), -- Red Ruffled Foreign Gown
  ('70abc10c-e9fd-49ba-96a5-525c67bfb898', 'fashion', 'women'), -- Red, Pink, and White Items
  ('1e4cb125-d644-47cd-9565-1974a9f281fe', 'fashion', 'women'), -- Resin Gem Set with Chain
  ('cb5acc4c-1117-4ed1-b12a-2cc6877e9a7d', 'fashion', 'women'), -- Restocked Best Seller Shoes (Sizes 37-42)
  ('fc71190e-d2c9-48a4-91ac-5763b20f32e3', 'fashion', 'women'), -- Ring Watch
  ('7084493f-f9f3-420a-bcdd-93a9b92e3fdf', 'fashion', 'women'), -- Romper
  ('b66a6a15-04f9-4a12-bbd2-f2b03d5d7727', 'fashion', 'women'), -- Romper
  ('103c4370-4730-4583-85b9-9351793ed037', 'fashion', 'women'), -- Royal Blue Fringe Maxi Dress
  ('b381db04-41c9-4b16-8ad0-3f45ea7d0bd6', 'fashion', 'women'), -- Sexy Gown
  ('08ec7f23-b026-4d83-82df-36de3d14750a', 'fashion', 'women'), -- Shoes (Sizes 37-42)
  ('d686f433-5be0-473a-9cfb-a3de53605941', 'fashion', 'women'), -- Shoes (Sizes 7-12)
  ('dc2f3b80-4b4d-4bff-b31f-a83cca57def3', 'fashion', 'women'), -- Shoes Available in All Colors (Size 37-42)
  ('f5240b19-1ac7-4664-991d-46fe5721fa54', 'fashion', 'women'), -- Shoes Available in All Colors (Size 37-42)
  ('0b108c3d-4292-49bb-8158-97668b929ef3', 'fashion', 'women'), -- Shoes Available in All Colors (Size 37-42)
  ('00fa1a9c-025e-46cf-8d53-23720d0806e3', 'fashion', 'women'), -- Shoes Available in All Colors (Size 37-42)
  ('8feb50d3-bb11-4c3a-8085-48b1beb96f53', 'fashion', 'women'), -- Shoes Available in All Colors (Size 37-42)
  ('ab94b8ac-bac3-4c98-9b91-24f2193f4db8', 'fashion', 'women'), -- Shoes Available in All Colors (Sizes 37-42)
  ('463f9062-d11f-438e-9828-a718ae684f68', 'fashion', 'women'), -- Shoes Available in All Colors (Sizes 37-42)
  ('fb1f9a97-c2c3-4067-874f-5fcef799e323', 'fashion', 'women'), -- Shoes Size 27 to 34
  ('2cc8886c-cc71-4a24-924e-1886d6ea414f', 'fashion', 'women'), -- Shoes Sizes 37-41 All Colors
  ('02319950-d2e3-43f6-ba29-0c60245c948c', 'fashion', 'women'), -- Shoes Sizes 7-12
  ('74455a75-bb5c-4a7b-8b2a-e6334db34891', 'fashion', 'women'), -- Shoes Sizes 7-12
  ('3dd755c8-955d-4aa5-bd2b-4f60f49da52a', 'fashion', 'women'), -- Silver Flower Pendant Necklace
  ('5c7ccfe6-59fc-4937-b08d-7dc971405978', 'fashion', 'women'), -- Silver Glitter Rhinestone Bow Mule Heels
  ('c3424966-a8d5-464e-8de3-31e1319f9ed7', 'fashion', 'women'), -- Silver Quilted Chain Handbag
  ('ed65b828-3598-4dd0-9474-d3093b93df09', 'fashion', 'women'), -- Simple Ross slides
  ('ce59b429-4017-42a8-9c82-d2e333ac061f', 'fashion', 'women'), -- Size 41 Shoes
  ('722537ae-7ceb-40fd-a72b-ea4eb41a5904', 'fashion', 'women'), -- Skirt
  ('688147fb-8a94-4758-ab00-7706e190bc31', 'fashion', 'women'), -- Small Size Chinese Product (was other)
  ('a3d5cbf7-3c07-45fe-a740-4f540fc19798', 'fashion', 'women'), -- Snatched Abaya Gown - Black
  ('d5a61977-79d7-4cd2-8d9a-d639838ded3b', 'fashion', 'women'), -- Snatched Abaya Gown - Pink
  ('42a6c17c-0486-48bb-8c35-b86a80905879', 'fashion', 'women'), -- Spicy Graphic T-Shirt
  ('d425a9aa-1ee1-4ba1-b16c-b0f31cf91c4e', 'fashion', 'women'), -- Spicy Long Sleeve T-Shirt
  ('9cc4aab1-2675-4063-a1f8-36c16b387af2', 'fashion', 'women'), -- Stainless Steel Gold-Plated Heart Pendant Necklace & Earring
  ('8e5b8b7e-ad24-46a1-8580-d40b5f54246b', 'fashion', 'women'), -- Stainless Steel Rose Jewelry Set
  ('c4adab9a-5f3c-4fd4-a573-137a346c6605', 'fashion', 'women'), -- Star Thick Tote Bag
  ('14ea28f6-14ad-4fb5-bd45-410413001c85', 'fashion', 'women'), -- Stock Bag
  ('3d4dac79-6db3-41d4-9086-9bf822577faf', 'fashion', 'women'), -- Strawberry Print Baby Bibs
  ('21e3164a-d767-4cc7-8c35-a4f7de00fb1b', 'fashion', 'women'), -- Strip Chic 2pcs Set
  ('ef8e8de0-4690-45df-a9a2-6f682edadf10', 'fashion', 'women'), -- Striped Blouse and Maroon Leggings Set
  ('66f12596-77de-4e5c-8937-3a011ebd44f5', 'fashion', 'women'), -- Striped Blouse and Maroon Leggings Set
  ('6fc3f3c5-1103-4492-a951-7e8b64d74cd3', 'fashion', 'women'), -- Striped Jersey Dress with Number 17
  ('902f84a3-a2ba-458f-a007-e8aeb040ce91', 'fashion', 'women'), -- Striped Knitted Two-Piece Set
  ('f4cb5fa0-2155-4851-ae26-fd88140fa1a9', 'fashion', 'women'), -- Striped Polo Top and Brown Culotte Set
  ('2100d058-80b2-4e88-b69c-5217375e3044', 'fashion', 'women'), -- Striped Sleeveless Midi Dress
  ('aa2c03ed-b833-4387-8758-127fd548da58', 'fashion', 'women'), -- Striped Two-Piece Tracksuit Set
  ('bd2dbdb2-b160-40b6-9aab-1f9f29ceb126', 'fashion', 'women'), -- Striped Women's Blouses
  ('007f800c-e279-4bc2-9832-89129cb15038', 'fashion', 'women'), -- Student combo (joggers, maxi skirt, basic top and hairband)
  ('8fe6b314-f996-4e73-afc3-c5f0e41d69c9', 'fashion', 'women'), -- Stylish Heels
  ('478fea71-169d-4aa6-9ffb-399a6c861241', 'fashion', 'women'), -- Tan Lace-Up Wide Leg Trousers
  ('5341a980-ecca-4a3f-9dd2-b9ae31e95460', 'fashion', 'women'), -- The Muse Necklace Sculpture (Big)
  ('2e48540c-9519-4b8d-a2b4-b1992333aadf', 'fashion', 'women'), -- The Muse Necklace Sculpture (Medium & Big)
  ('7d5f9f82-8572-4243-b78c-b0921673d415', 'fashion', 'women'), -- The Muse Necklace Sculpture (Medium)
  ('631ef14a-8fa1-4f6f-829d-a61cc6166c05', 'fashion', 'women'), -- Thick Belt Tote Bag
  ('fbdfe0d3-62cb-4ff7-962b-2bfc0f123ce0', 'fashion', 'women'), -- Thick Doll Tote Bag
  ('3cb2014a-bda6-4cd8-9068-c9b1cc38b605', 'fashion', 'women'), -- Thick Tote Bag - Dark Brown
  ('0b63b6ca-87b5-48a0-a57a-201b29cf4425', 'fashion', 'women'), -- Thick Tote Bag - Light Brown
  ('115bee0f-2581-4b05-b7e4-8e4a4fff46d4', 'fashion', 'women'), -- Tie-Dye Long Sleeve Maxi Dress
  ('3b16e9d7-895e-43aa-a0ff-95d8c406035b', 'fashion', 'women'), -- Tiny Stud Earrings
  ('207333e8-ac8b-46c5-99e7-a32f86dd5099', 'fashion', 'women'), -- Tiny Stud Earrings
  ('4a67b00b-7c37-46d5-98dd-7a8caccb736e', 'fashion', 'women'), -- Top 6800
  ('b8576b44-f007-4661-af3d-8888df5df16e', 'fashion', 'women'), -- Top and Short Set
  ('898bad6a-b68c-4ed4-ba10-e1650402bf40', 'fashion', 'women'), -- Top and Skirt Set (S, M, L)
  ('615674ed-e060-4d5b-8d10-7c8d6bf4b569', 'fashion', 'women'), -- Top So Beautiful
  ('12455dbd-52ce-4556-9570-550d31daabb2', 'fashion', 'women'), -- Tops
  ('8cc77ec8-c0ad-46c1-9ec2-d628bacbd9a7', 'fashion', 'women'), -- Tote bag
  ('47294f9e-9d9c-48f9-a713-d87bdb2b0922', 'fashion', 'women'), -- Tote Bag
  ('4300512d-7d94-4016-88a7-634af3cd0d05', 'fashion', 'women'), -- Tote Bag
  ('11fa91c1-19e0-4162-b932-3afee784331a', 'fashion', 'women'), -- Tote Bag
  ('10028266-46d8-424c-a69c-e3bd9f2e219c', 'fashion', 'women'), -- Tote Bag
  ('4f9407fa-1371-4848-964a-fe0b17169196', 'fashion', 'women'), -- Tote Bag and Slippers Combo
  ('71110eb8-1e91-4285-9396-a93e54d31efd', 'fashion', 'women'), -- Turkey Gown
  ('4a9f26b9-96ff-4ef0-b25c-a58eac04a852', 'fashion', 'women'), -- Turkey Gown
  ('01a20d0c-5b92-4671-9e61-9d0d17b00391', 'fashion', 'women'), -- Two in One LV Bag
  ('033f9c59-dedf-4bc1-b00a-0498f165bb57', 'fashion', 'women'), -- Two in One Tote Bag (Brown & Nude)
  ('19ac09bc-613a-46a2-a908-c07ce8c0082b', 'fashion', 'women'), -- Two pieces (2 pcs)
  ('e14cf475-1e2d-45a9-bd33-e87cc5cdfe49', 'fashion', 'women'), -- Upgraded Coach 37-42 Black
  ('754f19ea-1251-4dab-b6e2-d753ef07e3fe', 'fashion', 'women'), -- Upgraded Coach 37-42 Brown
  ('40871d2f-a4d4-469b-bbd6-dfb4d1c8288d', 'fashion', 'women'), -- Upgraded Thick-Soled lightweight Sandals, Stylish Summer San
  ('eb5ddd50-05ea-48d6-b356-85a20007f200', 'fashion', 'women'), -- Valentino VLogo Tote Bag in Brown
  ('3cec0282-2bde-4fff-b376-8efa75692f31', 'fashion', 'women'), -- VCA Bracelet
  ('342f7b92-6d55-47d2-99a9-72bd31330cb1', 'fashion', 'women'), -- Watch and Bead Set
  ('87b86eb5-5834-4a81-9916-8cf1f6c9be24', 'fashion', 'women'), -- White Bow Collar Neck Basic Top
  ('c2b5ff29-71a9-4341-bd20-01f696202032', 'fashion', 'women'), -- White Bow Strap Party Dress
  ('1d33f747-edb3-46da-969a-2bb64a818928', 'fashion', 'women'), -- White Floral Long Sleeve Bodycon Dress
  ('550f23b7-63b6-470d-8310-b40c9f4c3c4f', 'fashion', 'women'), -- White Floral Ruffle Dress
  ('5e173054-91ed-476d-8e7d-c28cc6e30a3c', 'fashion', 'women'), -- White Floral Two-Piece Set
  ('89ac7958-5a39-4df6-b222-7646bc27898e', 'fashion', 'women'), -- White Monogram Canvas Tote Bag
  ('73020c9d-829a-4140-88a1-89b08f40506f', 'fashion', 'women'), -- White Pointed-Toe Slingback High Heels
  ('0eb859cf-33df-4cce-af4d-d56b2f1da277', 'fashion', 'women'), -- White Polka Dot Halter Maxi Dress
  ('31736e74-dc44-499b-82ba-4a48b53cd589', 'fashion', 'women'), -- White Quilted Chain Handbag
  ('219e8f66-b34c-458f-a815-74ecc97bf0ab', 'fashion', 'women'), -- White Ribbed Sleeveless Tank Top
  ('d736b618-412c-4886-ab74-6c6301d1a29c', 'fashion', 'women'), -- White Shoes Size 37 & 38
  ('7f11b0a5-ee07-4d36-8ce8-2b1c01b1ba59', 'fashion', 'women'), -- White Short-Sleeve Bodycon Jumpsuit
  ('c6868bb7-c73f-4f04-b1ac-a1449b57fbdc', 'fashion', 'women'), -- Wine Gradient Maxi Dress
  ('0e02b649-9022-43ca-8588-0c9734c52c52', 'fashion', 'women'), -- Wine Red Bow Strap Party Dress
  ('37cabb07-6030-4b89-97b0-3318e70497e2', 'fashion', 'women'), -- Wine Red Button-Down Shirt
  ('5dafa57c-5c45-48db-97e3-996b7cc37608', 'fashion', 'women'), -- Wine Red Cut-Out Bodycon Gown
  ('aaeb41ee-f643-46f7-b9eb-0889aaf6d458', 'fashion', 'women'), -- Wine Red Fringe Maxi Dress
  ('ba8e6653-1068-445c-a135-4dad32a3ccbc', 'fashion', 'women'), -- Wine Red Satin Maxi Dress with Gold Button
  ('5362e1e5-2479-4e77-9f96-0f2a8c02cc75', 'fashion', 'women'), -- Wine Red Wide Leg Jumpsuit
  ('ced79062-befd-4c43-a95e-083ba7bdb9f8', 'fashion', 'women'), -- Wine Red Zip-Up Hoodie Tracksuit Set
  ('6f75fec0-01e5-4a4d-9d0e-0a688662c510', 'fashion', 'women'), -- With fan
  ('cd798ba4-c0d7-4da4-b881-10b7e446922c', 'fashion', 'women'), -- Women All-Season Flat soft upper sole shoes faux leather
  ('bcb9ebfe-db26-4861-89c2-cd43e970fede', 'fashion', 'women'), -- Women fancy clothing available in the above color and black
  ('713185ca-23ad-4dfa-ae50-5163b52d2fbe', 'fashion', 'women'), -- Women's 'Queen' 66 Jersey Crop Top
  ('cf09ad17-f8e1-45ff-9ed3-848f90b69229', 'fashion', 'women'), -- Women's 2-Piece Hoodie Tracksuit Set
  ('eae7ce4b-355f-49f8-94d9-204d3518b358', 'fashion', 'women'), -- Women's 2-Piece Shirt & Trouser Sets (Multiple Colors)
  ('dbaea26c-c527-47a8-bae2-c9e357867142', 'fashion', 'women'), -- Women's Belted Collar Dress (Multi-Color)
  ('df255793-0115-4273-be5d-76d2546a5476', 'fashion', 'women'), -- Women's Black Co-ord Set
  ('f7b926b7-f553-43dd-82ee-2c0d82d7a3eb', 'fashion', 'women'), -- Women's Brown Leopard Print Bodycon Dress
  ('73160424-0d0c-4eb1-b1c2-fc09745a9e5b', 'fashion', 'women'), -- Women's Brown Long Sleeve Zip-Up Bodysuit
  ('38488cd3-fe5c-48ae-a91d-9b16e1e59c1c', 'fashion', 'women'), -- Women's Deer Print Long Sleeve Co-ord Set
  ('7c880f24-eff7-4d06-9460-11ea68fcc917', 'fashion', 'women'), -- Women's Distressed Cut-Out T-Shirt
  ('e92e684f-2d50-44b8-be42-d7d98b0a0112', 'fashion', 'women'), -- Women's Fashion Shoes Breathable Sneakers & Studded Flats
  ('0198ead1-c58a-4d68-8c82-1a57c71584df', 'fashion', 'women'), -- Women's Gingham Bow Tie Top & Denim Shorts Set
  ('61a66afe-05bb-48a4-8ca7-301e083f4a1e', 'fashion', 'women'), -- Women's Halter Neck Peplum Dress
  ('bf20ffef-c870-4733-99dd-02f459ecf7ff', 'fashion', 'women'), -- Womens Heels 2026
  ('5508d015-6cc3-476c-94fe-36e1fc874310', 'fashion', 'women'), -- Women's Lace-Up Wide Leg Trousers
  ('5939b2c5-e912-4bd5-be2d-f108a2b42f59', 'fashion', 'women'), -- Women's Long Sleeve Graphic Print Tops
  ('91641b9a-1026-4445-9147-3186e5f641ea', 'fashion', 'women'), -- Women's Long Sleeve Pajama Set
  ('93ffc1ff-1964-4ea4-b969-2139838e73ab', 'fashion', 'women'), -- Women's New Summer Plus Size Vintage Solid Color Buckle Rive
  ('50832053-74bc-4364-9eee-aefd9f77f04b', 'fashion', 'women'), -- Women's One-Shoulder Bodycon Jumpsuit
  ('ac665931-e7b7-4391-a4b2-9db62b026bd0', 'fashion', 'women'), -- Women's Pink and Black Co-ord Set
  ('acc5f1ca-383a-418b-b0f5-69bd1aaa564f', 'fashion', 'women'), -- Women's Rhinestone Pointed-Toe Block Heel Pumps (HW-02094)
  ('92b611c4-7478-49dc-ad07-a234ac4aeb1d', 'fashion', 'women'), -- Women's Short Sleeve Flare Leg Jumpsuit
  ('a41b721b-d39a-4692-a45a-4deeba34a3ec', 'fashion', 'women'), -- Women's Vintage Cat-Eye Glasses Suitable for All Occasions
  ('bfae8e88-0224-4e8d-9031-1c653e16d2cb', 'fashion', 'women'), -- Women's Wide Leg Striped Trousers
  ('10c67e72-a30d-4117-a763-20d7b448cace', 'fashion', 'women'), -- Women's Wide Leg Trousers & Co-ord Sets
  ('d28bf135-7406-4ba1-b2ab-a20d194fa7a2', 'fashion', 'women'), -- Women's Wide-Leg Jorts with Graphic Print
  ('e8aeb021-c5a4-4bbb-8937-9dacad5c8897', 'fashion', 'women'), -- Yellow and Black Polka Dot Two-Piece Set
  ('aecff843-259d-406a-b0ec-a2e7b045aad3', 'fashion', 'women'), -- Yellow Embroidered 2-Piece Co-ord Set
  ('0e2aa184-78d5-468c-bf2a-a0d5dbb5b04d', 'fashion', 'women'), -- Yellow Floral Ruffle Dress
  ('7093b8d0-1a57-48dd-bfef-20252359dfd7', 'fashion', 'women'), -- Yellow Polka Dot Two-Piece Set
  ('9f317451-157b-4664-8a48-556f490bb459', 'fashion', 'women'), -- Yellow Quilted Chain Handbag
  ('58df633b-8c51-4ebe-8125-f06db4f2768d', 'fashion', 'women'), -- Yellow Ribbed Pajama Set with Blue Trim
  ('ecefe567-096e-47e5-ae98-81836eec6846', 'fashion', 'women'), -- YSL & Gucci Style Women's Shoes (Slides & Heels)
  ('034715a7-d41e-4b34-bd95-d6a28831b35d', 'fashion', 'women'), -- Zara Brand Slides in Multiple Colors
  ('c4e6c2a5-c9f1-423f-a29a-f8329aa7627e', 'fashion', 'women'), -- Zara Bubble Slides (Maroon & Tan)
  ('080ec14d-3753-4c27-be1d-7a47beff5ae9', 'fashion', 'women'), -- Zirconia Set
  ('b152a711-dd84-4db8-807b-268295de8464', 'fashion', 'women'), -- Zirconia Set
  ('d2465ebc-9eaa-444e-b1c3-2e9dbe1339c3', 'fashion', 'women'), -- Zirconia Set
  ('4403f329-16b1-4bc2-af60-9d007bccfcbd', 'fashion', 'women'), -- Zirconia Set with Box
  ('2c23cc23-9a38-429e-8745-ec0b7b2fb965', 'home', null), -- 5feet by 7 feet (was other)
  ('4c8720b2-311c-4b20-9ceb-6b1441a26dd5', 'home', null), -- 6oup bottle (was beauty)
  ('c48f2ad6-bb5c-4a56-b145-1e03a482d413', 'home', null), -- Aroma Oil (was beauty)
  ('d4557b28-66d0-4cc3-8c0e-d3c40b891746', 'home', null), -- Aroma Oil (was beauty)
  ('179feda7-d631-4775-b67c-6faad6ad511a', 'home', null), -- Aroma Oil (was beauty)
  ('d0b933dc-cd27-4aed-b700-00789bb08d4c', 'home', null), -- Ddca Pack of 8 Fragrance Oil (was beauty)
  ('7e2941da-d7e3-4878-9bad-7a1cee77dd26', 'other', null), -- ITS BACK, AND BIGGER THAN EVER (was fashion)
  ('fd03a24c-9356-41ca-933f-63bf6f94218e', 'other', null), -- 2 Bedroom Flat in Ishior (was home)
  ('c0f6c59b-5824-4264-9798-b492e024bc61', 'other', null), -- 2-Bedroom Flat for Rent in Oviogbe (was home)
  ('79a2e488-f642-4967-8b96-b89b0f7d7a32', 'other', null), -- 2-Bedroom Flat with Kitchen Cabinets in Okhun (was home)
  ('503155f8-d7bc-4bf2-bb2e-7e0ae232197b', 'other', null), -- 3 Bedroom Apartment in Ishior (was home)
  ('31aaf40b-2ae6-4ad1-9060-d23f3ab8414f', 'other', null), -- 3 Bedroom Apartment in Isihor (was home)
  ('caf66ed4-5d95-4da9-9e17-0de21be24ee1', 'other', null), -- 3 Bedroom Flat with Fenced Compound in Isiohor (was home)
  ('54e906b0-0275-465a-a4ca-7166fe919b90', 'other', null), -- 4 Bedroom Apartment For Rent in Isihor (was home)
  ('d1d8410f-9884-4ad5-a5a0-1a58d8ba3cb8', 'other', null), -- 4-Month Sublet Sharp Semi-Selfcon on Edo Street (was home)
  ('2731c83c-fc4b-46c3-a980-01409297e407', 'other', null), -- Brand New 3-Bedroom Flat with Ensuite at Ishior Axis (was home)
  ('afb88337-3792-4536-9991-a57fe3b9f21a', 'other', null), -- Clean Pop 2 Bedroom Apartment in Oluku (was home)
  ('0a4254bb-896f-4b9f-a723-4e93c36e144b', 'other', null), -- Dry 3 Bedroom Apartment in Ishior - Light (was home)
  ('3ddd2a96-6b73-40aa-a747-3e1ae181a346', 'other', null), -- Furnished Room and Parlour at BDPA (was home)
  ('6bce4ba1-8a53-473b-b2fa-6c203544a2a8', 'other', null), -- Keystone male (was home)
  ('fdeba80c-7111-4e48-a1c5-bb164f7cc8b8', 'other', null), -- Luxurious 3 Bedroom Apartment in Ugbowo (was home)
  ('d83870ac-9334-4697-8180-c342e1788be6', 'other', null), -- Male Roommate Needed in Self-Contained Room (was home)
  ('033b6b7b-fe6b-4239-a43a-e4a007371aa7', 'other', null), -- Male Roommate Needed in Self-Contained Room (was home)
  ('d3ca9819-493d-4ec0-93cd-60c648a673a6', 'other', null), -- Massive Self-Contained Apartment in Ekosodin (was home)
  ('ef0a2f04-4e76-4d34-a555-8a162165a846', 'other', null), -- Neat 2 Bedroom Apartment for Rent in Ugbowo (was home)
  ('a5466a40-24e8-4404-b869-63d0ca333294', 'other', null), -- Room and Parlour for Rent (was home)
  ('67f27e6a-24c5-490f-b874-03b9f1cd7c32', 'other', null), -- Self Contained Room with Tiled Portable Iron Door (was home)
  ('9a655521-d8b9-44bf-a4c1-23def177edfc', 'other', null), -- Self-Contain Apartment in Ugbowo (was home)
  ('fb1603f1-5985-4bd2-90a7-7268c31cd123', 'other', null), -- Self-Contained Apartment for Rent in Evidence (was home)
  ('6ed840fb-a0a3-4786-957f-ae1005ce43c3', 'other', null), -- Self-Contained Apartment in Ekosodin, Newton Street (was home)
  ('6dacf8a4-2309-46a6-9297-deff0372750f', 'other', null), -- Sharp 2 Bedroom Flat to Let (was home)
  ('20e4823c-119d-45e2-88ca-9f48886fcaa6', 'other', null), -- Sharp Pop Room and Parlour Apartment for Rent (was home)
  ('990fa209-53ab-44ac-ab86-11bb08d82f61', 'other', null), -- Sharp Room and Parlour at BDPA (was home)
  ('71dc980c-b756-48b1-bf11-77351ab487b6', 'other', null), -- Sharp Self-Contained House in Edo (was home)
  ('f0d6aff4-d3ed-4c89-afc1-0fd05b185f62', 'other', null), -- Sharp Standard Pop Room & Parlour Apartment (was home)
  ('f83d1c1e-108f-400d-82de-9c09d82d5aed', 'other', null), -- Simple Pop 2 Bedroom Flat for Rent (was home)
  ('f68fab01-bc17-4e1a-bc76-e06fbf4b4597', 'other', null), -- Spacious Self-Contained Apartment in EkoSodin (was home)
  ('8078ef55-a39b-4c7a-a6fc-0fd84ab1ab97', 'other', null), -- Spacious Self-Contained Apartment in EkoSodin (was home)
  ('a134a8b1-9c90-450a-9982-9a57e3b6f380', 'other', null), -- Spacious Self-Contained Flat at BDPA (was home)
  ('9fb062f5-3826-450e-9a29-085916ed3fd7', 'other', null), -- Spacious Tiled Self Contained Apartment (was home)
  ('4901aeaa-18c6-48c3-b395-45b34f082887', 'other', null), -- Standard 2 Bedroom Flat for Rent (was home)
  ('c7dc4d9c-1e15-4071-870b-eb3be1f31401', 'other', null), -- Standard 3 Bedroom Decking House (was home)
  ('47686e88-c68e-44b5-bf10-2865b1d3a2ae', 'other', null), -- Standard Brand New Room and Parlour (was home)
  ('2acebf6d-c793-4dee-ac44-d27795d2991b', 'other', null), -- Standard POP 2 Bedroom Apartment in Oluku (was home)
  ('81c44d0a-39e7-40bf-a379-94eb581adf8a', 'other', null), -- Standard POP 2 Bedroom Flat in Ishior (was home)
  ('4b76ca45-3e5b-4ea3-8e2d-dd858258692d', 'other', null), -- Standard Room Selfcon in Ugbowo (BDPA) (was home)
  ('b309f615-dfea-44f0-a66c-350e71082cba', 'other', null), -- Tiled Self-Contained Apartment in Eko (was home)
  ('a51cdf5b-a70d-4b50-a879-0135e878de55', 'other', null), -- What do you meanfor hall 1 bed B (was home)
  ('befa4d0b-5176-4690-8eba-a0a741bf1998', 'other', null), -- Yamaha Drum set drum stick 5a maplewood (was electronics)
  ('e13aefc7-a91a-4ae8-a482-14b4a4f6980f', 'phones', null), -- 2 Units 11th Gen 128GB Laptops (was electronics)
  ('a5fb38ad-2eed-4b4c-aad9-78a9f30e14f0', 'phones', null); -- Tripod stand/selfie (was fashion)

-- The review is applied as it is, so the rules above do not second-guess it.
alter table public.products disable trigger buysell_products_assign_category;

with photo as (
  select p.id, p.category as old_category, r.category as new_category
  from public.products p
  join buysell_photo_review r on r.id = p.id
  where lower(btrim(coalesce(p.category, ''))) <> r.category
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

update public.products p
set audience = r.audience
from buysell_photo_review r
where r.id = p.id and p.audience is distinct from r.audience;

alter table public.products enable trigger buysell_products_assign_category;

-- Products added after the review: the category rules above.
with proposed as (
  select id, category as old_category, public.buysell_category_from_text(name) as new_category
  from public.products
  where created_at > '2026-11-07 20:03:58.069729+00'
    and lower(btrim(coalesce(category, ''))) in ('electronics', 'fashion', 'home', 'phones', 'beauty', 'sports', 'other')
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

-- Every other fashion or beauty product: who it is for, from its words.
update public.products
set audience = coalesce(public.buysell_audience_from_text(name), public.buysell_audience_from_text(description))
where audience is null
  and lower(btrim(coalesce(category, ''))) not in ('electronics', 'home', 'phones', 'sports', 'dropship', 'other')
  and coalesce(public.buysell_audience_from_text(name), public.buysell_audience_from_text(description)) is not null;

drop table buysell_photo_review;
