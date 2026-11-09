// Wron design tokens. Generated - do not edit.
//
// The app's one contract: one gutter, one type ramp, one spacing scale, one
// palette.
//
// SCREENS IMPORT THIS DIRECTLY. It used to say ui/theme.js reads it, and that
// was never true: ui/theme.js is a fixed kit file shared by every app,
// including the ones built before contracts existed, and making it import a
// module that is only sometimes written would break them. Colours reach a
// screen through the theme; measurements reach it from here.
//
// contract d7249369 · direction Dark and glowing, VU needles and red record lights in a dim studio · engine v3
export const DESIGN_CONTRACT = {"hash":"d7249369","directionId":"Dark and glowing, VU needles and red record lights in a dim studio","palette":{"bg":"#0B0907","surface":"#1A1714","surfaceAlt":"#1D2430","text":"#EDE6DB","textMuted":"#A89F94","border":"#332D27","accent":"#FF2A1F","accentSoft":"#3A1411","onAccent":"#FFFFFF","success":"#7FD18B","warning":"#FFB347","danger":"#FF2A1F"},"typography":{"display":{"size":34,"weight":700,"lineHeight":1.15,"scales":true,"letterSpacing":-0.4},"title":{"size":28,"weight":700,"lineHeight":1.2,"scales":true,"letterSpacing":-0.3},"heading":{"size":20,"weight":600,"lineHeight":1.25,"scales":true},"body":{"size":17,"weight":400,"lineHeight":1.45,"scales":true},"label":{"size":15,"weight":500,"lineHeight":1.3,"scales":true},"caption":{"size":13,"weight":400,"lineHeight":1.3,"scales":true}},"spacing":{"xs":4,"sm":8,"md":16,"lg":24,"xl":32,"pageGutter":20,"cardInset":16,"sectionGap":32,"siblingGap":12},"recipes":[{"name":"listRow","title":"body","support":"caption","minHeight":56,"inset":"cardInset","radius":0},{"name":"card","title":"heading","support":"body","minHeight":64,"inset":"cardInset","radius":16},{"name":"statTile","title":"title","support":"caption","minHeight":76,"inset":"cardInset","radius":16},{"name":"formRow","title":"body","support":"caption","minHeight":52,"inset":"cardInset","radius":0},{"name":"chip","title":"label","minHeight":44,"inset":"sm","radius":999},{"name":"primaryButton","title":"body","minHeight":50,"inset":"md","radius":14}],"font":{"family":"Barlow Condensed","fallback":"System","resolved":true}};

export const palette = DESIGN_CONTRACT.palette;
export const spacing = DESIGN_CONTRACT.spacing;
export const typography = DESIGN_CONTRACT.typography;
export const recipes = DESIGN_CONTRACT.recipes;

/** A recipe by name, or null. Screens read recipes; they do not invent insets. */
export function recipe(name) {
  return DESIGN_CONTRACT.recipes.find(function (r) { return r.name === name; }) || null;
}

export default DESIGN_CONTRACT;
