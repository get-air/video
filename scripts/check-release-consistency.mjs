import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const errors = []

const readText = (path) => readFileSync(resolve(root, path), 'utf8')
const readJson = (path) => {
  try {
    return JSON.parse(readText(path))
  } catch (error) {
    console.error(`Unable to read ${path}: ${error.message}`)
    process.exit(1)
  }
}

const checkLocalDependencies = (manifest, label, allowed = {}) => {
  for (const section of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    for (const [name, specifier] of Object.entries(manifest[section] ?? {})) {
      if (typeof specifier !== 'string' || !/^(?:file:|link:|workspace:)/.test(specifier)) continue
      if (allowed[name] === specifier) continue
      errors.push(`${label} has forbidden local ${section} entry ${name}: ${specifier}`)
    }
  }
}

const args = process.argv.slice(2)
let expectedTag
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--tag' && args[index + 1]) {
    expectedTag = args[index + 1]
    index += 1
  } else {
    errors.push(`Unknown or incomplete argument: ${args[index]}`)
  }
}

const packageJson = readJson('package.json')
const packageLock = readJson('package-lock.json')
const examplePackageJson = readJson('examples/air-framework-app/package.json')
const examplePackageLock = readJson('examples/air-framework-app/package-lock.json')
const changelog = readText('CHANGELOG.md')
const lockRoot = packageLock.packages?.['']

checkLocalDependencies(packageJson, 'package.json')
checkLocalDependencies(examplePackageJson, 'examples/air-framework-app/package.json', {
  '@get-air/video': 'file:../..',
})

if (packageJson.name !== '@get-air/video') {
  errors.push(`package.json name must be @get-air/video, found ${packageJson.name}`)
}
if (packageLock.name !== packageJson.name) {
  errors.push(`package-lock.json name ${packageLock.name} does not match package.json name ${packageJson.name}`)
}
if (lockRoot?.name !== packageJson.name) {
  errors.push('package-lock.json root package name does not match package.json')
}

const exampleLockRoot = examplePackageLock.packages?.['']
const linkedCore = examplePackageLock.packages?.['../..']
const linkedCoreEntry = examplePackageLock.packages?.['node_modules/@get-air/video']

if (examplePackageJson.dependencies?.['@get-air/video'] !== 'file:../..') {
  errors.push('the Air framework example must link this repository with @get-air/video file:../..')
}
if (exampleLockRoot?.dependencies?.['@get-air/video'] !== 'file:../..') {
  errors.push('the Air framework example lock root does not preserve the local core link')
}
if (linkedCoreEntry?.link !== true || linkedCoreEntry?.resolved !== '../..') {
  errors.push('the Air framework example lock does not link node_modules/@get-air/video to ../..')
}

const linkedManifestFields = [
  'name',
  'version',
  'license',
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'engines',
]
const stableJson = (value) => JSON.stringify(value, (_key, child) => {
  if (child === null || Array.isArray(child) || typeof child !== 'object') return child
  return Object.fromEntries(Object.entries(child).sort(([left], [right]) => left.localeCompare(right)))
})
for (const field of linkedManifestFields) {
  if (stableJson(linkedCore?.[field]) !== stableJson(packageJson[field])) {
    errors.push(`the Air framework example lock has stale linked-core ${field} metadata`)
  }
}

const versions = [
  ['package.json', packageJson.version],
  ['package-lock.json top level', packageLock.version],
  ['package-lock.json root package', lockRoot?.version],
]

const prereleaseIdentifier = String.raw`(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)`
const semver = new RegExp(
  String.raw`^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-${prereleaseIdentifier}(?:\.${prereleaseIdentifier})*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$`,
)
if (typeof packageJson.version !== 'string' || !semver.test(packageJson.version)) {
  errors.push(`package.json version is not valid SemVer: ${packageJson.version}`)
}

for (const [label, version] of versions) {
  if (typeof version !== 'string') {
    errors.push(`${label} version is missing`)
  } else if (version !== packageJson.version) {
    errors.push(`${label} version ${version} does not match package.json version ${packageJson.version}`)
  }
}

if (typeof packageJson.version === 'string') {
  const changelogHeading = `## ${packageJson.version}`
  const matchingHeadings = changelog
    .split(/\r?\n/)
    .filter((line) => line.replace(/[ \t]+$/, '') === changelogHeading)

  if (matchingHeadings.length !== 1) {
    errors.push(`CHANGELOG.md must contain exactly one "${changelogHeading}" heading, found ${matchingHeadings.length}`)
  }
  if (expectedTag !== undefined && expectedTag !== `v${packageJson.version}`) {
    errors.push(`release tag ${expectedTag} does not match v${packageJson.version}`)
  }
}

if (errors.length > 0) {
  console.error('Release metadata is inconsistent:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log(`Release metadata is consistent for @get-air/video ${packageJson.version}.`)
if (expectedTag !== undefined) console.log(`Release tag ${expectedTag} is valid.`)
