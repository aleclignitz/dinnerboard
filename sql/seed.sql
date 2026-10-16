-- Starter data for the board: a two-week plan (Sun 2026-10-11 to Sat 2026-10-24),
-- staples, and a few freezer items. Run once in the Supabase SQL Editor after
-- schema.sql. Safe to re-run: existing rows with the same path are overwritten.
-- Edit the guidelines text and dates to suit your household.

insert into documents (path, data) values

('plan/current', $j${
  "status": "active",
  "start": "2026-10-11",
  "end": "2026-10-24",
  "pickup": "",
  "statusNote": "",
  "guidelines": "Family-friendly weeknight dinners, about 40 minutes or less. Cook Mon/Wed/Fri, leftovers Tue/Thu/Sat, flexible Sunday. Mix chicken, beef, pork, fish and one vegetarian meal per two weeks. Limit spicy dishes."
}$j$),

-- WEEK 1
('meals/p20261011-01', $j${"date":"2026-10-11","kind":"flex","title":"Breakfast for dinner","details":"Scrambled eggs, bacon, toast and fruit.","from":"","thaw":"","thawDone":false,"rating":0}$j$),

('meals/p20261012-01', $j${"date":"2026-10-12","kind":"cook","title":"Sheet-pan chicken thighs with potatoes and broccoli","details":"Cook extra chicken for Tuesday.","from":"","thaw":"","thawDone":false,"rating":4,
 "recipe":{"serves":4,"time":45,"oven":"425F",
  "ingredients":["8 bone-in chicken thighs","1.5 lb baby potatoes, halved","2 heads broccoli, cut into florets","3 tbsp olive oil","1 tsp garlic powder","1 tsp paprika","Salt and pepper"],
  "steps":["Heat oven to 425F.","Toss potatoes with 1 tbsp oil, salt and pepper on a sheet pan; roast 10 minutes.","Rub chicken with remaining oil and spices; add to the pan skin side up.","Roast 25 minutes, add broccoli, roast 10 more until chicken reaches 165F.","Save 4 thighs and some potatoes for Tuesday."],
  "tip":"Pat the chicken dry for crisper skin."}}$j$),

('meals/p20261013-01', $j${"date":"2026-10-13","kind":"leftovers","title":"Leftover chicken and potatoes","details":"Reheat with a quick side salad.","from":"Monday sheet-pan chicken","thaw":"","thawDone":false,"rating":0}$j$),

('meals/p20261014-01', $j${"date":"2026-10-14","kind":"cook","title":"Beef and broccoli stir-fry over rice","details":"Cook extra rice for Thursday.","from":"","thaw":"Ground beef or flank steak from the freezer","thawDone":false,"rating":0,
 "recipe":{"serves":4,"time":30,"oven":"",
  "ingredients":["1.25 lb flank steak, thinly sliced","3 cups broccoli florets","3 cloves garlic, minced","1 tbsp grated ginger","1/3 cup low-sodium soy sauce","2 tbsp brown sugar","1 tbsp cornstarch","2 tbsp neutral oil","3 cups cooked rice"],
  "steps":["Whisk soy sauce, sugar, cornstarch and 1/2 cup water.","Sear beef in hot oil in batches, 2 minutes per side; set aside.","Stir-fry broccoli 3 minutes, add garlic and ginger for 30 seconds.","Return beef, add sauce, simmer until glossy, about 2 minutes.","Serve over rice."],
  "tip":"Freeze the steak 20 minutes first for easier slicing."}}$j$),

('meals/p20261015-01', $j${"date":"2026-10-15","kind":"leftovers","title":"Beef and broccoli fried rice","details":"Fry leftovers with an egg and frozen peas.","from":"Wednesday stir-fry","thaw":"","thawDone":false,"rating":0}$j$),

('meals/p20261016-01', $j${"date":"2026-10-16","kind":"cook","title":"Baked salmon with lemon-garlic orzo","details":"Friday fish night.","from":"","thaw":"Salmon fillets from the freezer, move to the fridge Thursday night","thawDone":false,"rating":0,
 "recipe":{"serves":4,"time":30,"oven":"400F",
  "ingredients":["4 salmon fillets","1.5 cups orzo","2 cups baby spinach","1 lemon","3 cloves garlic","2 tbsp butter","2 tbsp olive oil","Salt and pepper"],
  "steps":["Heat oven to 400F.","Season salmon, rub with oil, lemon zest and half the garlic.","Bake 12 to 15 minutes until the center reaches 145F.","Cook orzo per package, drain.","Saute remaining garlic in butter, toss with orzo, spinach and lemon juice."],
  "tip":"Pull the salmon when it just flakes."}}$j$),

('meals/p20261017-01', $j${"date":"2026-10-17","kind":"leftovers","title":"Salmon orzo bowls","details":"Flake leftover salmon over the orzo.","from":"Friday salmon","thaw":"","thawDone":false,"rating":0}$j$),

-- WEEK 2
('meals/p20261018-01', $j${"date":"2026-10-18","kind":"flex","title":"Homemade pizza night","details":"Store-bought dough, mozzarella and favorite toppings.","from":"","thaw":"","thawDone":false,"rating":0}$j$),

