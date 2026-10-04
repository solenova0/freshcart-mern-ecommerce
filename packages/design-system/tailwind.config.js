export default {
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: 'var(--primary)', dark: 'var(--primary-dark)', tint: 'var(--primary-tint)' },
        accent: 'var(--accent)', background: 'var(--background)', surface: 'var(--surface)',
        text: 'var(--text)', muted: 'var(--muted)', border: 'var(--border)',
        success: 'var(--success)', warning: 'var(--warning)', error: 'var(--error)', info: 'var(--info)',
      },
      fontFamily: { sans: ['Inter', 'sans-serif'], heading: ['Plus Jakarta Sans', 'sans-serif'] },
      spacing: { grid: '8px' },
      borderRadius: { card: 'var(--radius-card)' },
      boxShadow: { soft: 'var(--shadow-soft)' },
    },
  },
}