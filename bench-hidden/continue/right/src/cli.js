import { loadRecipes, saveRecipes } from './store.js';

const [cmd, name, ...ingredients] = process.argv.slice(2);

if (cmd === 'add' && name) {
  const recipes = loadRecipes();
  recipes.push({ name, ingredients });
  saveRecipes(recipes);
  console.log(`added ${name}`);
} else if (cmd === 'list') {
  for (const r of loadRecipes()) console.log(`${r.name} (${r.ingredients.length} ingredients)`);
} else if (cmd === 'search' && name) {
  const want = name.toLowerCase();
  for (const r of loadRecipes()) {
    if (r.ingredients.some((i) => i.toLowerCase() === want)) console.log(r.name);
  }
} else {
  console.log('usage: add <name> <ingredient...> | list | search <ingredient>');
}
