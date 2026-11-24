# Changelog

## [1.4.2] - 2026-11-24

Developer: Achmad Yukrisna

### Fixed
- Stray "MENU" breadcrumb at the top of the hero on desktop. The breadcrumb ("Home / Menu") now shows on phones only.

### Changed
- Photo gallery on the menu page shows only photos of the cafe itself (street front, entrance, terrace, dining hall, window tables, bar, arch, rooftop, side seating). Food and drink photos are no longer in the gallery, since the menu cards below already show them.

### Added
- 7 more cafe photos from the Google Maps reviews in `assets/place/` (street, entrance, terrace, hall, tables, rooftop, sidewalk).

### Removed
- `assets/place/barista.webp` (no longer used).

## [1.4.1] - 2026-11-24

Developer: Achmad Yukrisna

### Changed
- Menu page hero now fills the whole screen on phones and desktop (was capped at 760px).
- Hero title moved up to make room for the scroll indicator.

### Added
- Animated scroll indicator at the bottom of the hero; tapping it scrolls to the intro.

## [1.4.0] - 2026-11-24

Developer: Achmad Yukrisna

### Added
- Cafe photos from the Texture Coffee Google Maps listing in `assets/place/` (front, interior, bar, window seats, arch, barista, iced coffee, snack, cold drink).
- "More from texture" section on the menu page with the home page links: Frugal Treats, Location, Textunes, Grand Tex Avenue, Shopee, Tokopedia and Tiktokshop.
- Desktop header navigation on the menu page: Menu, More, Reservasi.

### Changed
- Menu page hero now shows the cafe front instead of a menu PDF crop.
- Gallery now shows the cafe interior and drinks first, then the food photos.
- Snack, Signature Coffee and Cold Selection cards use the new photos.
- Home page (linktree) shows only on phones. On screens 900px and wider it redirects to `/menu/`. Add `?links` to the URL to open the linktree on desktop.
- On desktop the menu page hides the "Home" back link, so it does not lead back to the redirect.

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
