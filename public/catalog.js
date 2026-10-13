// Rayons et reconnaissance automatique des articles (emoji + rayon).

export const CATEGORIES = [
  { id: 'fruits', label: 'Fruits & légumes', emoji: '🥦' },
  { id: 'boulangerie', label: 'Boulangerie', emoji: '🥖' },
  { id: 'cremerie', label: 'Crèmerie & œufs', emoji: '🧀' },
  { id: 'viande', label: 'Viandes & poissons', emoji: '🥩' },
  { id: 'epicerie', label: 'Épicerie', emoji: '🥫' },
  { id: 'petitdej', label: 'Petit-déjeuner & sucré', emoji: '🍯' },
  { id: 'surgeles', label: 'Surgelés', emoji: '🧊' },
  { id: 'boissons', label: 'Boissons', emoji: '🧃' },
  { id: 'hygiene', label: 'Hygiène & beauté', emoji: '🧴' },
  { id: 'maison', label: 'Maison & entretien', emoji: '🧽' },
  { id: 'autre', label: 'Autre', emoji: '🛒' },
];

export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

// [mot-clé normalisé, rayon, emoji]. Le mot-clé le plus long qui correspond gagne.
const WORDS = [
  ['pomme de terre', 'fruits', '🥔'], ['patate', 'fruits', '🥔'], ['pomme', 'fruits', '🍎'], ['poire', 'fruits', '🍐'],
  ['banane', 'fruits', '🍌'], ['orange', 'fruits', '🍊'], ['clementine', 'fruits', '🍊'], ['citron', 'fruits', '🍋'],
  ['raisin', 'fruits', '🍇'], ['fraise', 'fruits', '🍓'], ['framboise', 'fruits', '🫐'], ['myrtille', 'fruits', '🫐'],
  ['peche', 'fruits', '🍑'], ['abricot', 'fruits', '🍑'], ['cerise', 'fruits', '🍒'], ['melon', 'fruits', '🍈'],
  ['pasteque', 'fruits', '🍉'], ['ananas', 'fruits', '🍍'], ['mangue', 'fruits', '🥭'], ['kiwi', 'fruits', '🥝'],
  ['avocat', 'fruits', '🥑'], ['tomate', 'fruits', '🍅'], ['carotte', 'fruits', '🥕'], ['salade', 'fruits', '🥬'],
  ['laitue', 'fruits', '🥬'], ['epinard', 'fruits', '🥬'], ['chou', 'fruits', '🥬'], ['brocoli', 'fruits', '🥦'],
  ['courgette', 'fruits', '🥒'], ['concombre', 'fruits', '🥒'], ['aubergine', 'fruits', '🍆'], ['poivron', 'fruits', '🫑'],
  ['oignon', 'fruits', '🧅'], ['echalote', 'fruits', '🧅'], ['ail', 'fruits', '🧄'], ['champignon', 'fruits', '🍄'],
  ['poireau', 'fruits', '🥬'], ['haricot vert', 'fruits', '🫛'], ['petits pois', 'fruits', '🫛'], ['mais', 'fruits', '🌽'],
  ['persil', 'fruits', '🌿'], ['basilic', 'fruits', '🌿'], ['coriandre', 'fruits', '🌿'], ['herbes', 'fruits', '🌿'],
  ['gingembre', 'fruits', '🫚'], ['radis', 'fruits', '🥕'], ['betterave', 'fruits', '🥕'], ['courge', 'fruits', '🎃'],

  ['baguette', 'boulangerie', '🥖'], ['pain', 'boulangerie', '🍞'], ['croissant', 'boulangerie', '🥐'],
  ['brioche', 'boulangerie', '🍞'], ['pain de mie', 'boulangerie', '🍞'], ['biscotte', 'boulangerie', '🍞'],

  ['lait', 'cremerie', '🥛'], ['beurre', 'cremerie', '🧈'], ['oeuf', 'cremerie', '🥚'], ['yaourt', 'cremerie', '🥛'],
  ['yogourt', 'cremerie', '🥛'], ['creme', 'cremerie', '🥛'], ['fromage', 'cremerie', '🧀'], ['emmental', 'cremerie', '🧀'],
  ['comte', 'cremerie', '🧀'], ['gruyere', 'cremerie', '🧀'], ['parmesan', 'cremerie', '🧀'], ['mozzarella', 'cremerie', '🧀'],
  ['camembert', 'cremerie', '🧀'], ['chevre', 'cremerie', '🧀'], ['feta', 'cremerie', '🧀'], ['fromage blanc', 'cremerie', '🥛'],
  ['skyr', 'cremerie', '🥛'], ['compote', 'cremerie', '🍎'],

  ['poulet', 'viande', '🍗'], ['dinde', 'viande', '🍗'], ['boeuf', 'viande', '🥩'], ['steak', 'viande', '🥩'],
  ['viande', 'viande', '🥩'], ['porc', 'viande', '🥩'], ['agneau', 'viande', '🥩'], ['veau', 'viande', '🥩'],
  ['jambon', 'viande', '🥓'], ['lardon', 'viande', '🥓'], ['bacon', 'viande', '🥓'], ['saucisse', 'viande', '🌭'],
  ['saucisson', 'viande', '🥓'], ['merguez', 'viande', '🌭'], ['poisson', 'viande', '🐟'], ['saumon', 'viande', '🐟'],
  ['cabillaud', 'viande', '🐟'], ['thon', 'viande', '🐟'], ['crevette', 'viande', '🦐'], ['moule', 'viande', '🦪'],

  ['pates', 'epicerie', '🍝'], ['spaghetti', 'epicerie', '🍝'], ['riz', 'epicerie', '🍚'], ['farine', 'epicerie', '🌾'],
  ['sucre', 'epicerie', '🧂'], ['sel', 'epicerie', '🧂'], ['poivre', 'epicerie', '🧂'], ['huile', 'epicerie', '🫒'],
  ['olive', 'epicerie', '🫒'], ['vinaigre', 'epicerie', '🫙'], ['moutarde', 'epicerie', '🫙'], ['mayonnaise', 'epicerie', '🫙'],
  ['ketchup', 'epicerie', '🥫'], ['sauce', 'epicerie', '🥫'], ['conserve', 'epicerie', '🥫'], ['lentille', 'epicerie', '🫘'],
  ['pois chiche', 'epicerie', '🫘'], ['semoule', 'epicerie', '🌾'], ['quinoa', 'epicerie', '🌾'], ['bouillon', 'epicerie', '🥫'],
  ['epice', 'epicerie', '🧂'], ['chips', 'epicerie', '🥔'], ['aperitif', 'epicerie', '🥜'], ['cacahuete', 'epicerie', '🥜'],
  ['amande', 'epicerie', '🥜'], ['noix', 'epicerie', '🥜'], ['soupe', 'epicerie', '🥣'],

  ['cafe', 'petitdej', '☕'], ['the', 'petitdej', '🍵'], ['infusion', 'petitdej', '🍵'], ['chocolat', 'petitdej', '🍫'],
  ['confiture', 'petitdej', '🍯'], ['miel', 'petitdej', '🍯'], ['cereale', 'petitdej', '🥣'], ['muesli', 'petitdej', '🥣'],
  ['biscuit', 'petitdej', '🍪'], ['gateau', 'petitdej', '🍰'], ['nutella', 'petitdej', '🍫'], ['bonbon', 'petitdej', '🍬'],

  ['surgele', 'surgeles', '🧊'], ['glace', 'surgeles', '🍨'], ['pizza', 'surgeles', '🍕'], ['frites', 'surgeles', '🍟'],
  ['glacons', 'surgeles', '🧊'],

  ['eau', 'boissons', '💧'], ['jus', 'boissons', '🧃'], ['soda', 'boissons', '🥤'], ['coca', 'boissons', '🥤'],
  ['biere', 'boissons', '🍺'], ['vin', 'boissons', '🍷'], ['champagne', 'boissons', '🍾'], ['sirop', 'boissons', '🧃'],

  ['dentifrice', 'hygiene', '🪥'], ['brosse a dent', 'hygiene', '🪥'], ['shampoing', 'hygiene', '🧴'],
  ['shampooing', 'hygiene', '🧴'], ['gel douche', 'hygiene', '🧴'], ['savon', 'hygiene', '🧼'], ['deodorant', 'hygiene', '🧴'],
  ['coton', 'hygiene', '☁️'], ['mouchoir', 'hygiene', '🤧'], ['rasoir', 'hygiene', '🪒'], ['creme solaire', 'hygiene', '🧴'],
  ['papier toilette', 'hygiene', '🧻'], ['pq', 'hygiene', '🧻'], ['doliprane', 'hygiene', '💊'], ['medicament', 'hygiene', '💊'],

  ['lessive', 'maison', '🧺'], ['adoucissant', 'maison', '🧺'], ['liquide vaisselle', 'maison', '🧽'],
  ['pastille lave', 'maison', '🧽'], ['eponge', 'maison', '🧽'], ['sopalin', 'maison', '🧻'], ['essuie tout', 'maison', '🧻'],
  ['sac poubelle', 'maison', '🗑️'], ['javel', 'maison', '🧴'], ['nettoyant', 'maison', '🧴'], ['ampoule', 'maison', '💡'],
  ['pile', 'maison', '🔋'], ['aluminium', 'maison', '📦'], ['film', 'maison', '📦'], ['allumette', 'maison', '🔥'],
  ['croquette', 'maison', '🐾'], ['litiere', 'maison', '🐾'],
];
WORDS.sort((a, b) => b[0].length - a[0].length);

export function normalize(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/œ/g, 'oe').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Renvoie { category, emoji } pour un nom d'article.
export function guess(name) {
  const n = ` ${normalize(name).replace(/[^a-z0-9 ]/g, ' ')} `;
  for (const [word, category, emoji] of WORDS) {
    // début de mot, pluriel toléré (pomme, pommes)
    const re = new RegExp(` ${word.replace(/ /g, ' ')}(s|x)?(?= )`);
    if (re.test(n)) return { category, emoji };
  }
  return { category: 'autre', emoji: null };
}

export function emojiFor(item) {
  return guess(item.name).emoji || CATEGORY_BY_ID[item.category]?.emoji || '🛒';
}
