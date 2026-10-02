import { loadRecipes, saveRecipes } from './store.js';

const [cmd, name, ...ingredients] = process.argv.slice(2);

if (cmd === 'add' && name) {
  const recipes = loadRecipes();
  recipes.push({ name, ingredients });
  saveRecipes(recipes);
  console.log(`added ${name}`);
} else if (cmd === 'list') {
  for (const r of loadRecipes()) console.log(`${r.name} (${r.ingredients.length} ingredients)`);
} else {
  console.log('usage: add <name> <ingredient...> | list');
}
