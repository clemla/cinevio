@echo off
chcp 65001 >nul
title Cinevio - test FlixPatrol
cd /d "%~dp0"
echo.
echo  Test de lecture des top 10 FlixPatrol (hors Netflix) avec Chrome ou Edge.
echo  Compte environ 5 a 10 secondes par plateforme.
echo.
node scripts\test-flixpatrol.js %*
echo.
pause
