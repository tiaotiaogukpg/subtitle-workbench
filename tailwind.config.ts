import type { Config } from 'tailwindcss'

export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#d9d9d9',
        panel: '#c6c6c6',
        field: '#a7a7a7',
        accent: '#9ed8f4',
        ink: '#111111'
      },
      fontFamily: {
        sans: [
          'Inter',
          '"Noto Sans SC"',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          '"PingFang SC"',
          '"Microsoft YaHei"',
          'sans-serif'
        ],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace']
      },
      fontSize: {
        /** 应用正文基准，与 styles.css body 一致 */
        ui: ['13px', { lineHeight: '1.5' }],
        'ui-sm': ['12px', { lineHeight: '1.45' }],
        'ui-editor': ['15px', { lineHeight: '1.55' }]
      }
    }
  },
  plugins: []
} satisfies Config
