'use strict'

/**
 * Exhaustive PEM key-material scan for the current Git worktree.
 *
 * The old Vitest test recursively walked source trees and read every candidate
 * file in JavaScript. Besides repeating directory I/O, that made its cost
 * depend on Windows filesystem/Defender latency. Git already knows the exact
 * versioned tree: `git grep` searches every tracked text file in native code,
 * and Node only opens files that contain a PEM private-key marker. No source
 * directory is allowlisted or skipped.
 *
 * `git grep -I` ignores binary blobs (a PEM block is ASCII text); the produced
 * installer/standalone are checked separately by check-artifact-secrets.mjs.
 * Git-ignored dependencies/build output are intentionally not source: the
 * release artifact gates inspect the actual `.next/standalone` and `dist`.
 * Tracked and non-ignored untracked text files are included. Symlinks are
 * resolved only when their targets remain inside the repository; external,
 * broken, directory, and unreadable links fail closed as scan issues.
 */

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { containsPrivateKeyMaterial } = require('./private-key-material.cjs')

const GIT_MAX_BUFFER = 64 * 1024 * 1024
const TEXT_EXTENSIONS = new Set([
  '.bat', '.c', '.cc', '.cjs', '.cmd', '.conf', '.config', '.cpp', '.cs', '.css', '.cts', '.example',
  '.go', '.h', '.htm', '.html', '.ini', '.java', '.js', '.json', '.jsonc',
  '.jsx', '.kt', '.md', '.mjs', '.mts', '.php', '.prisma', '.properties',
  '.ps1', '.psm1', '.py', '.rb', '.rs', '.scss', '.sh', '.sql', '.svg',
  '.swift', '.toml', '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml',
])

function runGit(root, args, { allowNoMatches = false } = {}) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: null,
    maxBuffer: GIT_MAX_BUFFER,
    timeout: 15_000,
    windowsHide: true,
  })
  if (result.error) throw new Error(`git ${args[0]} indisponible ou en échec: ${result.error.message}`)
  if (result.signal) throw new Error(`git ${args[0]} interrompu (${result.signal})`)
  if (result.status !== 0 && !(allowNoMatches && result.status === 1 && result.stdout?.length === 0)) {
    const diagnostic = result.stderr?.toString('utf8').trim()
    throw new Error(`git ${args[0]} a échoué (${result.status})${diagnostic ? `: ${diagnostic}` : ''}`)
  }
  return result
}

