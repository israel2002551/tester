-- Every product listed under "Other", sorted into a proper category and renamed.
--
-- On 20 November 2026 the 123 products in Other (111 live, 12 awaiting review)
-- were looked at photo by photo. Nearly all were WhatsApp imports whose posts
-- said little ("2 Pieces", "Half.", "37-42"), so the importer could not tell
-- what they were. Each now has a category, a name that says what it is, and,
-- for fashion and beauty, who it is for (Men and Women pages):
--   fashion              98
--   beauty               9
--   arts                 7
--   services             2
--   toys & games         2
--   home                 2
--   electronics          2
--   musical instruments  1
--
-- Three new categories hold what fits no existing one: "toys & games",
-- "musical instruments" and "services" (a baking class). They appear under
-- "More categories" on the marketplace.
--
-- One "product" was a screenshot of a tech event, not something for sale: it
-- is set to rejected so it no longer shows.
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

create table if not exists public.other_category_review (
  product_id uuid primary key,
  old_name text,
  old_category text,
  old_audience text,
  old_status text,
  new_name text not null,
  new_category text not null,
  new_audience text,
  new_status text,
  reviewed_at timestamptz not null default now()
);
-- Only the SQL editor and the service role read this.
alter table public.other_category_review enable row level security;
revoke all on public.other_category_review from anon, authenticated;

