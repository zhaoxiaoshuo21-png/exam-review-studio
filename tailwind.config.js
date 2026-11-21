/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        obsidian: '#111214',
        cardDark: '#181A1F',
        coralAccent: '#F26B6B',
      },
    },
  },
  plugins: [],
};
