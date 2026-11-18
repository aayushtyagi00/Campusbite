-- Optional staging catalog. Paid checkout stays disabled until a storefront is linked.
insert into public.commerce_menu (id, stall_slug, name, category, description, price, prep, diet, photo, sold_out) values
  ('paneer', 'rolling-kitchen', 'Paneer Tikka Wrap', 'Wraps', 'Grilled paneer, crunchy onions and mint chutney in a soft wrap. Contains milk and wheat.', 11000, 7, 'Vegetarian', 'paneer', false),
  ('aloo', 'rolling-kitchen', 'Aloo Tikki Wrap', 'Wraps', 'Crisp spiced potato, crunchy vegetables and tangy chutney. Contains wheat.', 8000, 6, 'Vegetarian', 'aloo', false),
  ('bowl', 'rolling-kitchen', 'Mexican Rice Bowl', 'Meals', 'Seasoned rice, beans, grilled vegetables and bright tomato salsa.', 13900, 8, 'Vegetarian', '', false),
  ('fries', 'rolling-kitchen', 'Masala Crispy Fries', 'Snacks', 'Crisp fries tossed in the stall’s masala seasoning.', 6500, 5, 'Vegetarian', 'fries', true),
  ('kulhad', 'rolling-kitchen', 'Kulhad Masala Chai', 'Drinks', 'Slow-brewed spiced milk tea served in a clay cup. Contains milk.', 4000, 4, 'Vegetarian', 'kulhad', false),
  ('adrak', 'chai-co', 'Adrak Elaichi Chai', 'Drinks', 'Milk tea with fresh ginger and cardamom. Contains milk.', 3500, 4, 'Vegetarian', 'kulhad', false),
  ('samosa', 'chai-co', 'Samosa Pav', 'Snacks', 'Potato samosa in a soft pav with green chutney. Contains wheat.', 5500, 5, 'Vegetarian', '', false),
  ('bun', 'chai-co', 'Bun Maska & Chai', 'Snacks', 'Buttered bun and a cup of house chai. Contains wheat and milk.', 7500, 5, 'Vegetarian', 'chai', false),
  ('dal', 'punjab-plate', 'Dal Makhani Combo', 'Meals', 'Slow-cooked black lentils, rice, pickle and curd. Contains milk.', 13900, 9, 'Vegetarian', 'punjab', false),
  ('kulcha', 'punjab-plate', 'Amritsari Kulcha', 'Meals', 'Stuffed kulcha, chole and pickled onions. Contains wheat and milk.', 11900, 9, 'Vegetarian', '', false)
on conflict (id) do nothing;