drop table if exists buysell_other_review;
create temporary table buysell_other_review (
  id uuid primary key,
  category text not null,
  audience text,
  name text not null,
  status text
);
insert into buysell_other_review (id, category, audience, name, status) values
  ('befa4d0b-5176-4690-8eba-a0a741bf1998', 'musical instruments', null, 'Yamaha 5A Maplewood Drumsticks', null), -- 1. was: Yamaha Drum set drum stick 5a maplewood
  ('9f722e08-ca6b-4428-bd9a-619ec7da1689', 'services', null, 'Endy Bakery Beginners Baking Class (5 Weekends, In Person)', null), -- 2. was: Endy Bakery Beginners Class 1.0: 5-Week Baking Cou
  ('c5aa82cd-b0f4-4ba7-99ef-1eb606ae867d', 'toys & games', 'kids', 'Y-Pad English Learning Computer for Kids', null), -- 3. was: Kids Play Pad
  ('e2748412-3e28-42bb-b863-a6339c9e89cf', 'fashion', null, 'Watch and Jewellery Gift Box', null), -- 4. was: Combo Box
  ('9de17eff-93fe-433c-9cc1-8c91ad6b75e5', 'beauty', 'unisex', 'Lattafa Vintage Radio Eau de Parfum', null), -- 5. was: Available for pickup
  ('dd7bec3f-8c45-4d0d-90d3-bca7ee5d1185', 'services', null, 'OCX Africa 2026 Event Post (Not a Product)', 'rejected'), -- 6. was: Quality physical AI stuffs happening at OCX’ Afric
  ('12e9f628-16a2-41c6-a081-6208068b1d9e', 'arts', null, 'Customised Resin Bookmark, Pen and Keychain Set', null), -- 7. was: Customised Stationery Set with Bookmark, Pen & Key
  ('b4a6e9c6-aa4a-4e17-8748-50c39aea4829', 'arts', null, 'Customised Resin A5 Journal, Pen and Keychain Set', null), -- 8. was: Customised Stationery Set with Journal & Pen
  ('81cb6e53-1225-4d82-bcc7-3cd6b841accf', 'arts', null, 'Customised Resin Bookmark, Pen and Keychain Gift Set', null), -- 9. was: Customised Stationery Set (Bookmark, Pen, Keychain
  ('588de906-545f-43f2-a8c8-02b003329a63', 'fashion', 'men', 'Men''s Iced-Out Pendant Chain Necklace', null), -- 10. was: 🏷️: each
  ('af4efb77-b866-48e2-a01f-6e9f131b2fb1', 'arts', null, 'Customised Resin Pen and Initial Keychain Set', null), -- 11. was: Customised Stationery Set with Pen & Keychain
  ('60d0ba82-bfb0-4b5d-9cbc-04888dac11d0', 'arts', null, 'Customised Resin Pen', null), -- 12. was: Customised Pen
  ('4be70b79-45da-40e1-91c7-0e428bb74434', 'arts', null, 'Customised Resin A5 Journal with Charms', null), -- 13. was: Customizable A5 Journal with Charms
  ('b6527e26-b79e-4b3a-b9b4-31fedaf5bcb1', 'fashion', 'women', 'Women''s Embellished Bodycon Midi Dress (6 Colours)', null), -- 14. was: Luxury Gift for Classy Mamas
  ('611de19b-8a6e-454d-9e91-50ae299c40be', 'fashion', 'women', 'Women''s Star Print Wide-Leg Joggers', null), -- 15. was: Discount
  ('c51dec13-5600-4c99-b515-9bfa914b64a1', 'fashion', 'women', 'Women''s 3-in-1 Corporate Set (Shirt, Waistcoat and Trousers)', null), -- 16. was: 3 in 1 women corporate
  ('f74c8145-ea40-4614-8b84-97e78e95eed6', 'fashion', 'men', 'Montblanc Men''s Chronograph Watch with Leather Strap', null), -- 17. was: Mont Blanc Pen
  ('14e77c13-b198-464d-8d1c-62d6517b4335', 'fashion', 'women', 'Women''s Off-Shoulder Top and Wide-Leg Trousers Set', null), -- 18. was: 2 Pieces
  ('4205d102-1c26-44fb-af42-af1d3806610f', 'fashion', 'women', 'Women''s Ribbed Crop Top and Flared Trousers Set', null), -- 19. was: 2 Pieces
  ('c7b658e9-5b16-4f07-9328-21a813687308', 'fashion', 'women', 'Women''s Cami Top and Trousers Set', null), -- 20. was: 2 Pcs women wear
  ('7eadf24f-ecb0-4926-81c8-a7a87672114e', 'fashion', 'women', 'Women''s Leopard-Trim Off-Shoulder Top and Flared Trousers Set', null), -- 21. was: 2 Pieces
  ('169d4f4f-632c-4f09-8f25-c82630297b5b', 'fashion', 'women', 'Women''s Square Rhinestone Wristwatch', null), -- 22. was: No box
  ('f11089d2-34c4-4810-a028-73aac9c8cab3', 'fashion', 'women', 'Women''s Pendant Necklace in Gift Box', null), -- 23. was: No box
  ('8b3fd9f1-81d2-456d-b1b3-5039e0ef577a', 'fashion', 'women', 'Women''s Bell-Sleeve Bodycon Maxi Dress (Yellow, Black, Pink)', null), -- 24. was: Yellow, Black & Pink Items
  ('b644af4d-bdb0-47ba-ba52-ad565ab0883e', 'beauty', null, 'Arabian Eau de Parfum (55ml)', null), -- 25. was: 55ml
  ('d560934c-e23b-4d5b-be68-a36b58922f51', 'beauty', null, 'Lattafa Eau de Parfum (50ml)', null), -- 26. was: 50ml
  ('904dfd92-edc2-4b00-9c44-0aa8ab1bbf75', 'beauty', null, 'Mousuf Eau de Parfum (25ml)', null), -- 27. was: 25ml
  ('148cda9c-1d62-442e-a724-b86b87210d05', 'fashion', 'women', 'Women''s Denim Hooded Pullover Top', null), -- 28. was: Only two pieces came
  ('23d1fe20-a562-408d-9748-169dad454339', 'beauty', 'men', 'Boss Man Perfume Combo (4 Fragrances)', null), -- 29. was: Boss Man Combo
  ('15398c72-b018-4bbb-842a-349f79b3ac60', 'fashion', 'women', 'Women''s Crop Shirt and Leopard Wide-Leg Trousers Set', null), -- 30. was: 2 Pieces
  ('90008372-66c9-4108-8869-0ca905314cf1', 'fashion', 'women', 'Women''s Chunky Sport Sandals (37-42)', null), -- 31. was: Best seller
  ('952e4d0c-1e1f-4b2b-98b6-df3ce07df610', 'fashion', 'kids', 'Girls'' Red Heart Top and Denim Skirt Set (5-14 yrs)', null), -- 32. was: 5yrs to 14yrs
  ('471f7630-c2e9-4678-b5af-aadc2c563b65', 'fashion', 'men', 'Audemars Piguet Iced-Out Black Watch', null), -- 33. was: AP Stone
  ('b55571c4-5256-4a12-8441-c1b14f5e8273', 'fashion', 'men', 'Montblanc Men''s Leather-Strap Watch', null), -- 34. was: Montblanc Pen
  ('9ee1fdc2-c565-4417-bb12-d49d5edca8a0', 'fashion', 'men', 'Real Madrid Football Jersey (Medium)', null), -- 35. was: Medium size 8500
  ('c71b6e1b-328d-4f9b-8f53-da47c72ad253', 'home', null, 'Artificial Palm Plant in Ribbed Fibre Pot (7ft, White or Gold)', null), -- 36. was: RING fibre W BIG plant
  ('7b6b912b-567a-4256-a371-d76a4f4cb060', 'fashion', 'women', 'Women''s Belted Pleated Maxi Shirt Dress', null), -- 37. was: Picture colors available ☺️
  ('61dc7636-0289-451e-9ee4-0801c55ad3d9', 'fashion', 'women', 'Women''s Twist-Front Wrap Maxi Dress', null), -- 38. was: Black Item
  ('f65fb164-75dd-4f9b-994a-c72828210cf0', 'fashion', 'women', 'Women''s Woven Clutch Bag (All Colours)', null), -- 39. was: All colors Available
  ('dcb90836-4f31-4a1d-9cbc-8f7237896c11', 'fashion', 'men', 'Men''s Camo Boxer Shorts (Single)', null), -- 40. was: 2500 each
  ('0b9c2a3a-aa80-4595-901e-ac66d3ed5e21', 'fashion', 'men', 'Men''s Camo Boxer Shorts (Pack of 12)', null), -- 41. was: .Dozen.(12 pieces)
  ('d749f30f-95eb-45b6-adb0-2c5b254f2c86', 'fashion', 'men', 'Men''s Camo Boxer Shorts (Pack of 6)', null), -- 42. was: Half.
  ('4f73d9dd-6b97-454f-9b10-043d3bc1d9ff', 'fashion', 'kids', 'Girls'' Cami Top and Shorts Set (Purple or Black)', null), -- 43. was: Kids' Item – Purple or Black
  ('f1c463ce-12a5-4852-b361-6a3060d52301', 'fashion', 'women', 'Women''s Lace Panties (Pack of 12)', null), -- 44. was: . Dozen Half. 8500
  ('e1be7ee7-7ea2-497b-ae1c-64b4a5f87c39', 'fashion', 'women', 'Women''s Lace Briefs (Pack of 12, Assorted Colours)', null), -- 45. was: 16500.Dozen Half.9000. no color Selection for pant
  ('0b9d999a-f107-407f-9c8a-f73cfaf43afa', 'fashion', 'kids', 'Girls'' Butterfly-Back Bralettes (Pack of 12)', null), -- 46. was: 13500. Dozen(12 pieces) 7500.Half For children
  ('283236b7-fcc6-45e1-8ee3-89ee08a67b9c', 'fashion', 'women', 'Women''s Lace Criss-Cross Panties (Pack of 12)', null), -- 47. was: 12500. Dozen
  ('083a8767-0c19-470f-95d5-0f601f7da554', 'fashion', 'women', 'Women''s Lace Criss-Cross Panties (Pack of 6)', null), -- 48. was: Half.
  ('0e1f9a26-5576-48e7-9b21-80b22d567dce', 'fashion', 'women', 'Women''s Cotton Panties (Pack of 12)', null), -- 49. was: 15000. Dozen. Half. 8000
  ('f58b9b2e-e4b1-41b3-8f01-558b3bbd3673', 'fashion', 'women', 'Women''s Seamless Mesh Panties (Pack of 12)', null), -- 50. was: 15500 dozen Half. 9000
  ('339f84d6-a749-4671-bf27-087f4d2a01e8', 'fashion', 'women', 'Women''s Seamless Angel Panties (Pack of 12)', null), -- 51. was: 15000. dozen half.
  ('9f4279e4-e885-4f35-a0aa-cb9b48e8a0a4', 'fashion', 'women', 'Women''s Lace-Trim Panties (Pack of 12)', null), -- 52. was: 12500 dozen half
  ('3b209694-1212-4277-9e58-3f69063ba707', 'fashion', 'women', 'Women''s High-Waist Panties (Pack of 12)', null), -- 53. was: 12500 Dozen
  ('34c3eba0-c4e6-46c1-b28e-f05370894ee1', 'fashion', 'women', 'Saint Laurent Opyum Heeled Sandals (37-42, Boxed)', null), -- 54. was: Brand: Saint Laurent
  ('97d7fab7-08b9-4ec6-855f-ba87458db5af', 'fashion', 'women', 'Women''s Patent Ballet Flats (38-43)', null), -- 55. was: Available from 38-43
  ('9ffbe144-1b43-40c8-b42c-59472c9e3c6a', 'fashion', 'women', 'Women''s Patent Buckle Ballet Flats (38-43)', null), -- 56. was: Available from 38-43
  ('539399b6-16e3-46cd-ab1f-0e973f99a06d', 'toys & games', 'kids', '32-Hole Rocket Bubble Gun Toy', null), -- 57. was: Bubble Gun Toy
  ('e9794f02-c5b9-493f-a470-5de1881d2b0e', 'fashion', 'women', 'Mango Women''s H-Strap Slides (37-42, Boxed)', null), -- 58. was: 37-42
  ('a56ce0f2-c273-4a01-8518-c9a773b7ce65', 'fashion', 'men', 'Montblanc Men''s Skeleton Dial Watch', null), -- 59. was: Montblanc Pen
  ('78144d25-891c-4f96-9195-bc92d351c19d', 'fashion', 'men', 'Poedagar Men''s Mesh Strap Watch', null), -- 60. was: Poedagar
  ('26e4c65f-831a-4f19-bb8a-56082869516d', 'fashion', 'women', 'Coach Women''s Lip Print Slides', null), -- 61. was: Item for Sale
  ('807b11a7-5cd8-4486-9828-cccc9f149f84', 'fashion', 'men', 'Poedagar Men''s Chronograph Watch (Boxed)', null), -- 62. was: Poedagar 🔥
  ('5447a41a-a238-4b0e-8621-0eec8722283c', 'fashion', 'women', 'Women''s Heeled Mules (37-41)', null), -- 63. was: Available now 37 to 41 0
  ('e835f68a-6075-4881-a8f0-269ed9842017', 'fashion', 'women', 'Zara Women''s Cut-Out Flat Sandals (37-41)', null), -- 64. was: Item Size 37 to 41
  ('7e6c45d0-4c57-4546-a871-623993f6e230', 'fashion', 'women', 'Women''s Leaf-Strap Heeled Sandals (37-41)', null), -- 65. was: Item size 37 to 41
  ('147069b2-dd2e-401c-81a7-025b2bcbece6', 'fashion', 'women', 'Hermès Chypre Sandals (37-42, Boxed)', null), -- 66. was: 37-42
  ('ac7a6cbd-3999-40fa-bb8b-bc8e813b7b6d', 'home', null, 'Large Oval Wall Mirror', null), -- 67. was: Big Size Item
  ('788031cc-9c16-4e89-abac-61e3097f37bc', 'electronics', null, 'Apple Watch Series 7', null), -- 68. was: Series 7
  ('c97d3a81-ea15-4874-af45-596e3610c51b', 'electronics', null, 'Apple Watch Series 10', null), -- 69. was: Series 10
  ('8eebaee1-c0e4-47d5-ba21-1d99b71cf8b2', 'fashion', 'women', 'Women''s Ombré V-Neck Maxi Dress', null), -- 70. was:  ❤️🤎 🇨🇳
  ('2301dd79-735f-498c-a593-8727e68c2a42', 'fashion', 'women', 'Women''s Crochet Lace Kaftan Maxi Dress', null), -- 71. was:  ❤️🤎 🇨🇳
  ('c9b5a322-44fd-4b45-8403-58b47a0b3934', 'fashion', 'women', 'Louis Vuitton Rhinestone Mini Handbag (Boxed)', null), -- 72. was: 14500 boxed
  ('5d28a132-7eac-42bc-9a26-a7ff2ffd0db4', 'fashion', 'kids', 'Kids'' Denim Two-Piece Set (2-9 yrs)', null), -- 73. was: 3pcs
  ('79c5fe59-954c-4427-879d-e0c82e76d2cc', 'beauty', 'men', 'Men''s Perfume Combo: Hypnotic Oud and Rage', null), -- 74. was: combo
  ('3f06660e-ffd0-4fd4-a483-0e21cab57384', 'arts', null, 'Custom 16x24 Photo Print (Benin City)', null), -- 75. was: 16x24 Photo Print
  ('a0de4152-d104-43c6-a2f4-5f8e4c80f8fb', 'fashion', 'women', 'Women''s Embellished Blazer and Trousers Suit', null), -- 76. was: each
  ('8a45f45c-114a-45ae-a7b1-404082932651', 'fashion', 'women', 'Women''s Red Embellished Pantsuit', null), -- 77. was: each
  ('6e5a926d-39cd-4675-a86b-906697f0d2d7', 'fashion', 'women', 'Women''s Pleated Blazer Dress', null), -- 78. was: Available now
  ('e4885cc9-3f91-41e3-bd7e-12fb6c159bbc', 'fashion', 'kids', 'Kids'' Christmas Santa Pyjamas', null), -- 79. was: Children
  ('844dad2a-8d4c-4356-b3af-7cec5d891e69', 'fashion', 'women', 'Women''s Monogram Knit Top and Trousers Set', null), -- 80. was: Beige Wine Black White Product
  ('e20b35b3-bbfb-4e1e-aaf5-c47813cb002d', 'fashion', 'women', 'Women''s Monogram Knit Cardigan and Skirt Set', null), -- 81. was: Beige Black White Wine
  ('fa27b158-9c0c-42f2-b607-814c920d1e91', 'fashion', 'women', 'Women''s Halter Top and Wide-Leg Trousers Set', null), -- 82. was: Red and Pink Item
  ('009b4496-e07b-4598-965a-03085f285cc5', 'fashion', 'women', 'Women''s Striped Polo Bodycon Midi Dress', null), -- 83. was: Black pink brown black 9500🇨🇳
  ('41c10af6-a22e-46f2-a495-6acfde7149cb', 'fashion', 'women', 'Women''s Striped Belted Bodycon Midi Dress', null), -- 84. was: Available in colors 🇨🇳
  ('64a8bc94-20a4-4f1c-97a3-6c50e2718c2e', 'fashion', 'women', 'Women''s Cut-Out Top and Wide-Leg Trousers Set', null), -- 85. was: Luxury 🇨🇳 Very few white!
  ('c4af64d8-96ec-43fb-8b75-b6dca060fe1d', 'fashion', 'women', 'Women''s Batwing Ring-Detail Maxi Dress', null), -- 86. was: Best seller restocked
  ('e59b4b20-72c5-4dba-97c1-64618e7d39bb', 'fashion', null, 'Bestwin Octagon Wristwatch with Leather Strap', null), -- 87. was: Bestwin Product
  ('6492133a-16c2-4751-8f03-dd997209d836', 'fashion', 'women', 'Women''s Silver Chain-Link Wristwatch', null), -- 88. was: Women's Item
  ('b809a848-ed02-4783-8c09-9e3083c42938', 'fashion', 'women', 'Michael Kors Women''s Watch and Bangle Set', null), -- 89. was: For female
  ('64a46c33-c88c-4cca-b5bb-78fa9c42989d', 'beauty', 'women', 'Student Fragrance Combo: Body Mist, Perfume and Roll-On', null), -- 90. was: Student Combo Bundle
  ('2b0a69c9-39f8-4ffc-ac67-0a07178cff49', 'beauty', 'men', 'Men''s Perfume Combo: Hypnotic Oud and Rage', null), -- 91. was: combo
  ('b27de942-7438-4bed-ae56-0014f51ebf6d', 'fashion', 'women', 'Women''s Pink Crop Top and Flared Trousers Set', null), -- 92. was: 2 Pcs Unspecified Item
  ('738b58d9-f0d3-451e-81e2-8c9936e91f2c', 'fashion', 'women', 'Women''s Long-Sleeve Crop Top and Flared Trousers Set', null), -- 93. was: 2 Pieces
  ('a727e308-e10c-48e7-a705-e7db4853e25f', 'fashion', 'women', 'Women''s Crop Top and Capri Leggings Set', null), -- 94. was: 2 Pieces
  ('ff741927-5bf4-4ed9-aaef-c02f0de157f1', 'fashion', 'women', 'Women''s Halter Ruffle Mini Dress', null), -- 95. was: Available in different colors
  ('74616325-0f9b-4179-85a4-d8ec5f95d095', 'beauty', 'women', 'Victoria''s Secret Bombshell Perfume and Coconut Body Mist Combo', null), -- 96. was: FOR BOTH 🛍️🔥
  ('4857a17f-a94f-4b0c-a83a-a41fa3ed684a', 'fashion', 'men', 'Montblanc Men''s Star Dial Leather-Strap Watch', null), -- 97. was: Montblanc Pen
  ('690996d8-e542-41ee-a135-73073cadfcb1', 'fashion', 'men', 'Montblanc Men''s Chronograph Watch (Grey Strap)', null), -- 98. was: Montblanc Pen
  ('302f2468-8c8b-4144-bce5-73d2cb0601c5', 'fashion', 'men', 'Poedagar Men''s Square Skeleton Watch (Rubber Strap)', null), -- 99. was: Poedagar Rubber
  ('d5ff3c2c-d38d-44ee-8a79-777bf0b102ee', 'fashion', null, 'Square Leather-Strap Wristwatch', null), -- 100. was: as well
  ('dcd757af-3ccc-4144-b808-0f3ced124fa0', 'fashion', 'women', 'Women''s Belted Shirt and Wide-Leg Trousers Set', null), -- 101. was: Luxury Up and Down
  ('b6cabb4e-a066-4e10-a5ad-621f997bbb88', 'fashion', 'women', 'Women''s Rainbow Pleated Skirt and Top Set', null), -- 102. was: Luxury Up and Down
  ('89a8f009-5c52-4751-b99d-9a4b0c5e561a', 'fashion', 'women', 'Curren Women''s Two-Tone Wristwatch', null), -- 103. was: Curren
  ('a9c900e1-fc3b-48ec-9c11-3d5c249e4f8f', 'fashion', 'women', 'Women''s Floral Top and Maxi Skirt Set', null), -- 104. was: Luxury Up and Down
  ('bd8e1147-6a86-458f-b2dc-b3465fa4086d', 'fashion', 'women', 'Women''s Printed Shirt and Striped Trousers Set', null), -- 105. was: Luxury Up and Down
  ('320e9343-7d28-4642-878c-c8f366dba0e0', 'fashion', 'men', 'Men''s Baggy Denim Shorts (30-36)', null), -- 106. was: 18500 pay today get on wednesday🔥🔥🔥🔥
  ('1b462e36-2446-4d74-8179-f40fe9852df1', 'fashion', 'women', 'Women''s Leopard Tube Top and Shorts Set', null), -- 107. was: 2 Pieces
  ('63dc96d6-170a-4d5b-9525-ddbb69d453ee', 'fashion', 'women', 'Women''s Crop Top and Skort Set', null), -- 108. was: 2pcs
  ('457c85b8-2d1a-4a17-bb4f-152d503d06e0', 'fashion', 'women', 'Women''s Crop Top and Ruffle Skirt Set', null), -- 109. was: 2pcs
  ('822b1854-5c93-4917-b041-b51cb84fbab3', 'fashion', 'women', 'Women''s One-Shoulder Draped Midi Dress', null), -- 110. was: 2 Pieces
  ('6d3d37ab-7b89-45a9-9286-af9ac8dab88b', 'fashion', 'women', 'Women''s Assorted Stud Earrings Set', null), -- 111. was: Live pic
  ('ca74486d-f44a-44f5-a96d-35772bb46b94', 'fashion', 'women', 'Chanel Quilted Top-Handle Bag (Boxed)', null), -- 112. was: Fully Boxed Item
  ('06d4df12-d25a-4232-b944-556405d626de', 'fashion', 'women', 'Chanel 2-in-1 Quilted Flap Bag Set', null), -- 113. was: 2 in 1 Channel
  ('5155a07a-8fe5-4d90-b44e-72346c3be2d3', 'fashion', 'women', 'Women''s 3-in-1 Handbag Set', null), -- 114. was: 3 in 1
  ('824e4032-b6dc-478b-87bf-d57b16b4c750', 'fashion', 'women', 'Women''s Platform Wedge Slides (37-41, Boxed)', null), -- 115. was: available now from
  ('14f43d08-baed-472b-aebc-bc11eac0ea36', 'fashion', 'women', 'Women''s Leaf-Strap Heeled Sandals (37-41)', null), -- 116. was: available now from
  ('49740c22-a327-4356-bc0f-09b0194a791e', 'fashion', 'women', 'Women''s Ankle-Strap Stiletto Sandals (37-41)', null), -- 117. was: 37 to 41 (19500)
  ('d0c0401c-ed27-410b-b832-b096b7ec23a6', 'fashion', 'women', 'Women''s Strappy Heeled Sandals (37-41)', null), -- 118. was: 37 to 41 (19500)
  ('45965059-d02d-4db7-8b13-c2529caba180', 'fashion', 'women', 'Women''s Block-Heel Ankle-Strap Sandals (37-41)', null), -- 119. was: 37 to 41 ()
  ('e4e57635-e9a1-4afc-8380-5468c4274cf1', 'fashion', 'women', 'Women''s Strappy Stiletto Sandals (37-41)', null), -- 120. was: 37 to 41 (19500)
  ('19224d4c-f3b7-4eb3-9165-b3324078c65b', 'fashion', 'women', 'Chanel Caged Flat Sandals (37-42)', null), -- 121. was: 37 to 42 ()
  ('99fd51f2-61a7-46db-ba49-8cd06239e758', 'fashion', 'women', 'Women''s Caged Kitten-Heel Sandals (37-41)', null), -- 122. was: 37 to 41 ()
  ('86580c6f-79c0-497d-bfdc-2b0f6ed74ea8', 'fashion', 'women', 'Women''s Two-Tone Pointed Slingback Flats (39-42)', null); -- 123. was: 39 to 42 (20500)

insert into public.other_category_review
  (product_id, old_name, old_category, old_audience, old_status, new_name, new_category, new_audience, new_status)
select p.id, p.name, p.category, p.audience, p.status, r.name, r.category, r.audience, coalesce(r.status, p.status)
from public.products p
join buysell_other_review r on r.id = p.id
where lower(btrim(coalesce(p.category, ''))) = 'other'
on conflict (product_id) do nothing;

-- Renaming is not a new listing: skip the per-row call to notify-new-product.
alter table public.products disable trigger on_product_published;

update public.products p
set name = r.name,
    category = r.category,
    audience = r.audience,
    status = coalesce(r.status, p.status)
from buysell_other_review r
where r.id = p.id
  and lower(btrim(coalesce(p.category, ''))) = 'other';

alter table public.products enable trigger on_product_published;

drop table buysell_other_review;
