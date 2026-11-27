import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { isSecretFile, repoDigest, repoDigestBlock } from '@/lib/engine/execs/repo-digest'
import { htmlToText } from '@/lib/engine/execs/public-page'

// For an AI that can't open files, MarkOS reads the repo itself. It must never
// read or even list a secret file, and must respect what git ignores.

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'markos-digest-'))
const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'markos-digest-plain-'))
afterAll(() => {
  fs.rmSync(repo, { recursive: true, force: true })
  fs.rmSync(plain, { recursive: true, force: true })
})

function write(root: string, file: string, text: string) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
  fs.writeFileSync(path.join(root, file), text)
}

describe('repo digest', () => {
  it('lists tracked files and reads the project files, never secrets or ignored files', async () => {
    write(repo, 'README.md', '# Acme\nA tool for invoices.')
    write(repo, 'package.json', '{"name":"acme","version":"1.2.3"}')
    write(repo, 'src/index.ts', 'export const x = 1')
    write(repo, '.env.local', 'API_KEY=sk-live-should-never-appear')
    write(repo, 'config/credentials.json', '{"secret":"never"}')
    write(repo, 'build-output/huge.js', 'ignored')
    write(repo, '.gitignore', 'build-output/\n')
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' })
    git('init', '-q')
    // Even a secret that was committed by mistake is never listed or read.
    git('add', '-A', '-f', '.env.local', 'config/credentials.json', 'README.md', 'package.json', 'src/index.ts', '.gitignore')
    const text = await repoDigest([repo])
    expect(text).toContain('src/index.ts')
    expect(text).toContain('A tool for invoices.')
    expect(text).toContain('"version":"1.2.3"')
    expect(text).not.toContain('.env.local')
    expect(text).not.toContain('sk-live-should-never-appear')
    expect(text).not.toContain('credentials.json')
    expect(text).not.toContain('build-output')
  })

  it('walks a folder that isn’t a git repo, skipping dependencies', async () => {
    write(plain, 'README.md', 'plain folder')
    write(plain, 'node_modules/dep/index.js', 'dep')
    write(plain, 'app/page.tsx', 'page')
    write(plain, 'id_ed25519', 'PRIVATE KEY')
    const text = await repoDigest([plain])
    expect(text).toContain('app/page.tsx')
    expect(text).not.toContain('node_modules')
    expect(text).not.toContain('id_ed25519')
  })

  it('never reads a project file git ignores, even one with a project-file name', async () => {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), 'markos-digest-ignored-'))
    write(r, 'README.md', 'public readme')
    write(r, 'TODO.md', 'private plan: never in the digest')
    write(r, '.gitignore', 'TODO.md\n')
    execFileSync('git', ['-C', r, 'init', '-q'], { stdio: 'ignore' })
    execFileSync('git', ['-C', r, 'add', '-A'], { stdio: 'ignore' })
    const text = await repoDigest([r])
    expect(text).toContain('public readme')
    expect(text).not.toContain('private plan')
    expect(text).not.toContain('TODO.md')
    fs.rmSync(r, { recursive: true, force: true })
  })

  it('reads nothing git ignores when the product folder is a subfolder of a repository', async () => {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), 'markos-digest-sub-'))
    write(r, '.gitignore', 'TODO.md\nprivate/\n')
    write(r, 'app/README.md', 'the app readme')
    write(r, 'app/TODO.md', 'private plan: never in the digest')
    write(r, 'app/private/notes.ts', 'never listed')
    write(r, 'app/src/page.tsx', 'page')
    execFileSync('git', ['-C', r, 'init', '-q'], { stdio: 'ignore' })
    const text = await repoDigest([path.join(r, 'app')])
    expect(text).toContain('the app readme')
    expect(text).toContain('src/page.tsx')
    expect(text).not.toContain('private plan')
    expect(text).not.toContain('TODO.md')
    expect(text).not.toContain('notes.ts')
    fs.rmSync(r, { recursive: true, force: true })
  })

  it('reads a new README git doesn’t track yet, and skips dependencies nobody ignored', async () => {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), 'markos-digest-new-'))
    write(r, 'README.md', 'brand new readme')
    write(r, 'node_modules/dep/index.js', 'dep')
    execFileSync('git', ['-C', r, 'init', '-q'], { stdio: 'ignore' })
    const text = await repoDigest([r])
    expect(text).toContain('brand new readme')
    expect(text).not.toContain('node_modules')
    fs.rmSync(r, { recursive: true, force: true })
  })

  it('sees file names exactly as they are, so a secret with an accented name stays hidden', async () => {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), 'markos-digest-name-'))
    write(r, 'README.md', 'readme')
    write(r, 'keys/clé.pem', 'PRIVATE KEY')
    execFileSync('git', ['-C', r, 'init', '-q'], { stdio: 'ignore' })
    execFileSync('git', ['-C', r, 'add', '-A'], { stdio: 'ignore' })
    const text = await repoDigest([r])
    expect(text).toContain('readme')
    expect(text).not.toContain('.pem')
    expect(text).not.toContain('PRIVATE KEY')
    fs.rmSync(r, { recursive: true, force: true })
  })

  // Making a link needs extra rights on Windows; the rule is the same there.
  it.skipIf(process.platform === 'win32')('never follows a link, even a committed README that points at .env', async () => {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), 'markos-digest-link-'))
    write(r, '.env', 'API_KEY=sk-live-never')
    fs.symlinkSync('.env', path.join(r, 'README.md'))
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'markos-digest-outside-'))
    write(outside, 'README.md', 'a file outside the folder')
    fs.symlinkSync(outside, path.join(r, 'docs'))
    execFileSync('git', ['-C', r, 'init', '-q'], { stdio: 'ignore' })
    execFileSync('git', ['-C', r, 'add', '-f', 'README.md', 'docs'], { stdio: 'ignore' })
    const text = await repoDigest([r])
    expect(text).toContain('README.md') // listed by name, never read
    expect(text).not.toContain('sk-live-never')
    expect(text).not.toContain('outside the folder')
    // And in a folder that isn't a repository.
    const plainLinks = fs.mkdtempSync(path.join(os.tmpdir(), 'markos-digest-plainlink-'))
    write(plainLinks, '.env', 'API_KEY=sk-live-never')
    fs.symlinkSync('.env', path.join(plainLinks, 'README.md'))
    fs.symlinkSync(outside, path.join(plainLinks, 'docs'))
    const plainText = await repoDigest([plainLinks])
    expect(plainText).not.toContain('sk-live-never')
    expect(plainText).not.toContain('outside the folder')
    for (const d of [r, outside, plainLinks]) fs.rmSync(d, { recursive: true, force: true })
  })

  // A product folder reached through a link belongs to the repository the link leads into.
  it.skipIf(process.platform === 'win32')('reads nothing git ignores when the product folder is a link into a repository', async () => {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), 'markos-digest-linked-repo-'))
    write(r, '.gitignore', 'TODO.md\nprivate/\n')
    write(r, 'apps/app/README.md', 'the linked app readme')
    write(r, 'apps/app/TODO.md', 'private plan: never in the digest')
    write(r, 'apps/app/private/notes.ts', 'never listed')
    execFileSync('git', ['-C', r, 'init', '-q'], { stdio: 'ignore' })
    const holder = fs.mkdtempSync(path.join(os.tmpdir(), 'markos-digest-holder-'))
    const link = path.join(holder, 'app')
    fs.symlinkSync(path.join(r, 'apps/app'), link)
    const text = await repoDigest([link])
    expect(text).toContain('the linked app readme')
    expect(text).not.toContain('private plan')
    expect(text).not.toContain('TODO.md')
    expect(text).not.toContain('notes.ts')
    for (const d of [r, holder]) fs.rmSync(d, { recursive: true, force: true })
  })

  it.skipIf(process.platform === 'win32')('reads a plain folder normally when the link to it sits inside a repository', async () => {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), 'markos-digest-link-host-'))
    write(r, '.gitignore', 'TODO.md\n')
    execFileSync('git', ['-C', r, 'init', '-q'], { stdio: 'ignore' })
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'markos-digest-linked-plain-'))
    write(folder, 'README.md', 'the plain folder readme')
    write(folder, 'src/index.ts', 'code')
    fs.symlinkSync(folder, path.join(r, 'linked'))
    const text = await repoDigest([path.join(r, 'linked')])
    expect(text).toContain('the plain folder readme')
    expect(text).toContain('src/index.ts')
    expect(text).not.toContain('git wouldn’t run')
    for (const d of [r, folder]) fs.rmSync(d, { recursive: true, force: true })
  })

  it('reads nothing, and says so, when git won’t run in a repository', async () => {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), 'markos-digest-nogit-'))
    write(r, 'README.md', 'readme that must not be read')
    write(r, 'TODO.md', 'ignored plan')
    write(r, '.gitignore', 'TODO.md\n')
    execFileSync('git', ['-C', r, 'init', '-q'], { stdio: 'ignore' })
    const saved = process.env.PATH
    process.env.PATH = '' // no git to be found
    try {
      const text = await repoDigest([r])
      expect(text).toMatch(/read nothing here/)
      expect(text).not.toContain('readme that must not be read')
      expect(text).not.toContain('ignored plan')
    } finally {
      process.env.PATH = saved
      fs.rmSync(r, { recursive: true, force: true })
    }
  })

  it('finds docs/README.md in a big folder that isn’t a repository', async () => {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), 'markos-digest-big-'))
    for (let i = 0; i < 900; i++) write(r, `aaa/f${i}.txt`, '')
    write(r, 'docs/README.md', 'the docs readme')
    const text = await repoDigest([r])
    expect(text).toContain('the docs readme')
    fs.rmSync(r, { recursive: true, force: true })
  })

  it('reads the README once, whatever its case', async () => {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), 'markos-digest-case-'))
    write(r, 'Readme.md', 'mixed-case readme')
    const text = await repoDigest([r])
    expect(text.split('mixed-case readme').length - 1).toBe(1)
    fs.rmSync(r, { recursive: true, force: true })
  })

  it('says plainly what the AI can and can’t see', async () => {
    expect(await repoDigestBlock([])).toBe('')
    expect(await repoDigestBlock([plain])).toMatch(/you cannot open other files/)
  })

  it('knows a secret file by its name', () => {
    for (const f of ['.env', '.env.production', 'server.pem', 'tls.key', 'id_rsa', 'id_rsa.pub', 'id_ecdsa', 'id_dsa', 'deploy/id_ed25519_sk',
      '.ssh/config', 'home/.ssh/known_hosts', 'secrets.yaml', 'aws-credentials', 'credentials.json']) {
      expect(isSecretFile(f)).toBe(true)
    }
    for (const f of ['README.md', 'keyboard.ts', 'secretary.md', 'src/index.ts']) expect(isSecretFile(f)).toBe(false)
  })
})

describe('public page text', () => {
  it('keeps the words and drops the markup and scripts', () => {
    const text = htmlToText(`<html><head><title>Acme &amp; Co</title><meta name="description" content="Invoices, simply."><style>p{}</style></head>
      <body><script>track()</script><h1>Get paid</h1><p>Send invoices in&nbsp;seconds &#8212; free.</p></body></html>`)
    expect(text).toContain('Title: Acme & Co')
    expect(text).toContain('Description: Invoices, simply.')
    expect(text).toContain('Get paid')
    expect(text).toContain('Send invoices in seconds — free.')
    expect(text).not.toContain('track()')
    expect(text).not.toContain('p{}')
  })
})
