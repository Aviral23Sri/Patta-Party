import os from 'node:os'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'

/**
 * This machine's LAN IPv4 addresses, home-network ranges first. Exposed to the
 * dev build so the Table can suggest a phone-reachable URL when opened on
 * localhost. Production builds get an empty list.
 */
function lanIPs(): string[] {
  const rank = (ip: string) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2)
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && !i.internal && (i.family === 'IPv4' || (i.family as unknown) === 4))
    .map((i) => i!.address)
    .sort((a, b) => rank(a) - rank(b))
}

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  define: {
    __LAN_IPS__: JSON.stringify(command === 'serve' ? lanIPs() : []),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/engine/**', 'src/net/**'],
    },
  },
}))
