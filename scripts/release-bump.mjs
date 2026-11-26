import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const BREAKING = /BREAKING CHANGE:|^\w+(?:\([^)]+\))?!:/
const FEAT = /^feat(?:\([^)]+\))?:/i
const FIX = /^fix(?:\([^)]+\))?:/i
const RELEASE = /^chore\(release\):/

export function nextVersion(commits, lastVersion) {
  const eligible = commits.filter((subject) => !RELEASE.test(subject))
  let bump = null
  if (eligible.some((subject) => BREAKING.test(subject))) bump = 'major'
  else if (eligible.some((subject) => FEAT.test(subject))) bump = 'minor'
  else if (eligible.some((subject) => FIX.test(subject))) bump = 'patch'
  if (!bump) return null

  const [major = 0, minor = 0, patch = 0] = (lastVersion ?? '0.0.0')
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0)

  if (bump === 'major') return { version: `${major + 1}.0.0`, bump }
  if (bump === 'minor') return { version: `${major}.${minor + 1}.0`, bump }
  return { version: `${major}.${minor}.${patch + 1}`, bump }
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function main() {
  const lastTag = git(['tag', '--list', '--sort=-v:refname']).split(/\r?\n/).filter(Boolean)[0] ?? null
  const subjects = git(lastTag ? ['log', `${lastTag}..HEAD`, '--pretty=%s'] : ['log', '--pretty=%s'])
    .split(/\r?\n/)
    .filter(Boolean)
  const result = nextVersion(subjects, lastTag?.replace(/^v/, '') ?? null)
  if (result) process.stdout.write(`version=${result.version}\nbump=${result.bump}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
