/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ["./views/**/*.ejs"],
    theme: {
        extend: {
            colors: {
                primary: {
                    DEFAULT: '#6366f1',
                    hover: '#4f46e5',
                },
                bg: '#0f172a',
                card: '#1e293b',
                border: '#334155',
            }
        },
    },
    plugins: [],
}
