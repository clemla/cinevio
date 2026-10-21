@echo off
chcp 65001 >nul
title Cinevio
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js n'est pas installe.
  echo  Installe la version LTS depuis https://nodejs.org puis relance ce fichier.
  echo.
  start "" "https://nodejs.org/fr/download"
  pause
  exit /b 1
)

rem Cle TMDB : demandee ici si elle manque, puis enregistree toute seule dans .env
node scripts\setup.js

echo.
echo  Demarrage... la page de configuration va s'ouvrir dans ton navigateur.
echo  Garde cette fenetre ouverte tant que tu utilises l'addon. Ferme-la pour l'arreter.
echo.
start "" /min cmd /c "timeout /t 2 >nul & start http://localhost:7000/configure"
node src\server.js
pause