('meals/p20261019-01', $j${"date":"2026-10-19","kind":"cook","title":"Slow-cooker pulled pork sandwiches with slaw","details":"Start the cooker in the morning. Plenty left for Tuesday.","from":"","thaw":"Pork shoulder, move to the fridge Saturday night","thawDone":false,"rating":0,
 "recipe":{"serves":6,"time":480,"oven":"Slow cooker, low",
  "ingredients":["3 lb pork shoulder","1 cup BBQ sauce","1 tbsp brown sugar","1 tbsp chili powder","1 tsp salt","1 bag coleslaw mix","3 tbsp mayo","1 tbsp apple cider vinegar","6 buns"],
  "steps":["Rub pork with sugar, chili powder and salt; place in the slow cooker.","Pour half the BBQ sauce over; cook on low 8 hours until shreddable (195F or more).","Shred, stir in remaining sauce.","Mix slaw mix with mayo and vinegar.","Pile pork and slaw on buns."],
  "tip":"Skim excess fat before shredding."}}$j$),

('meals/p20261020-01', $j${"date":"2026-10-20","kind":"leftovers","title":"Pulled pork quesadillas","details":"Pork, cheese and tortillas, crisped in a skillet.","from":"Monday pulled pork","thaw":"","thawDone":false,"rating":0}$j$),

('meals/p20261021-01', $j${"date":"2026-10-21","kind":"cook","title":"Creamy tomato tortellini soup","details":"Vegetarian night. Serve with crusty bread.","from":"","thaw":"","thawDone":false,"rating":0,
 "recipe":{"serves":4,"time":30,"oven":"",
  "ingredients":["1 onion, diced","3 cloves garlic","1 can (28 oz) crushed tomatoes","3 cups vegetable broth","1 cup half-and-half","1 package (20 oz) refrigerated cheese tortellini","3 cups baby spinach","1 tsp Italian seasoning","2 tbsp olive oil","Parmesan, for serving"],
  "steps":["Saute onion in oil 5 minutes, add garlic and seasoning for 1 minute.","Add tomatoes and broth; simmer 10 minutes.","Stir in half-and-half and tortellini; cook 4 to 5 minutes.","Add spinach until wilted. Top with Parmesan."],
  "tip":"A small splash of balsamic brightens the soup."}}$j$),

('meals/p20261022-01', $j${"date":"2026-10-22","kind":"leftovers","title":"Soup and grilled cheese","details":"Reheat soup, add grilled cheese.","from":"Wednesday tortellini soup","thaw":"","thawDone":false,"rating":0}$j$),

('meals/p20261023-01', $j${"date":"2026-10-23","kind":"cook","title":"Chicken fajita bowls","details":"Cook extra chicken for Saturday.","from":"","thaw":"Chicken breasts from the freezer, move to the fridge Thursday night","thawDone":false,"rating":0,
 "recipe":{"serves":4,"time":35,"oven":"",
  "ingredients":["1.5 lb chicken breasts, sliced","2 bell peppers, sliced","1 onion, sliced","2 tbsp fajita seasoning","2 tbsp oil","2 cups cooked rice","1 can black beans, drained","Salsa, sour cream, shredded cheese, lime"],
  "steps":["Toss chicken with seasoning.","Cook chicken in oil over medium-high heat 6 to 7 minutes until 165F; set aside.","Cook peppers and onion 5 to 6 minutes until charred at the edges.","Warm beans.","Build bowls with rice, beans, chicken, vegetables and toppings."],
  "tip":"Keep a pan hot enough to char the vegetables, not steam them."}}$j$),

('meals/p20261024-01', $j${"date":"2026-10-24","kind":"leftovers","title":"Fajita burritos","details":"Wrap leftover fajita chicken and rice in tortillas.","from":"Friday fajita bowls","thaw":"","thawDone":false,"rating":0}$j$),

-- STAPLES
('staples/s01', $j${"name":"Olive oil","group":"Pantry","status":"have","order":1}$j$),
('staples/s02', $j${"name":"Vegetable or neutral oil","group":"Pantry","status":"have","order":2}$j$),
('staples/s03', $j${"name":"Rice","group":"Pantry","status":"have","order":3}$j$),
('staples/s04', $j${"name":"Pasta","group":"Pantry","status":"have","order":4}$j$),
('staples/s05', $j${"name":"Salt and pepper","group":"Spices","status":"have","order":5}$j$),
('staples/s06', $j${"name":"Garlic powder","group":"Spices","status":"have","order":6}$j$),
('staples/s07', $j${"name":"Paprika","group":"Spices","status":"have","order":7}$j$),
('staples/s08', $j${"name":"Chili powder","group":"Spices","status":"unknown","order":8}$j$),
('staples/s09', $j${"name":"Soy sauce","group":"Condiments","status":"have","order":9}$j$),
('staples/s10', $j${"name":"Brown sugar","group":"Pantry","status":"have","order":10}$j$),
('staples/s11', $j${"name":"Eggs","group":"Fridge","status":"have","order":11}$j$),
('staples/s12', $j${"name":"Butter","group":"Fridge","status":"have","order":12}$j$),
('staples/s13', $j${"name":"Milk","group":"Fridge","status":"low","order":13}$j$),
('staples/s14', $j${"name":"Shredded cheese","group":"Fridge","status":"unknown","order":14}$j$),

-- FREEZER
('freezer/f01', $j${"name":"Ground beef, 1 lb","at":"2026-09-20T00:00:00Z"}$j$),
('freezer/f02', $j${"name":"Salmon fillets, 4","at":"2026-09-28T00:00:00Z"}$j$),
('freezer/f03', $j${"name":"Chicken breasts, 2 lb","at":"2026-10-01T00:00:00Z"}$j$),
('freezer/f04', $j${"name":"Pork shoulder, 3 lb","at":"2026-10-05T00:00:00Z"}$j$)

on conflict (path) do update
  set data = excluded.data, updated_at = now();
