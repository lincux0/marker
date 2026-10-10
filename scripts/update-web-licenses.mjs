import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const repositoryRoot = path.resolve(import.meta.dirname, '..')
const webRoot = path.join(repositoryRoot, 'src', 'Marker.Web')
const packageRoot = path.join(webRoot, 'node_modules')
const lockPath = path.join(webRoot, 'package-lock.json')
const outputPath = path.join(repositoryRoot, 'installer', 'licenses', 'WebThirdParty.txt')
const nonApplicationTooling = new Set([
  '@antfu/install-pkg',
  'import-meta-resolve',
  'package-manager-detector',
  'tinyexec',
])
const lock = JSON.parse(await readFile(lockPath, 'utf8'))
const packages = lock.packages
const root = packages['']
if (!root?.dependencies) throw new Error('package-lock.json is missing root production dependencies')

function resolvePackageLocation(parentLocation, packageName) {
  let current = parentLocation
  while (true) {
    const candidate = [current, 'node_modules', packageName].filter(Boolean).join('/')
    if (packages[candidate]) return candidate
    if (!current) return null
    const marker = current.lastIndexOf('/node_modules/')
    current = marker >= 0 ? current.slice(0, marker) : ''
  }
}

const selected = new Set()
const unresolved = new Set()
function visit(parentLocation, dependencyNames) {
  for (const dependencyName of Object.keys(dependencyNames ?? {})) {
    const location = resolvePackageLocation(parentLocation, dependencyName)
    if (!location) {
      unresolved.add(`${parentLocation || '<root>'} -> ${dependencyName}`)
      continue
    }
    if (selected.has(location)) continue

    const entry = packages[location]
    if (entry.dev || entry.devOptional) continue
    // Type declarations, package-install helpers, and OS/CPU-specific bindings are not app runtime code.
    if (dependencyName.startsWith('@types/') || dependencyName === '@chevrotain/types') continue
    if (nonApplicationTooling.has(dependencyName)) continue
    if (entry.os || entry.cpu) continue

    selected.add(location)
    visit(location, { ...entry.dependencies, ...entry.optionalDependencies })
  }
}

visit('', root.dependencies)

const licenseFilePattern = /^(?:license|licence|copying|notice)(?:[._ -].*)?$/i
const sections = []
const missingTexts = []
for (const location of [...selected].sort()) {
  const entry = packages[location]
  const packageName = location.slice('node_modules/'.length).split('/node_modules/').at(-1)
  const packageDirectory = path.join(packageRoot, ...location.slice('node_modules/'.length).split('/'))
  const manifestPath = path.join(packageDirectory, 'package.json')
  let manifest
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch {
    missingTexts.push(`${packageName}@${entry.version}: package.json not found in node_modules`)
    continue
  }

  const files = (await readdir(packageDirectory, { withFileTypes: true }))
    .filter((item) => item.isFile() && licenseFilePattern.test(item.name))
    .map((item) => item.name)
    .sort()

  const header = `================================================================================\n${manifest.name ?? packageName}@${entry.version}\nSPDX/manifest license: ${JSON.stringify(entry.license ?? manifest.license ?? 'not declared')}\nPackage: ${location}\n================================================================================`
  if (files.length === 0) {
    const missing = `${manifest.name ?? packageName}@${entry.version}: license metadata is ${JSON.stringify(entry.license ?? manifest.license ?? 'not declared')}, but no top-level LICENSE/LICENCE/COPYING/NOTICE file exists in node_modules`
    missingTexts.push(missing)
    sections.push(`${header}\n\n[LICENSE TEXT NOT FOUND]\n${missing}`)
    continue
  }

  const licenseSections = []
  for (const fileName of files) {
    const body = (await readFile(path.join(packageDirectory, fileName), 'utf8')).trim()
    licenseSections.push(`--- ${fileName} ---\n${body}`)
  }
  sections.push(`${header}\n\n${licenseSections.join('\n\n')}`)
}

const unresolvedSection = unresolved.size
  ? `\n\nUNRESOLVED LOCKFILE DEPENDENCIES\n${[...unresolved].sort().map((item) => `- ${item}`).join('\n')}`
  : ''
const missingSection = missingTexts.length
  ? `\n\nLICENSE TEXT FOLLOW-UP REQUIRED\n${missingTexts.map((item) => `- ${item}`).join('\n')}`
  : ''
const content = [
  'Marker Web production third-party license texts',
  `Generated from src/Marker.Web/package-lock.json (lockfileVersion ${lock.lockfileVersion}) and installed node_modules package files.`,
  'Development dependencies, type-only packages, package-install tooling, and OS/CPU-specific packages are excluded.',
  'Keep this document with the distributed Web runtime and preserve each package copyright notice.',
  '',
  sections.join('\n\n'),
  unresolvedSection,
  missingSection,
  '',
].join('\n').replace(/\n/g, '\r\n')

await writeFile(outputPath, content, 'utf8')
console.log(`Wrote ${outputPath}`)
console.log(`Included ${selected.size} production packages.`)
if (unresolved.size || missingTexts.length) {
  console.error(`Follow-up required: ${unresolved.size} unresolved dependencies, ${missingTexts.length} packages without license text.`)
  process.exitCode = 1
} else {
  console.log('All included packages have a top-level license or notice text file.')
}
