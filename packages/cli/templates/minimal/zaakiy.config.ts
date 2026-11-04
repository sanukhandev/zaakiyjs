import type {StyleConfig} from "@zaakiyjs/styles";

const config = {
  brand: {
    colors: {primary: "#334ac0", foreground: "#172033", background: "#ffffff"},
    spacing: {1: "0.25rem", 2: "0.5rem", 4: "1rem", 8: "2rem"},
    fonts: {body: "system-ui, sans-serif"},
    radii: {md: "0.5rem"},
    breakpoints: {md: "48rem"}
  },
  mode: "system",
  safelist: []
} satisfies StyleConfig;

export default config;
