-- An Arts & Crafts category.
--
-- Shoppers can browse Arts & Crafts (/category/arts) and sellers can list
-- in it. Its key in public.products.category is 'arts'.
--
--   1. public.buysell_category_from_text() also knows art and craft
--      supplies and handmade crafts: paintings, easels, canvases, paint
--      brushes, sketchbooks, crayons, resin art, yarn and crochet hooks,
--      embroidery and sewing kits, beading kits, glue guns, craft clay.
--      Wall art, sculptures and figurines stay in Home, as decor.
--   2. The category trigger knows 'arts'. Arts & Crafts products have no
--      audience (Men or Women), and a seller's choice of Arts & Crafts is
--      kept even when the name also names a bag or a vase, since handmade
--      pieces are often both.
--   3. Four listings move to Arts & Crafts, recorded in
--      public.product_category_fixes: the artist's easel (listed under
--      Beauty), "Handmade Gift Items" (Fashion) and two custom resin
--      journals (Other).
--
-- To undo step 3:
--   update public.products p set category = f.old_category
--     from public.product_category_fixes f
--     where f.product_id = p.id and f.new_category = 'arts' and f.fixed_at >= '2026-11-11';

-- As in 20261108010000_men_women_sections.sql, plus Arts & Crafts.
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
      (5, 'beauty', '\mhair (straighteners?|clippers?|dryers?|curlers?|growth|extensions?|oils?|tools?|serums?)\M|\mbody (mists?|sprays?|oils?|lotions?|creams?|wash|butters?|scrubs?|splash)\M|\mface (wash|masks?|creams?|serums?)\M|\mlip ?(gloss|sticks?|balms?)\M|\mnail (polish|kits?|lamps?|dryers?|art)\M|\mskin ?care\M'),
      -- Last, so "nail art" is already beauty. Plain "art", "canvas", "crochet",
      -- "embroidery", "yarn", "acrylic" and "clay" are left to these phrases:
      -- alone they are as often a print, a tote, braids, a dress, nails or a mask.
      (6, 'arts', '\mart (supplies|materials|kits?|sets?|brushes|papers?|boards?|easels?|canvas(es)?|markers?)\M|\martists? (brushes|paints?|easels?|canvas(es)?|pencils?|markers?)\M|\m(acrylic|oil|poster|fabric|glass|watercolou?r) paints?\M|\mpaint ?brush(es)?\M|\mpaint (sets?|kits?|markers?|pens?|palettes?)\M|\mpalette (knife|knives)\M|\mcanvas (paintings?|boards?|panels?|art|prints?|rolls?)\M|\m(stretched|blank) canvas(es)?\M|\mcolou?r(ing|ed) (pencils?|books?|sets?)\M|\mdrawing (books?|pads?|pencils?|sets?|boards?|papers?)\M|\msketch(ing)? (books?|pads?|pencils?|sets?)\M|\m(charcoal|graphite|pastel) pencils?\M|\moil pastels?\M|\m(alcohol|paint|brush) markers?\M|\mdiamond (painting|art)( kits?)?\M|\mresin (art|moulds?|molds?|kits?|journals?|crafts?|pigments?|coasters?)\M|\m(epoxy|uv) resin\M|\mcrochet (hooks?|yarns?|kits?|patterns?|threads?)\M|\mknitting (needles|yarns?|kits?|wool)\M|\m(crochet|knitting|acrylic|cotton|milk cotton|wool) yarns?\M|\myarn (balls?|sets?|bundles?|packs?)\M|\membroidery (hoops?|kits?|threads?|floss|machines?)\M|\mcross[- ]stitch(es)?\M|\msewing (kits?|machines?|threads?|needles?)\M|\mcalligraphy (pens?|sets?|kits?|brushes|ink)\M|\mbeads? (making|crafts?|kits?|supplies)\M|\mbeading( kits?| wires?| threads?| supplies)?\M|\mglue guns?\M|\mhot glue\M|\m(polymer|modell?ing|air[- ]dry) clay\M|\mpottery wheels?\M|\mhandmade (gifts?|crafts?|items?|cards?|art)\M|\mcustom portraits?\M|\m(portrait|pencil) (paintings?|drawings?|sketch(es)?)\M')
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
      ('arts', '\m(paintings?|artworks?|easels?|sketchbooks?|sketchpads?|crayons?|watercolou?rs?|crafts?|crafting|handicrafts?|handcrafts?|origami|scrapbooks?|scrapbooking|macrame|knitting|crocheting)\M'),
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
  elsif current_category in ('electronics', 'fashion', 'home', 'phones', 'beauty', 'sports', 'arts', 'dropship') then
    new.category := current_category;
    -- Only when a product is added: a later edit is a deliberate choice.
    -- Dropship and Arts & Crafts are kept as chosen: a handmade bag is still
    -- a craft, and a dropship listing can be anything.
    if tg_op = 'INSERT' and current_category not in ('dropship', 'arts') and from_name is not null and from_name <> current_category then
      new.category := from_name;
    end if;
  end if;

  -- Who it is for. Only fashion, beauty and sellers' own categories have one.
  if new.category in ('electronics', 'home', 'phones', 'sports', 'arts', 'dropship', 'other') then
    new.audience := null;
  elsif chosen_audience in ('men', 'women', 'unisex', 'kids') then
    new.audience := chosen_audience;
  else
    new.audience := coalesce(public.buysell_audience_from_text(new.name), public.buysell_audience_from_text(new.description));
  end if;
  return new;
end;
$$;

-- The listings already in the catalogue that are arts and crafts. The
-- trigger keeps 'arts' and clears their audience.
with moved as (
  select p.id, lower(btrim(coalesce(p.category, ''))) as old_category
  from public.products p
  where p.id in (
    '1bd88422-f53d-4db1-829b-4a07bc01e1ec', -- EASEL Stand (Beauty)
    '8c0e19f8-956e-4273-97c2-fe58564e7da2', -- Handmade Gift Items (Fashion)
    'cb1c40de-e723-4fa5-9622-68ba159015fd', -- Custom Resin Journal A5 (Other)
    '58a390e2-16a4-4643-8ae5-234b17e9e0e0'  -- Custom Resin Journal A7 (Other)
  )
    and lower(btrim(coalesce(p.category, ''))) <> 'arts'
),
changed as (
  update public.products p
  set category = 'arts'
  from moved
  where moved.id = p.id
  returning p.id, moved.old_category
)
insert into public.product_category_fixes (product_id, old_category, new_category)
select id, old_category, 'arts' from changed;
