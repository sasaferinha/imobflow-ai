# Nunito for Evolution

`nunito-latin-wght-normal.woff2` is the unmodified Latin subset of the Nunito
variable font served by Google Fonts (v32). It uses the normal style and supports
weights 200–1000, including 400, 600, and 700. The subset includes Latin-1,
including the precomposed accented characters used in Portuguese.

- Retrieved: 2026-10-07
- Official font page: https://fonts.google.com/specimen/Nunito
- Source stylesheet: https://fonts.googleapis.com/css2?family=Nunito:wght@200..1000&display=swap
- Download URL: https://fonts.gstatic.com/s/nunito/v32/XRXV3I6Li01BKofINeaB.woff2
- Copyright: 2014 The Nunito Project Authors (https://github.com/googlefonts/nunito)
- License: SIL Open Font License 1.1; see `OFL.txt` alongside this file.
- License source: https://github.com/google/fonts/blob/main/ofl/nunito/OFL.txt
- Size: 39,128 bytes
- SHA-256: `ba344451eab25b217a165363b1982048a5e5830a0daf36577973955a04cac793`

Recommended CSS (the browser loads the font from this application):

```css
@font-face {
  font-family: "Nunito";
  font-style: normal;
  font-weight: 200 1000;
  font-display: swap;
  src: url("/fonts/evolution/nunito-latin-wght-normal.woff2") format("woff2");
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6,
    U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122,
    U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
```

The Unicode range above is copied from the official source stylesheet. Use
`font-family: "Nunito", sans-serif` on the intended interface scope. Additional
scripts, extended Latin characters, or italic styles require their own assets.
