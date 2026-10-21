@echo off
chcp 65001 >nul
title Cinevio (demo)
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

echo.
echo  Mode demo : titres fictifs, aucune cle ni connexion necessaire.
echo  Garde cette fenetre ouverte. Ferme-la pour arreter.
echo.
set DEMO=1
start "" /min cmd /c "timeout /t 2 >nul & start http://localhost:7000/configure"
node src\server.js
pause
