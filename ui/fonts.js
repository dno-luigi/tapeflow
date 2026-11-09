// The typeface the approved designs are set in, identified from the rendered
// screens and resolved to real files on Google's font CDN.
//
// Each WEIGHT is its own family name on purpose: React Native does not
// synthesise weight for a custom font, so 'BarlowCondensed_800' and its siblings are
// separate faces rather than one family with a fontWeight applied.
export const FONTS = {
  "heading": "Barlow Condensed",
  "body": "Barlow Condensed",
  "files": [
    {
      "family": "BarlowCondensed_800",
      "url": "https://fonts.gstatic.com/s/barlowcondensed/v13/HTxwL3I-JCGChYJ8VI-L6OO_au7B47b1_3E.ttf"
    },
    {
      "family": "BarlowCondensed_700",
      "url": "https://fonts.gstatic.com/s/barlowcondensed/v13/HTxwL3I-JCGChYJ8VI-L6OO_au7B46r2_3E.ttf"
    },
    {
      "family": "BarlowCondensed_400",
      "url": "https://fonts.gstatic.com/s/barlowcondensed/v13/HTx3L3I-JCGChYJ8VI-L6OO_au7B2xY.ttf"
    },
    {
      "family": "BarlowCondensed_600",
      "url": "https://fonts.gstatic.com/s/barlowcondensed/v13/HTxwL3I-JCGChYJ8VI-L6OO_au7B4873_3E.ttf"
    },
    {
      "family": "BarlowCondensed_500",
      "url": "https://fonts.gstatic.com/s/barlowcondensed/v13/HTxwL3I-JCGChYJ8VI-L6OO_au7B4-Lw_3E.ttf"
    }
  ],
  "scale": {
    "title": "BarlowCondensed_800",
    "heading": "BarlowCondensed_700",
    "body": "BarlowCondensed_400",
    "label": "BarlowCondensed_600",
    "caption": "BarlowCondensed_500"
  }
};
