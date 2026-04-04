import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        navy:     '#1C2E4A',
        red:      '#A52A2A',
        charcoal: '#2E2E2E',
        steel:    '#7A7A7A',
        offwhite: '#F4F4F2',
      },
    },
  },
  plugins: [],
};
export default config;
