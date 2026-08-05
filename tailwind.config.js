/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'],
  content: [
    "./index.html",
    "./*.tsx",
    "./*.ts",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      screens: {
        '2_5xl': '1800px',
        '3xl': '2560px',
      },
      colors: {
        primary: '#3b82f6',
        secondary: '#64748b',
        dark: '#0f172a',
        card: '#1e293b',
      }
    }
  },
  plugins: [],
}