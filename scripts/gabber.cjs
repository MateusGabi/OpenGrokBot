// Thin cross-platform runner for Gabber's semver.sh (https://github.com/MateusGabi/Gabber).
// Usage: npm run gabber -- --next=minor   or   npm run gabber -- --generate=minor
const { spawnSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const path = require('node:path')

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('Usage: npm run gabber -- [--next|--generate=]major|minor|patch [--verbose] [--sha] [--date] [--build-number]')
  process.exit(1)
}

// On Windows, bash.exe in System32 is a WSL stub with no distro installed; Git for Windows ships a working bash.
const gitBash = ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe'].find(existsSync)
const bash = process.platform === 'win32' ? (gitBash ?? 'bash') : 'bash'
const script = path.join(__dirname, 'semver.sh')

const result = spawnSync(bash, [script, ...args], { cwd: process.cwd(), stdio: 'inherit' })
if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}
process.exit(result.status ?? 1)
