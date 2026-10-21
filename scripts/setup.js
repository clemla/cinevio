'use strict';

/**
 * Lancé par lancer.bat avant le serveur : crée .env au premier lancement et, si la clé TMDB
 * manque, la demande dans la fenêtre, la vérifie auprès de TMDB puis l'enregistre dans .env.
 * Plus besoin d'ouvrir .env à la main.
 *
 *   node scripts/setup.js           → demande la clé seulement si elle manque
 *   node scripts/setup.js changer   → demande une nouvelle clé (remplace l'ancienne)
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const ENV = path.join(ROOT, '.env');
const EXAMPLE = path.join(ROOT, '.env.example');

function currentKey(raw) {
  const m = /^[ \t]*TMDB_API_KEY[ \t]*=[ \t]*(.*?)[ \t]*$/m.exec(raw);
  return m ? m[1].replace(/^(['"])(.*)\1$/, '$2') : '';
}

function saveKey(raw, key) {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  if (/^[ \t]*#?[ \t]*TMDB_API_KEY[ \t]*=.*$/m.test(raw)) {
    return raw.replace(/^[ \t]*#?[ \t]*TMDB_API_KEY[ \t]*=.*$/m, `TMDB_API_KEY=${key}`);
  }
  return `${raw.replace(/\s*$/, '')}${eol}TMDB_API_KEY=${key}${eol}`;
}

/** true : la clé marche ; false : TMDB la refuse ; null : impossible de vérifier (pas d'internet). */
async function check(key) {
  const v4 = key.length > 40; // jeton de lecture (v4) ou clé d'API (v3)
  const url = `https://api.themoviedb.org/3/configuration${v4 ? '' : `?api_key=${encodeURIComponent(key)}`}`;
  try {
    const res = await fetch(url, { headers: v4 ? { Authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(10000) });
    if (res.status === 401 || res.status === 403) return false;
    return res.ok ? true : null;
  } catch {
    return null;
  }
}

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
}

(async () => {
  if (!fs.existsSync(ENV)) fs.copyFileSync(EXAMPLE, ENV);
  let raw = fs.readFileSync(ENV, 'utf8');
  const force = process.argv.includes('changer');
  if (currentKey(raw) && !force) return;

  console.log('');
  console.log('  Il faut une clé TMDB (gratuite) pour les titres, affiches et résumés en français.');
  console.log('  1. Ouvre https://www.themoviedb.org/settings/api (crée un compte si besoin)');
  console.log('  2. Copie la « Clé d\'API » et colle-la ici (clic droit pour coller), puis Entrée.');
  console.log('  Laisse vide et fais Entrée pour la mettre plus tard sur la page de configuration.');
  console.log('');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  for (let attempt = 1; attempt <= 3; attempt++) {
    const key = (await ask(rl, '  Clé TMDB : ')).replace(/\s+/g, '');
    if (!key) {
      console.log('  Pas de clé pour l\'instant : tu pourras la mettre sur la page de configuration.');
      break;
    }
    if (!/^[A-Za-z0-9._-]{16,400}$/.test(key)) {
      console.log('  Ça ne ressemble pas à une clé TMDB (32 caractères, lettres et chiffres). Réessaie.');
      continue;
    }
    const ok = await check(key);
    if (ok === false) {
      console.log('  TMDB refuse cette clé. Vérifie que tu as copié la « Clé d\'API » en entier.');
      continue;
    }
    raw = saveKey(fs.readFileSync(ENV, 'utf8'), key);
    fs.writeFileSync(ENV, raw);
    console.log(ok ? '  Clé valide, enregistrée.' : '  Clé enregistrée (pas pu la vérifier : pas de connexion à TMDB pour l\'instant).');
    break;
  }
  rl.close();
})().catch((err) => {
  console.error('  Préparation impossible :', err.message);
}).finally(() => process.exit(0));
