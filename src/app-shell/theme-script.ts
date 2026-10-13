// Not a client module, so the root layout (a server component) can inline the script

/** Where the theme choice is kept (see ThemeProvider) */
export const STORAGE_KEY = "theme";
export const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Runs in <head> (see app/layout.tsx), before the body exists, so the very first paint already has
 * the stored theme
 */
export const themeScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});var d=t==="dark"||(t!=="light"&&window.matchMedia(${JSON.stringify(DARK_QUERY)}).matches);var r=document.documentElement;r.classList.add(d?"dark":"light");r.style.colorScheme=d?"dark":"light"}catch(e){}})()`;
