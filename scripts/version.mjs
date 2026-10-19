#!/usr/bin/env node
/**
 * 工作区版本号管理：以 package.json 的 version 为准，按包从提交生成变更记录，
 * 升版时写入版本、提交并打 <包名>@<版本> 标签。
 *
 *   pnpm version:status
 *   pnpm version:bump <包> [patch|minor|major]
 *   pnpm version:baseline
 *   pnpm version:check
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LEVELS = ['patch', 'minor', 'major']
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/
const SUBJECT = /^([a-zA-Z]+)(?:\(([^)]+)\))?(!)?\s*[:：]\s*([\s\S]*)$/u
const RELEASE_SUBJECT = /^chore\(release\)\s*[:：]/
const BUILD_INFO = 'apps/web/src/buildInfo.ts'
const BUILD_INFO_PATTERN = /(__APP_VERSION__ === 'string' \? __APP_VERSION__ : ')([^']*)(')/

const GROUPS = [
  ['breaking', '破坏性变更'],
  ['feat', '新增'],
  ['fix', '修复'],
  ['perf', '性能'],
  ['refactor', '重构'],
  ['style', '样式'],
  ['docs', '文档'],
  ['test', '测试'],
  ['build', '构建'],
  ['revert', '回退'],
  ['other', '其他'],
]
const GROUP_OF = {
  feat: 'feat',
  fix: 'fix',
  perf: 'perf',
  refactor: 'refactor',
  style: 'style',
  docs: 'docs',
  test: 'test',
  build: 'build',
  ci: 'build',
  revert: 'revert',
}

function git(args, options = {}) {
  return execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    input: options.input,
  })
}

function hasGit(args) {
  try {
    execFileSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: ROOT, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function readWorkspacePatterns() {
  const file = join(ROOT, 'pnpm-workspace.yaml')
  if (!existsSync(file)) return []
  const patterns = []
  let reading = false
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '')
    if (!line.trim()) continue
    if (/^packages\s*:/.test(line)) {
      reading = true
      continue
    }
    if (!reading) continue
    const item = line.match(/^\s*-\s*['"]?([^'"]+?)['"]?\s*$/)
    if (item) patterns.push(item[1])
    else if (!/^\s/.test(line)) reading = false
  }
  return patterns
}

function expandWorkspaceDirs(patterns) {
  const dirs = new Set()
  for (const pattern of patterns) {
    const glob = pattern.match(/^([^*?]+)\/\*$/)
    if (glob) {
      const base = glob[1]
      const baseDir = join(ROOT, base)
      if (!existsSync(baseDir)) continue
      for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
        if (entry.isDirectory() && existsSync(join(baseDir, entry.name, 'package.json'))) dirs.add(`${base}/${entry.name}`)
      }
      continue
    }
    if (!pattern.includes('*') && existsSync(join(ROOT, pattern, 'package.json'))) dirs.add(pattern.replace(/\/$/, ''))
  }
  return [...dirs]
}

function loadPackages() {
  const rootManifestPath = join(ROOT, 'package.json')
  const rootManifest = JSON.parse(readFileSync(rootManifestPath, 'utf8'))
  const packages = [{
    name: rootManifest.name,
    dir: '',
    manifest: rootManifest,
    version: rootManifest.version,
    manifestRel: 'package.json',
    manifestPath: rootManifestPath,
    changelogRel: 'CHANGELOG.md',
  }]
  for (const dir of expandWorkspaceDirs(readWorkspacePatterns()).sort()) {
    const manifestPath = join(ROOT, dir, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    packages.push({
      name: manifest.name,
      dir,
      manifest,
      version: manifest.version,
      manifestRel: `${dir}/package.json`,
      manifestPath,
      changelogRel: `${dir}/CHANGELOG.md`,
    })
  }
  return packages
}

function resolvePackage(packages, token) {
  const short = (name) => name.replace(/^@[^/]+\//, '')
  return packages.find((pkg) => {
    if (pkg.name === token || short(pkg.name) === token) return true
    if (pkg.dir && pkg.dir.split('/').pop() === token) return true
    return short(pkg.name).endsWith('-preview') && short(pkg.name).replace(/-preview$/, '') === token
  }) ?? null
}

function latestTag(name) {
  try {
    const tag = execFileSync('git', ['-c', 'core.quotepath=false', 'describe', '--tags', '--abbrev=0', '--match', `${name}@*`], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return tag.trim() || null
  } catch {
    return null
  }
}

function collectCommits(fromRef) {
  const range = fromRef ? `${fromRef}..HEAD` : 'HEAD'
  const meta = git(['log', '--no-merges', '--format=%H%x1f%aI%x1f%s%x1f%b%x1e', range, '--'])
  const names = git(['log', '--no-merges', '--format=%x1e%H', '--name-only', range, '--'])
  const filesByHash = new Map()
  for (const chunk of names.split('\x1e')) {
    const lines = chunk.split('\n').map((line) => line.trim()).filter(Boolean)
    if (!lines.length) continue
    filesByHash.set(lines[0], lines.slice(1))
  }
  const commits = []
  for (const chunk of meta.split('\x1e')) {
    const record = chunk.replace(/^\n+/, '')
    if (!record.trim()) continue
    const [hash, date, subject, ...body] = record.split('\x1f')
    commits.push({
      hash: hash.trim(),
      date: date.trim(),
      subject: subject.trim(),
      body: body.join('\x1f').trim(),
      files: filesByHash.get(hash.trim()) ?? [],
      packages: new Set(),
    })
  }
  return commits
}

function attributeCommits(commits, packages) {
  const dirs = packages
    .filter((pkg) => pkg.dir)
    .map((pkg) => ({ name: pkg.name, prefix: `${pkg.dir}/` }))
    .sort((a, b) => b.prefix.length - a.prefix.length)
  const root = packages.find((pkg) => !pkg.dir)
  for (const commit of commits) {
    for (const file of commit.files) {
      const match = dirs.find((entry) => file.startsWith(entry.prefix))
      if (match) commit.packages.add(match.name)
      else if (root) commit.packages.add(root.name)
    }
  }
  return commits
}

function parseSemver(version) {
  const match = SEMVER.exec(version ?? '')
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  }
}

function bumpVersion(version, level) {
  const current = parseSemver(version)
  if (!current) throw new Error(`版本号 ${version} 不是合法 semver`)
  if (level === 'major') return `${current.major + 1}.0.0`
  if (level === 'minor') return `${current.major}.${current.minor + 1}.0`
  if (current.prerelease) return `${current.major}.${current.minor}.${current.patch}`
  return `${current.major}.${current.minor}.${current.patch + 1}`
}

function parseSubject(subject) {
  const match = SUBJECT.exec(subject)
  if (!match) return null
  return { type: match[1].toLowerCase(), scope: match[2] ?? null, bang: match[3] === '!', text: match[4].trim() }
}

function isBreaking(commit) {
  if (parseSubject(commit.subject)?.bang) return true
  return /(^|\n)BREAKING[ -]CHANGE\s*:/.test(commit.body)
}

function inferLevel(version, commits) {
  const current = parseSemver(version)
  if (!current) throw new Error(`版本号 ${version} 不是合法 semver`)
  if (commits.some(isBreaking)) return current.major === 0 ? 'minor' : 'major'
  return commits.some((commit) => parseSubject(commit.subject)?.type === 'feat') ? 'minor' : 'patch'
}

function formatCommit(commit) {
  const parsed = parseSubject(commit.subject)
  const text = parsed ? (parsed.scope ? `**${parsed.scope}**：${parsed.text}` : parsed.text) : commit.subject
  return `- ${text}（${commit.hash.slice(0, 7)}）`
}

function today() {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function renderSection(version, commits) {
  const buckets = new Map(GROUPS.map(([key]) => [key, []]))
  for (const commit of commits) {
    const key = isBreaking(commit) ? 'breaking' : GROUP_OF[parseSubject(commit.subject)?.type] ?? 'other'
    buckets.get(key).push(commit)
  }
  const lines = []
  for (const [key, title] of GROUPS) {
    const items = buckets.get(key)
    if (!items.length) continue
    lines.push(`### ${title}`, '')
    for (const commit of items) lines.push(formatCommit(commit))
    lines.push('')
  }
  return { heading: `## ${version} (${today()})`, body: lines.join('\n').trimEnd() }
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function changelogVersion(pkg) {
  const file = join(ROOT, pkg.changelogRel)
  if (!existsSync(file)) return null
  const match = readFileSync(file, 'utf8').match(/^##\s+v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/m)
  return match ? match[1] : null
}

function updateChangelog(pkg, version, section) {
  const file = join(ROOT, pkg.changelogRel)
  const text = existsSync(file) ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : `# ${pkg.name}\n`
  const lines = text.replace(/\s+$/, '').split('\n')
  const firstSection = lines.findIndex((line) => line.startsWith('## '))
  const header = (firstSection === -1 ? lines : lines.slice(0, firstSection)).join('\n').trimEnd()
  const blocks = []
  for (const line of firstSection === -1 ? [] : lines.slice(firstSection)) {
    if (!blocks.length || line.startsWith('## ')) blocks.push([line])
    else blocks[blocks.length - 1].push(line)
  }
  const isVersion = (block) => new RegExp(`^##\\s+v?${escapeRegExp(version)}(?:\\s|$)`).test(block[0])
  const replacement = section.split('\n')
  const index = blocks.findIndex(isVersion)
  if (index === -1) blocks.unshift(replacement)
  else blocks[index] = replacement
  const body = blocks.map((block) => block.join('\n').trimEnd()).join('\n\n')
  writeFileSync(file, `${header}\n\n${body}\n`)
}

function writeManifest(pkg, version) {
  const next = { ...pkg.manifest, version }
  writeFileSync(pkg.manifestPath, `${JSON.stringify(next, null, 2)}\n`)
  pkg.manifest = next
  pkg.version = version
}

function syncBuildInfo(pkg, version) {
  if (pkg.name !== '@sukushow/web') return null
  const file = join(ROOT, BUILD_INFO)
  if (!existsSync(file)) return null
  const text = readFileSync(file, 'utf8')
  const match = BUILD_INFO_PATTERN.exec(text)
  if (!match || match[2] === version) return null
  writeFileSync(file, text.replace(BUILD_INFO_PATTERN, `$1${version}$3`))
  return BUILD_INFO
}

function planRelease(pkg, packages, options) {
  const from = options.from ?? latestTag(pkg.name)
  if (!from) throw new Error(`${pkg.name} 还没有版本标签：先运行 pnpm version:baseline，或用 --from 指定起点`)
  const commits = attributeCommits(collectCommits(from), packages)
    .filter((commit) => !RELEASE_SUBJECT.test(commit.subject) && commit.packages.has(pkg.name))
  if (!commits.length) return null
  const level = options.level ?? inferLevel(pkg.version, commits)
  const version = bumpVersion(pkg.version, level)
  const { heading, body } = renderSection(version, commits)
  return { pkg, from, commits, level, version, heading, body, section: `${heading}\n\n${body}` }
}

function planFiles(pkg) {
  const files = [pkg.manifestRel, pkg.changelogRel]
  if (pkg.name === '@sukushow/web' && existsSync(join(ROOT, BUILD_INFO))) files.push(BUILD_INFO)
  return files
}

function printPlan(plan) {
  const { pkg, version, level, section, from } = plan
  console.log(`\n${pkg.name}  ${pkg.version} → ${version}（${level}，自 ${from}）`)
  console.log(`文件：${planFiles(pkg).join('、')}`)
  console.log(`提交：chore(release): ${pkg.name}@${version}`)
  console.log(`标签：${pkg.name}@${version}`)
  console.log('')
  console.log(section)
}

function assertRepoState(options) {
  if (options.dryRun) return
  const staged = git(['diff', '--cached', '--name-only']).trim()
  if (staged) throw new Error('暂存区还有未提交的改动，请先提交或取消暂存')
  const dirty = git(['status', '--porcelain', '--untracked-files=no']).trim()
  if (dirty && !options.allowDirty) throw new Error('工作区有未提交的改动：先提交，或用 --allow-dirty 只提交版本文件')
}

function applyPlan(plan, options) {
  const { pkg, version, body } = plan
  const tag = `${pkg.name}@${version}`
  if (hasGit(['rev-parse', '-q', '--verify', `refs/tags/${tag}`])) throw new Error(`标签 ${tag} 已存在`)
  writeManifest(pkg, version)
  updateChangelog(pkg, version, plan.section)
  const files = planFiles(pkg)
  const synced = syncBuildInfo(pkg, version)
  if (synced && !files.includes(synced)) files.push(synced)
  console.log(`\n${pkg.name}  ${pkg.version}（${tag}）`)
  console.log(`已更新：${files.join('、')}`)
  if (options.noCommit) {
    console.log('--no-commit：未提交，也未打标签')
    return
  }
  git(['add', '--', ...files])
  if (!git(['diff', '--cached', '--name-only']).trim()) throw new Error('没有可提交的变更')
  git(['commit', '-m', `chore(release): ${tag}`])
  if (options.noTag) {
    console.log(`已提交 chore(release): ${tag}（--no-tag：未打标签）`)
    return
  }
  git(['tag', '-a', tag, '-F', '-'], { input: `${pkg.name} ${version}\n\n${body}\n` })
  console.log(`已提交并打标签 ${tag}`)
}

function runStatus(options) {
  const packages = loadPackages()
  const rows = packages.map((pkg) => {
    const tag = latestTag(pkg.name)
    const commits = attributeCommits(collectCommits(options.from ?? tag ?? null), packages)
      .filter((commit) => !RELEASE_SUBJECT.test(commit.subject) && commit.packages.has(pkg.name))
    return {
      name: pkg.name,
      version: pkg.version,
      tag,
      pending: commits.length,
      suggest: commits.length ? inferLevel(pkg.version, commits) : null,
    }
  })
  if (options.json) {
    console.log(JSON.stringify({ packages: rows }, null, 2))
    return
  }
  const displayWidth = (text) => [...text].reduce((sum, char) => sum + (/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(char) ? 2 : 1), 0)
  const pad = (text, size) => text + ' '.repeat(Math.max(0, size - displayWidth(text)))
  const header = ['包', '版本', '最近标签', '待发布', '建议']
  const table = [header, ...rows.map((row) => [row.name, row.version, row.tag ?? '（无）', String(row.pending), row.suggest ?? '-'])]
  const widths = header.map((_, column) => Math.max(...table.map((line) => displayWidth(line[column]))))
  for (const line of table) console.log(line.map((cell, column) => pad(cell, widths[column])).join('  ').trimEnd())
}

function runBump(options) {
  const packages = loadPackages()
  let targets
  if (options.all) {
    if (options.packages.length) throw new Error('--all 不接受包名')
    targets = packages
  } else {
    if (!options.packages.length) throw new Error('用法：pnpm version:bump <包> [patch|minor|major]')
    targets = options.packages.map((token) => {
      const pkg = resolvePackage(packages, token)
      if (!pkg) throw new Error(`找不到包：${token}`)
      return pkg
    })
  }
  assertRepoState(options)
  const plans = []
  for (const pkg of targets) {
    const plan = planRelease(pkg, packages, options)
    if (!plan) {
      if (!options.all) throw new Error(`自 ${options.from ?? latestTag(pkg.name)} 以来没有涉及 ${pkg.name} 的提交`)
      console.log(`${pkg.name}：没有待发布提交，跳过`)
      continue
    }
    plans.push(plan)
  }
  if (!plans.length) {
    console.log('没有需要升版的包。')
    return
  }
  if (options.dryRun) {
    for (const plan of plans) printPlan(plan)
    return
  }
  for (const plan of plans) applyPlan(plan, options)
}

function runBaseline(options) {
  const packages = loadPackages()
  const at = options.at ?? 'HEAD'
  if (!hasGit(['rev-parse', '-q', '--verify', `${at}^{commit}`])) throw new Error(`找不到提交：${at}`)
  for (const pkg of packages) {
    if (!parseSemver(pkg.version)) throw new Error(`${pkg.name}: 版本号 ${pkg.version} 不是合法 semver`)
    const tag = `${pkg.name}@${pkg.version}`
    if (hasGit(['rev-parse', '-q', '--verify', `refs/tags/${tag}`])) {
      console.log(`${tag}：已存在`)
      continue
    }
    if (options.dryRun) {
      console.log(`${tag}：将创建于 ${at}`)
      continue
    }
    git(['tag', '-a', tag, at, '-m', `${pkg.name} ${pkg.version}`])
    console.log(`${tag}：已创建于 ${at}`)
  }
}

function runCheck() {
  const packages = loadPackages()
  const errors = []
  const warnings = []
  for (const pkg of packages) {
    if (!parseSemver(pkg.version)) {
      errors.push(`${pkg.name}: 版本号 ${pkg.version} 不是合法 semver`)
      continue
    }
    const tag = latestTag(pkg.name)
    if (!tag) {
      warnings.push(`${pkg.name}: 缺少 ${pkg.name}@${pkg.version} 标签（pnpm version:baseline）`)
    } else {
      const tagVersion = tag.slice(pkg.name.length + 1)
      if (tagVersion !== pkg.version) errors.push(`${pkg.name}: package.json 为 ${pkg.version}，最近标签为 ${tag}`)
      try {
        const tagged = JSON.parse(git(['show', `${tag}:${pkg.manifestRel}`])).version
        if (tagged !== tagVersion) errors.push(`${tag}: 标签内 package.json 为 ${tagged}`)
      } catch {
        errors.push(`${tag}: 无法读取标签内的 ${pkg.manifestRel}`)
      }
    }
    const logged = changelogVersion(pkg)
    if (logged && logged !== pkg.version) errors.push(`${pkg.name}: CHANGELOG 最新为 ${logged}，package.json 为 ${pkg.version}`)
    if (pkg.name === '@sukushow/web') {
      const file = join(ROOT, BUILD_INFO)
      const fallback = existsSync(file) ? BUILD_INFO_PATTERN.exec(readFileSync(file, 'utf8'))?.[2] : null
      if (fallback && fallback !== pkg.version) errors.push(`${BUILD_INFO}: 回退版本 ${fallback} 与 ${pkg.version} 不一致`)
    }
  }
  for (const warning of warnings) console.log(`⚠ ${warning}`)
  for (const error of errors) console.log(`✖ ${error}`)
  if (errors.length) {
    console.log(`\n${errors.length} 项不一致`)
    process.exitCode = 1
    return
  }
  console.log(warnings.length ? '\n版本号一致，标签待补。' : '版本号、标签与变更记录一致。')
}

function printHelp() {
  console.log(`用法：pnpm version:status | version:bump <包> [patch|minor|major] | version:baseline | version:check

命令
  status                      列出各包版本、最近标签与待发布提交
  bump <包> [patch|minor|major]  升版：写入版本与变更记录，提交并打标签
  baseline                    为各包当前版本补建缺失的标签
  check                       校验版本号、标签与变更记录是否一致

包名可用全名或简称：sukushow、web、chart、chart-svg、export、llll、pjsk
不指定升版级别时，按提交推断：破坏性变更升 minor（0.x）或 major，feat 升 minor，其余升 patch。

选项
  --all            对所有有待发布提交的包依次升版
  --from <ref>     只统计 <ref> 之后的提交，默认从最近标签起
  --dry-run        只打印将要写入的内容
  --no-commit      只改文件，不提交
  --no-tag         提交但不打标签
  --allow-dirty    工作区有未提交改动时也继续（暂存区必须为空）
  --at <ref>       baseline 指定打标签的提交，默认 HEAD
  --json           status 输出 JSON
  -h, --help       显示本帮助`)
}

function parseArgs(argv) {
  const options = {
    command: null,
    packages: [],
    all: false,
    level: null,
    from: null,
    dryRun: false,
    noCommit: false,
    noTag: false,
    allowDirty: false,
    json: false,
    at: null,
    help: false,
  }
  const rest = []
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '-h' || arg === '--help') options.help = true
    else if (arg === '--all') options.all = true
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--no-commit') options.noCommit = true
    else if (arg === '--no-tag') options.noTag = true
    else if (arg === '--allow-dirty') options.allowDirty = true
    else if (arg === '--json') options.json = true
    else if (arg === '--from') options.from = argv[++index]
    else if (arg.startsWith('--from=')) options.from = arg.slice('--from='.length)
    else if (arg === '--level') options.level = argv[++index]
    else if (arg.startsWith('--level=')) options.level = arg.slice('--level='.length)
    else if (arg === '--at') options.at = argv[++index]
    else if (arg.startsWith('--at=')) options.at = arg.slice('--at='.length)
    else if (arg.startsWith('-')) throw new Error(`未知选项：${arg}`)
    else rest.push(arg)
  }
  options.command = rest.shift() ?? null
  if (options.command === 'bump') {
    const last = rest[rest.length - 1]
    if (LEVELS.includes(last)) {
      options.level = rest.pop()
    }
    options.packages = rest
    if (options.level && !LEVELS.includes(options.level)) throw new Error(`升版级别只能是 ${LEVELS.join('、')}`)
  } else {
    if (rest.length) throw new Error(`多余参数：${rest.join(' ')}`)
    if (options.level) throw new Error('--level 只用于 bump')
  }
  if (options.command && options.at && options.command !== 'baseline') throw new Error('--at 只用于 baseline')
  if (options.command && options.from && options.command !== 'status' && options.command !== 'bump') {
    throw new Error('--from 只用于 status 与 bump')
  }
  return options
}

function main(argv) {
  const options = parseArgs(argv)
  if (options.help || !options.command) {
    printHelp()
    return
  }
  if (options.from && !hasGit(['rev-parse', '-q', '--verify', `${options.from}^{commit}`])) {
    throw new Error(`找不到提交：${options.from}`)
  }
  switch (options.command) {
    case 'status':
      runStatus(options)
      break
    case 'bump':
      runBump(options)
      break
    case 'baseline':
      runBaseline(options)
      break
    case 'check':
      runCheck()
      break
    default:
      throw new Error(`未知命令：${options.command}`)
  }
}

try {
  main(process.argv.slice(2))
} catch (error) {
  console.error(`✖ ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
}
