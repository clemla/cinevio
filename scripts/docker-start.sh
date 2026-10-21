#!/bin/sh
# Démarrage dans Docker : écran virtuel (pour le mode « fenêtre » de Chromium), puis le serveur.
# « exec » : le serveur reçoit directement l'arrêt du conteneur et sauvegarde son cache.
Xvfb :99 -screen 0 1280x800x24 -nolisten tcp >/dev/null 2>&1 &
export DISPLAY=:99
exec node src/server.js
