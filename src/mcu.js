'use strict';

/**
 * Le MCU (Marvel Studios) dans l'ordre de l'histoire, films et séries mélangés
 * (ordre « chronologique » de Marvel / Disney+). Titres originaux et année de sortie :
 * chaque entrée est retrouvée sur TMDB au premier passage, puis gardée en cache.
 * k : 'movie' | 'tv'. Pour ajouter un titre : l'insérer à sa place dans la liste.
 * Les nouveautés Marvel Studios sorties après la dernière entrée sont ajoutées à la fin
 * automatiquement (voir sagas.js).
 */
const MCU_TIMELINE = [
  { t: 'Captain America: The First Avenger', y: 2011, k: 'movie' },
  { t: 'Captain Marvel', y: 2019, k: 'movie' },
  { t: 'Iron Man', y: 2008, k: 'movie' },
  { t: 'Iron Man 2', y: 2010, k: 'movie' },
  { t: 'The Incredible Hulk', y: 2008, k: 'movie' },
  { t: 'Thor', y: 2011, k: 'movie' },
  { t: 'The Avengers', y: 2012, k: 'movie' },
  { t: 'Thor: The Dark World', y: 2013, k: 'movie' },
  { t: 'Iron Man 3', y: 2013, k: 'movie' },
  { t: 'Captain America: The Winter Soldier', y: 2014, k: 'movie' },
  { t: 'Guardians of the Galaxy', y: 2014, k: 'movie' },
  { t: 'Guardians of the Galaxy Vol. 2', y: 2017, k: 'movie' },
  { t: 'Avengers: Age of Ultron', y: 2015, k: 'movie' },
  { t: 'Ant-Man', y: 2015, k: 'movie' },
  { t: 'Captain America: Civil War', y: 2016, k: 'movie' },
  { t: 'Black Widow', y: 2021, k: 'movie' },
  { t: 'Black Panther', y: 2018, k: 'movie' },
  { t: 'Spider-Man: Homecoming', y: 2017, k: 'movie' },
  { t: 'Doctor Strange', y: 2016, k: 'movie' },
  { t: 'Thor: Ragnarok', y: 2017, k: 'movie' },
  { t: 'Ant-Man and the Wasp', y: 2018, k: 'movie' },
  { t: 'Avengers: Infinity War', y: 2018, k: 'movie' },
  { t: 'Avengers: Endgame', y: 2019, k: 'movie' },
  { t: 'Loki', y: 2021, k: 'tv' },
  { t: 'What If...?', y: 2021, k: 'tv' },
  { t: 'WandaVision', y: 2021, k: 'tv' },
  { t: 'The Falcon and the Winter Soldier', y: 2021, k: 'tv' },
  { t: 'Shang-Chi and the Legend of the Ten Rings', y: 2021, k: 'movie' },
  { t: 'Eternals', y: 2021, k: 'movie' },
  { t: 'Spider-Man: Far From Home', y: 2019, k: 'movie' },
  { t: 'Spider-Man: No Way Home', y: 2021, k: 'movie' },
  { t: 'Doctor Strange in the Multiverse of Madness', y: 2022, k: 'movie' },
  { t: 'Hawkeye', y: 2021, k: 'tv' },
  { t: 'Moon Knight', y: 2022, k: 'tv' },
  { t: 'Black Panther: Wakanda Forever', y: 2022, k: 'movie' },
  { t: 'Echo', y: 2024, k: 'tv' },
  { t: 'She-Hulk: Attorney at Law', y: 2022, k: 'tv' },
  { t: 'Ms. Marvel', y: 2022, k: 'tv' },
  { t: 'Thor: Love and Thunder', y: 2022, k: 'movie' },
  { t: 'Werewolf by Night', y: 2022, k: 'movie' },
  { t: 'The Guardians of the Galaxy Holiday Special', y: 2022, k: 'movie' },
  { t: 'Ant-Man and the Wasp: Quantumania', y: 2023, k: 'movie' },
  { t: 'Guardians of the Galaxy Vol. 3', y: 2023, k: 'movie' },
  { t: 'Secret Invasion', y: 2023, k: 'tv' },
  { t: 'The Marvels', y: 2023, k: 'movie' },
  { t: 'Deadpool & Wolverine', y: 2024, k: 'movie' },
  { t: 'Agatha All Along', y: 2024, k: 'tv' },
  { t: 'Daredevil: Born Again', y: 2025, k: 'tv' },
  { t: 'Captain America: Brave New World', y: 2025, k: 'movie' },
  { t: 'Thunderbolts*', y: 2025, k: 'movie' },
  { t: 'Ironheart', y: 2025, k: 'tv' },
  { t: 'The Fantastic 4: First Steps', y: 2025, k: 'movie' },
  { t: 'Wonder Man', y: 2026, k: 'tv' },
  { t: 'Spider-Man: Brand New Day', y: 2026, k: 'movie' },
];

module.exports = { MCU_TIMELINE };
