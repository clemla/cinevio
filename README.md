# Cinévio

Addon de métadonnées en français pour Nuvio (compatible Stremio), avec des collections prêtes à importer.

- **Fiches en français** : titres, résumés, affiches et logos en VF, classification française (-12, -16…), dates de sortie en France.
- **Plateformes** (collection épinglée) : un dossier par service, avec Top 10, Nouveautés, Populaires, Mieux notés et Bientôt, en films et en séries.
- **Chaînes** : TF1+, M6+, france.tv et Arte, avec Top 10 (sauf Arte), Nouveautés, Populaires, Mieux notés. france.tv n'a que des séries et émissions (TMDB n'a pas ses données de disponibilité : on passe par France 2, 3 et 5).
- **Genres** : 12 genres (Action, Comédie, Thriller, Policier, Science-fiction, Fantastique, Horreur, Drame, Romance, Animation, Documentaires, En famille), avec seulement ce qui est disponible sur les plateformes et chaînes cochées.
- **Sagas & univers** : 32 dossiers (Marvel, Star Wars, Harry Potter, La Terre du Milieu, James Bond, Astérix, Kaamelott, OSS 117…), films dans l'ordre de sortie, séries liées. Liste dans `src/sagas.js`.
- **Animés** : 11 dossiers d'animation japonaise : du moment (saison en cours), incontournables, films, genres (shōnen, isekai, mecha…), grands studios (MAPPA, ufotable, Kyoto Animation…) et où les regarder (Crunchyroll, ADN, et tes plateformes). Studios et mots-clés sont retrouvés sur TMDB par leur nom. Liste dans `src/anime.js`.
  Leurs GIF montrent des **scènes cultes** (Naruto, Goku, Totoro, Tanjiro…) : ils sont fournis avec l'addon (`public/covers/anime-*.gif`), sans clé à mettre. L'image fixe de chaque carte, elle, est une scène de TMDB mise à jour.
- **Cartes** : chaque dossier a sa carte, refaite chaque jour avec les affiches du moment (voir plus bas).
- **Top 10 du moment** : deux rangées sur l'accueil (films et séries) qui montrent ce qui est en tendance en France, sans les vieux titres.
- **Télé-réalité FR** : une rangée sur l'accueil avec les émissions françaises qui diffusent en ce moment.
- **Site de configuration** avec un aperçu de l'accueil avant installation.

Aucune dépendance npm : Node 20 ou plus suffit.

## Lancer

