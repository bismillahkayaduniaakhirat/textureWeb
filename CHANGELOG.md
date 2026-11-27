# Changelog

## [1.5.4] - 2026-11-27

Developer: Achmad Yukrisna

### Changed
- First-load hero effect now follows uniongroupjakarta.com: the hero photo starts hidden on cream and fades in (1.2s ease-in-out) once the loader is gone, with a light zoom. After that, the logo, tagline and scroll mouse fade up in turn.
- Phone hero follows MOBILE 1. The 589x1280 artboard is one phone screen, and sizes scale at 1 design px = 100vw/589:
  - the hero is 88.75% of the screen height, so the intro text peeks below it as in the design;
  - mouse, logo, tagline, title and intro text are sized and placed as in the design, within about 10px at 375x812;
  - tagline text is kept at 8px minimum so it stays readable.
- Hero image preload now picks the phone or desktop photo by screen width.

### Added
- Brown dashed line between the phone hero and the cream section, as in MOBILE 1.

## [1.5.3] - 2026-11-27

Developer: Achmad Yukrisna

### Fixed
- Desktop hero no longer cuts off the top of the glass on screens wider than 16:10 (such as 1920x940 and 1366x657). The glass used to hit the nav row. The photo focus moved from 66% to 22% from the top, so wide screens crop the bottom of the photo instead. At 1440x900 the hero still matches DESKTOP 1 exactly.

## [1.5.2] - 2026-11-27

Developer: Achmad Yukrisna

### Changed
- Photos now come from the client's original files (texture-assets folder) instead of the small images cut from the SVG designs:
  - 15 gallery photos at 540x810;
  - desktop hero;
  - OOT banner background.
- The phone hero uses its own photo (`hero-m.webp`). The 144px transparent strip at the bottom of the source PNG is cropped off.
- Gallery photos 13-15 are the client's new shots (iced coffee, strawberry soda, cream coffee).

### Added
- Spinning OOT logo on the OOT banner (`assets/v2/oot-spin.webp`, with `.gif` fallback). It is cropped and shrunk to about 330 KB. The small OOT logos on the Shopee/Tokopedia/Tiktokshop cards stay static.

## [1.5.1] - 2026-11-27

Developer: Achmad Yukrisna

### Changed
- Hero logo is now the spinning texture logo GIF (`assets/v2/logo-spin.webp`, with `.gif` fallback), cropped and shrunk from 9 MB to about 680 KB.
- Animations in the style of uniongroupjakarta.com/brands/union:
  - the hero photo zooms in from 1.2x to 1x;
  - the logo, tagline and scroll mouse fade up;
  - nav links get an underline that sweeps in;
  - Selections/Reach/Features buttons and the Shopee/Tokopedia/Tiktokshop cards fill brown from the side on hover, and the text turns cream.

### Added
- Loading screen: brown background with a blinking texture logo. It fades out after the page loads.
- Scroll reveal: the intro text, gallery photos, button groups, OOT banner and footer fade up 10px in sequence as they come into view.
- Reduced-motion users get no loader and no animations.

### Fixed
- Footer address: "01 Dr. Wahidin Street, Kediri".

## [1.5.0] - 2026-11-27

Developer: Achmad Yukrisna

### Changed
- New design from the MOBILE 1-3 and DESKTOP 1-3 files. One home page (`/`) for both phone and desktop, cream (#fff9f1) and brown (#592622) palette, Courier text.
- Full-screen hero with the latte photo, "TEXTURE COFFEE" title, dashed line, scroll mouse, white texture logo and tagline. Desktop shows the nav row: Selection, Reach, Features, OOT Store.
- After the hero, the header turns cream with a brown dashed line and stays at the top.
- Selections (Menu, Frugal Treats), Reach (Reservations, Location) and Features (Grand Tex Avenue, Textunes) as framed buttons with shadow. Three boxed columns on desktop, two buttons per row on phone.
- Menu and Frugal Treats viewer restyled to the new palette.
- `/menu/` now redirects to `/#selections`.

### Added
- Intro text about Texture Coffee in Kediri.
- Gallery of 15 photos from the design, with left/right arrow buttons.
- OutOfTex section: black-and-white photo, OOT logo, and Shopee / Tokopedia / Tiktokshop cards. Cards sit on the photo on desktop and below it on phone.
- Footer with tagline, address (links to Maps), Instagram and TikTok.
- Design assets in `assets/v2/`.

### Removed
- Old linktree layout (avatar, Home/Shop tabs, share button) and the old desktop menu page.

## [1.4.4] - 2026-11-24

Developer: Achmad Yukrisna

### Fixed
- Phones now always get the original linktree home. Opening `/menu/` on a screen narrower than 900px redirects to `/`.

### Changed
- Linktree "Menu" button opens the menu PDF pages in the in-page viewer again (as before 1.3.0), instead of going to `/menu/`.
- `/menu/` is now the desktop-only home page.

## [1.4.3] - 2026-11-24

Developer: Achmad Yukrisna

### Changed
- Scroll indicator on the menu page hero now bobs up and down as a whole, not only the dot inside it.
- Scroll indicator keeps moving even when the device has animations turned off (reduced motion).
- Darker overlay on the hero photo, so the title and header read better.

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
