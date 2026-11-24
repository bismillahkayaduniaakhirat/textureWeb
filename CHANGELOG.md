# Changelog

## [1.3.0] - 2026-11-24

Developer: Achmad Yukrisna

### Added
- New menu page at `/menu/`: hero photo, intro, photo gallery with arrows, and one card per menu category (Main Course, Snack, Dessert, Signature Coffee, Cold Selection, Frugal Treats).
- Each card's "View menu" opens that category's PDF pages in an in-page viewer; "Reservasi" opens WhatsApp.
- Card photos cropped from the menu PDF pages into `assets/cards/`.

### Changed
- Home page "Menu" button now opens `/menu/` instead of the in-page PDF viewer.

## [1.2.1] - 2026-11-23

Developer: Achmad Yukrisna

### Fixed
- `/grandtexavenue/` redirect loop (Netlify treats `/grandtexavenue` and `/grandtexavenue/` as one path).

## [1.2.0] - 2026-11-23

Developer: Achmad Yukrisna

### Changed
- Game URL moves to `texturecoffee.id/grandtexavenue/`, served from the `texturegameavenue.netlify.app` project instead of `serene-fairy-1cce73.netlify.app`.
- "Grand Tex Avenue" button now links to `/grandtexavenue/`.

### Added
- Old `/grandtextureauto/` links redirect (301) to `/grandtexavenue/`.

## [1.1.0] - 2026-11-23

Developer: Achmad Yukrisna

### Changed
- Rename home page section title from "Game" to "Venue".

## [1.0.0] - 2026-11-22

Developer: Achmad Yukrisna

### Changed
- Rename game link label on the home page from "Grand Texture Auto" to "Grand Tex Avenue".