- **Windows** : double-clique sur `lancer.bat`. La première fois, il demande ta clé TMDB dans sa fenêtre et l'enregistre.
- **Linux, macOS** : `./lancer.sh` (même chose). Il faut [Node.js](https://nodejs.org) 20 ou plus.
- **Docker** : voir plus bas.

La page de configuration s'ouvre sur http://localhost:7000/configure.

Mode démo, sans clé ni réseau (titres fictifs) : `npm run demo`. Tests (API simulées) : `npm test`.

## Docker

Image toute prête, publiée par le dépôt (PC, serveurs et Raspberry Pi) :

```bash
docker run -d --name cinevio -p 7000:7000 --shm-size=512m \
  -e TMDB_API_KEY=ta_cle -v cinevio-data:/data \
  ghcr.io/TON-PSEUDO/cinevio:latest
```

Ou avec `docker compose up -d` (fichier `docker-compose.yml` du dépôt : mets ta clé dedans). L'image contient Chromium pour les cartes et les classements. Pour l'utiliser hors de chez toi, mets l'addon derrière un reverse proxy en https et indique son adresse dans `PUBLIC_URL`, ou active `CLOUDFLARE_TUNNEL=1`. Toutes les options de `.env.example` marchent en variables d'environnement.

## Installer dans Nuvio

1. Lance `lancer.bat` : la première fois, il te demande ta clé TMDB dans sa fenêtre (colle-la, Entrée) et l'enregistre. Pour la changer plus tard : `changer-cle-tmdb.bat`.
2. Sur la page qui s'ouvre (`/configure`), choisis plateformes et rangées.
3. Copie le lien de l'addon et colle-le dans Nuvio : Paramètres → Contenu et découverte → Addons.
4. Télécharge le fichier des collections et importe-le sur nuvio.tv : Compte → Collections → Importer.

Installe l'addon avant d'importer les collections : chaque dossier pointe vers ses catalogues.

## Recherche et fiches

- **Recherche** : l'addon répond aux recherches de Nuvio (films et séries), avec titres et affiches en français. Ce catalogue n'apparaît que dans la recherche, jamais sur l'accueil.
- **Bandeau d'accueil** : pour chaque titre, le plus beau fond TMDB (sans texte, en 16:9, grande taille, le mieux noté) et le logo du titre (français, sinon anglais).
- **Fiches** : acteurs avec photo et rôle, réalisation ou création, scénario, âge conseillé (champ `app_extras` lu par Nuvio TV, PC et mobile). La liste de noms `cast` reste là pour les autres applis.

## Lien Cloudflare (téléphone, télé, hors de chez toi)

Par défaut, l'addon n'est joignable que depuis ce PC (`localhost`). Pour l'utiliser ailleurs :

1. Lance **`lancer-cloudflare.bat`** au lieu de `lancer.bat`. La première fois, `cloudflared` (l'outil officiel de Cloudflare) est téléchargé dans `bin/`.
2. Le lien `https://….trycloudflare.com` s'affiche dans la fenêtre. Sur la page de configuration, l'étape 3 propose « Partout » : les liens d'installation et les collections utilisent alors ce lien.

Ce lien rapide est gratuit et sans compte, mais **il change à chaque lancement** : il faut alors réinstaller l'addon et réimporter les collections. Pour un lien fixe, crée un tunnel dans ton compte Cloudflare (Zero Trust → Réseaux → Tunnels, vers `http://localhost:7000`) et mets `CLOUDFLARE_TUNNEL_TOKEN` et `PUBLIC_URL` dans `.env`.

Le lien est public : toute personne qui l'a peut utiliser l'addon, avec la clé TMDB du `.env`. Ne le partage qu'avec qui tu veux.

## Comment sont faits les Top 10

| Rangée | Source | Repli |
| --- | --- | --- |
| Top 10 Netflix | Top 10 officiel de Netflix pour la France (hebdomadaire) | FlixPatrol, puis TMDB |
| Top 10 des autres plateformes | FlixPatrol (classement du jour en France) | Ce qui sort en ce moment sur la plateforme (TMDB) |
| Bientôt sur… | FlixPatrol (page « coming ») | Rangée vide |
| Box-office | Allociné (chiffres CBO) | « En salles en France » sur TMDB |

### Top 10 du moment

Il cherche ce qui monte, pas ce qui est installé depuis des mois :

```
score = présence × fraîcheur × élan × buzz
```

- **présence** : places obtenues dans les top 10 français (Netflix, Prime, Disney+, Canal+, HBO Max, Apple TV, Paramount+, plus le box-office pour les films), pondérées par plateforme (`weight` dans `src/platforms.js`).
- **fraîcheur** : un film sorti il y a plus d'un an, ou une série sans épisode depuis 5 mois, est écarté. En dessous, le score baisse avec l'âge (`TREND_MAX_AGE_MOVIE_DAYS`, `TREND_MAX_AGE_TV_DAYS`).
- **élan** : bonus pour un titre entré dans un top 10 depuis moins d'une semaine, malus s'il y est depuis plus de deux mois.
- **buzz** : bonus si le titre figure aussi dans les tendances TMDB du jour.

`/api/top10?type=movie` (ou `series`) affiche le classement avec le score, l'âge et l'ancienneté de chaque titre, pour régler les poids.

### Télé-réalité FR

D'abord les émissions de télé-réalité françaises présentes dans les classements du moment (Netflix, Prime, Disney+, Canal+, HBO Max, TF1+, M6+, france.tv), puis les émissions TMDB du genre « Réalité » d'origine française qui ont diffusé un épisode dans les 90 derniers jours.

## Cartes des collections

Les cartes (1280×720) sont dessinées en HTML/CSS par Chrome ou Edge, puis enregistrées en JPG (`src/covers.js`) :

- Plateformes et chaînes : les affiches du Top du moment en éventail, éclairées par la couleur de la marque.
- Genres : un mur d'affiches incliné, en bichromie dans la couleur du genre.
- Sagas : l'image de la saga en plein cadre, avec le nombre de films et de séries.

**Cartes de base** : le zip contient de vraies cartes (affiches, logos, ambiances), affichées dès l'installation pendant que le serveur fabrique les siennes avec les affiches du moment. Le site montre la création en cours (bandeau et cartes marquées « En création… »). Pour mettre à jour ces cartes de base avant de partager un nouveau zip : `node scripts/render-covers.js`.

Chaque carte a aussi son **GIF animé** (480×270, boucle de 3 s), que Nuvio joue quand la carte a le focus (`focusGifUrl` du fichier de collections) : l'éventail s'ouvre et un reflet passe sur l'affiche de devant, le mur d'affiches glisse, un faisceau de lumière traverse l'image des sagas. Le titre ne bouge pas. Les GIF sont encodés par l'addon lui-même (`src/gif.js`, sans dépendance) : 0,3 à 1,2 Mo chacun. Tant qu'un GIF n'est pas prêt, l'addon sert la carte fixe à sa place. `COVERS_GIF=0` coupe les GIF.

Elles sont refaites en arrière-plan quand leurs images changent (au plus une fois par jour et par carte) et rangées dans `data/covers/`. Sans clé TMDB ou hors ligne, l'addon sert les cartes de secours de `public/covers/` (même style, sans images).

- `node scripts/render-covers.js maintenant` : refait toutes les cartes du moment tout de suite.
- `node scripts/render-covers.js` : refait les cartes de secours.
- `COVERS_DYNAMIC=0` dans `.env` : n'utiliser que les cartes de secours.

Plateformes et chaînes : leur **logo officiel**, fourni par TMDB (réseaux, `logo` dans `src/platforms.js`), à la place du nom écrit ; les logos noirs ou sombres sont affichés en blanc (`white: true`). Si le logo ne charge pas, le nom revient. Les cartes de secours (sans réseau) gardent le nom écrit.

Police : Inter Display (licence OFL, `public/assets/fonts/`).

Nuvio garde les images en cache : une carte mise à jour peut mettre quelques heures à apparaître.

## Diagnostic

- `/api/diag` : état de chaque source (TMDB, Netflix officiel, FlixPatrol par plateforme, box-office). Les pages FlixPatrol en échec sont enregistrées dans `data/debug/`.
- `/api/top10?service=netflix&type=series` : classement brut d'une plateforme et le titre TMDB retrouvé pour chaque ligne.

### À propos de FlixPatrol

FlixPatrol vend ces données via une API payante. L'addon lit leurs pages publiques avec modération (une fois toutes les 12 h par plateforme, une page toutes les 4 s au plus, mis en cache sur disque) et bascule automatiquement sur TMDB si la lecture échoue. Le module `src/sources/flixpatrol.js` est isolé pour pouvoir passer à leur API sans toucher au reste.

FlixPatrol est derrière une vérification Cloudflare que Node seul ne passe pas. L'addon ouvre donc les pages avec **Chrome ou Edge déjà installé sur l'ordinateur** (invisible, profil séparé dans `data/browser-profile`), piloté par `src/sources/browser.js`, sans dépendance npm. Si le mode invisible ne passe pas la vérification, il réessaie avec une fenêtre placée hors de l'écran.

Pour vérifier : double-clique sur `tester-flixpatrol.bat` (ou `node scripts/test-flixpatrol.js`). Il lit chaque plateforme sauf Netflix et affiche les 3 premiers titres. `tester-flixpatrol.bat visible` montre la fenêtre du navigateur.

Réglages dans `.env` : `FLIXPATROL_FETCH` (`auto`, `browser`, `direct`), `BROWSER_PATH` (si le navigateur n'est pas trouvé), `BROWSER_HEADLESS` (`auto`, `1`, `0`).

**Pas d'attente, pas de trou :**
- Tout est relu en arrière-plan au démarrage puis toutes les heures (top 10, puis pages « Bientôt »). Ce qui est encore frais n'est pas relu.
- Un classement périmé est servi tout de suite pendant que le nouveau se charge en fond.
- Si FlixPatrol est en panne, le dernier vrai classement reste affiché jusqu'à 3 jours (`FLIXPATROL_KEEP_LAST_HOURS`) avant de passer au repli TMDB.
- Si rien n'est encore en cache, une rangée attend au plus 8 s (`FLIXPATROL_WAIT_SECONDS`), puis la lecture continue en fond.

### Corriger un titre mal reconnu

`/api/top10?service=prime&type=series` montre, pour chaque titre FlixPatrol, son identifiant et la fiche TMDB retenue. Pour corriger, crée `data/corrections.json` :

```json
{
  "the-final-destination": "movie:19912",
  "paris-has-fallen": "tv:123456",
  "marrakech-comedy-festival": null
}
```

La clé est l'identifiant FlixPatrol (ou le titre), la valeur `movie:ID` ou `tv:ID` (l'ID est dans l'adresse de la fiche sur themoviedb.org), ou `null` pour ignorer le titre. Pris en compte sans redémarrer.

## Structure

```
src/
  server.js        routes HTTP (manifest, catalogues, fiches, collections, site)
  config.js        config utilisateur encodée dans l'URL
  platforms.js     plateformes et leurs poids
  catalogs.js      manifest et catalogues
  meta.js          fiches en français
  top10.js         top 10 par plateforme, cinéma, classement tendance
  collection.js    fichier de collections Nuvio
  demo.js          données fictives du mode démo
  sources/         tmdb, flixpatrol, boxoffice, extras (fanart, mdblist)
public/            site de configuration et couvertures
public/assets/cinevio*.png  logo Cinévio (site) ; public/covers/logo.png et background.jpg : logo et fond de l'addon
```

## À vérifier sur un vrai appareil

- Le rendu exact des dossiers dans Nuvio (nom des onglets, ordre des rangées).
- Sur l'accueil, seuls le Top 10 du moment et la Télé-réalité apparaissent. Les autres catalogues en sont écartés pour toutes les applis Nuvio (règles vérifiées dans leur code) : `showInHome: false` pour Nuvio TV, et un genre obligatoire « Tout » pour Nuvio PC et mobile. Les collections passent ce genre, que le serveur ignore. Nuvio TV ne relit le manifest que toutes les 6 h : après une mise à jour, supprimer puis réinstaller l'addon.
- Les sélecteurs HTML de FlixPatrol et Allociné, qui peuvent changer sans prévenir.
- Le nombre « jours dans le top » lu sur FlixPatrol (utilisé pour l'élan) : sans lui, l'élan reste neutre.

## Contribuer

Les pull requests sont les bienvenues : voir [CONTRIBUTING.md](CONTRIBUTING.md). Les tests tournent tout seuls sur chaque pull request, et l'image Docker est republiée à chaque modification de `main`.

Licence MIT.