function nulPaths(buffer) {
  return buffer.toString('utf8').split('\0').filter(Boolean)
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

function stageEntries(root) {
  const result = runGit(root, ['ls-files', '--stage', '-z'])
  return result.stdout.toString('utf8').split('\0').filter(Boolean).map((entry) => {
    const tab = entry.indexOf('\t')
    if (tab < 0) throw new Error('Sortie git ls-files --stage invalide')
    const metadata = entry.slice(0, tab).split(' ')
    return { mode: metadata[0], path: entry.slice(tab + 1) }
  })
}

function sourceLikeUntrackedPath(relativePath) {
  return TEXT_EXTENSIONS.has(path.extname(relativePath).toLowerCase())
    || ['Dockerfile', 'LICENSE', 'Makefile', 'Procfile'].includes(path.basename(relativePath))
}

function inspectPath(root, rootReal, relativePath, isGitSymlink = false) {
  const normalizedPath = relativePath.replace(/\\/g, '/')
  const absolutePath = path.resolve(root, relativePath)
  if (!isInside(root, absolutePath)) {
    return { path: normalizedPath, issue: 'chemin hors du dépôt', hasPrivateKey: false }
  }

  try {
    const originalStat = fs.lstatSync(absolutePath)
    let readablePath = absolutePath
    if (originalStat.isSymbolicLink()) {
      readablePath = fs.realpathSync(absolutePath)
      if (!isInside(rootReal, readablePath)) {
        return { path: normalizedPath, issue: 'lien symbolique sortant du dépôt', hasPrivateKey: false }
      }
      if (!fs.statSync(readablePath).isFile()) {
        return { path: normalizedPath, issue: 'cible symbolique non régulière', hasPrivateKey: false }
      }
    } else if (isGitSymlink && originalStat.isFile()) {
      // Windows checkouts with core.symlinks=false materialize a Git symlink as
      // a regular file containing its target. Resolve that target explicitly so
      // the behavior is testable even without Windows symlink privileges.
      const target = fs.readFileSync(absolutePath, 'utf8')
      if (!target || /[\r\n\0]/.test(target)) {
        return { path: normalizedPath, issue: 'cible de lien symbolique invalide', hasPrivateKey: false }
      }
      readablePath = path.resolve(path.dirname(absolutePath), target)
      if (!isInside(rootReal, readablePath)) {
        return { path: normalizedPath, issue: 'lien symbolique sortant du dépôt', hasPrivateKey: false }
      }
      readablePath = fs.realpathSync(readablePath)
      if (!isInside(rootReal, readablePath) || !fs.statSync(readablePath).isFile()) {
        return { path: normalizedPath, issue: 'cible symbolique non régulière', hasPrivateKey: false }
      }
    } else if (!originalStat.isFile()) {
      return { path: normalizedPath, issue: 'fichier non régulier', hasPrivateKey: false }
    }

    const contents = fs.readFileSync(readablePath, 'utf8')
    return {
      path: normalizedPath,
      issue: null,
      hasPrivateKey: containsPrivateKeyMaterial(contents),
    }
  } catch (error) {
    // Do not include file contents or key material in diagnostics.
    return {
      path: normalizedPath,
      issue: `fichier impossible à inspecter (${error.code || 'I/O'})`,
      hasPrivateKey: false,
    }
  }
}

/**
 * Scan the staged/tracked Git tree and non-ignored untracked source text.
 * @param {string} repositoryRoot absolute or relative Git worktree root
 * @returns {{ findings: string[], issues: string[], trackedPaths: string[], trackedFileCount: number, candidateFileCount: number, symlinkCount: number, untrackedSourceCount: number }}
 */
function scanVersionedPrivateKeys(repositoryRoot) {
  const root = path.resolve(repositoryRoot)
  const rootReal = fs.realpathSync(root)
  const started = process.hrtime.bigint()
  const entries = stageEntries(root)
  const trackedPaths = entries.map((entry) => entry.path)
  const symlinkPaths = entries.filter((entry) => entry.mode === '120000').map((entry) => entry.path)
  const untrackedPaths = nulPaths(runGit(root, ['ls-files', '--others', '--exclude-standard', '-z']).stdout)

  // `-I` skips binary files, while `-l -z` returns only candidate pathnames.
  // No pathspec is supplied: every tracked text file in the worktree is searched.
  const markerSearch = runGit(root, ['grep', '-I', '-l', '-z', '-F', '--', 'PRIVATE KEY-----'], {
    allowNoMatches: true,
  })
  const trackedCandidates = markerSearch.status === 1 ? [] : nulPaths(markerSearch.stdout)
  const candidates = new Set(trackedCandidates)
  const issues = []
  const findings = []
  const inspected = new Set()

  const trackedSymlinkSet = new Set(symlinkPaths)
  function inspect(relativePath, isGitSymlink = false) {
    const result = inspectPath(root, rootReal, relativePath, isGitSymlink)
    inspected.add(result.path)
    if (result.issue) issues.push(`${result.path}: ${result.issue}`)
    if (result.hasPrivateKey) findings.push(result.path)
  }

  for (const relativePath of candidates) inspect(relativePath, trackedSymlinkSet.has(relativePath))

  // Git stores a symlink as a target path, not as the linked file contents.
  // Inspect every tracked/untracked symlink separately so it cannot hide a key.
  for (const relativePath of symlinkPaths) inspect(relativePath, true)
  for (const relativePath of untrackedPaths) {
    let stat
    try { stat = fs.lstatSync(path.resolve(root, relativePath)) } catch { continue }
    if (stat.isSymbolicLink()) inspect(relativePath)
    else if (stat.isFile() && sourceLikeUntrackedPath(relativePath)) inspect(relativePath)
  }

  return {
    findings: [...new Set(findings)].sort(),
    issues: [...new Set(issues)].sort(),
    trackedPaths,
    trackedFileCount: trackedPaths.length,
    candidateFileCount: candidates.size,
    symlinkCount: symlinkPaths.length + untrackedPaths.filter((relativePath) => {
      try { return fs.lstatSync(path.resolve(root, relativePath)).isSymbolicLink() } catch { return false }
    }).length,
    untrackedSourceCount: untrackedPaths.filter(sourceLikeUntrackedPath).length,
    scannedPathCount: inspected.size,
    elapsedMs: Number(process.hrtime.bigint() - started) / 1e6,
  }
}

module.exports = { scanVersionedPrivateKeys }
