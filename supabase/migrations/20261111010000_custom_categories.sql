-- Sellers' own categories.
--
-- The Add Product form has offered "Custom category" since August 2026
-- ("Baby Products", "Auto Parts"), and the marketplace lists such categories
-- under "More categories", but products_category_check only allowed the
-- built-in ones, so no custom category could ever be saved.
--
--   1. products_category_check allows a seller's own category: 2 to 60
--      characters, lower case with single spaces, without < > " ` \ or
--      control characters, and not a page name (all, trending, women, men,
--      upcoming) or the form's own "custom" option. manage-product applies
--      the same rules and also requires a letter.
--   2. The category trigger stores a seller's own category in that form
--      (lower case, trimmed, single spaces), whichever way it arrives.
--
-- Nothing in the catalogue changes: every product has a built-in category.

alter table public.products drop constraint if exists products_category_check;
alter table public.products add constraint products_category_check check (
  category in ('electronics', 'fashion', 'home', 'phones', 'beauty', 'sports', 'arts', 'dropship', 'other')
  or (
    char_length(category) between 2 and 60
    and category = btrim(regexp_replace(lower(category), '\s+', ' ', 'g'))
    and category not in ('all', 'trending', 'women', 'men', 'upcoming', 'custom', '__custom__', 'custom-category', 'custom_category')
    and category !~ '[<>"`[:cntrl:]]'
    and strpos(category, chr(92)) = 0 -- a backslash
  )
);

-- As in 20261111000000_arts_and_crafts_category.sql, plus sellers' own categories.
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
  else
    -- A seller's own category, as products_category_check expects it.
    new.category := btrim(regexp_replace(current_category, '\s+', ' ', 'g'));
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
