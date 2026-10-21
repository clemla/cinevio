#!/usr/bin/env sh
# Cinévio sur Linux et macOS (sous Windows : lancer.bat).
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js n'est pas installé : https://nodejs.org (version LTS), puis relance ce fichier."
  exit 1
fi
# Clé TMDB demandée ici si elle manque, puis enregistrée dans .env
node scripts/setup.js
echo ""
echo "  Démarrage : http://localhost:${PORT:-7000}/configure"
echo "  Ctrl+C pour arrêter."
echo ""
exec node src/server.js
