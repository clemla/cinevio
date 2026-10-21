@echo off
chcp 65001 >nul
title Cinevio - cle TMDB
cd /d "%~dp0"
rem Remplace la cle TMDB enregistree dans .env
node scripts\setup.js changer
echo.
echo  C'est fait. Relance lancer.bat si le serveur tourne deja.
pause
