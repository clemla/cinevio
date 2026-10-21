# Contribuer à Cinévio

Merci ! Quelques repères pour proposer une modification.

- **Aucune dépendance npm** : seulement Node 20 ou plus. Merci de garder ça.
- **Tests** : `npm test` doit passer (les API sont simulées, pas besoin de clé ni d'internet). Ils tournent aussi tout seuls sur chaque pull request.
- **Mode démo** pour travailler sur le site sans clé : `npm run demo`, puis http://localhost:7000/configure.
- **Jamais de clé dans le code** : elles vont dans `.env` (ignoré par git) ou dans les variables d'environnement.
- Les textes visibles (site, catalogues, cartes) sont en français.
- Une pull request = un sujet. Explique ce que ça change pour l'utilisateur, et ajoute un test si tu touches aux catalogues, aux classements ou aux cartes.

Où regarder : `src/catalogs.js` (catalogues), `src/top10.js` (classements), `src/covers.js` et `src/cover-fx.js` (cartes), `src/sagas.js`, `src/genres.js`, `src/anime.js` (listes), `public/` (site de configuration).
