/** dsh plugin forwards pnpm through the shared profile package operations. */
import { runPluginCommand } from '@deepseek-ai/dsh-plugin-manager/operations'
import { resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { join } from 'node:path'
import { checkBundle, renderCheckReport } from './plugin-check.ts'
import { INSTALL_ANCHOR } from './profile-boot.ts'

/**
 * Run `dsh plugin check`: validate the target bundle locally (no install, no
 * network, no subprocess) and print the rendered report.
 * @param target - the bundle directory to check.
 * @param json - render the report as JSON instead of text.
 * @returns the process exit code: 0 when every row is ok, 1 otherwise.
 */
export async function runPluginCheck(target: string, json: boolean): Promise<number> {
  const report = await checkBundle(target)
  process.stdout.write(renderCheckReport(report, json))
  return report.ok ? 0 : 1
}

/** Run package management for a profile.
 * @param profile Profile name.
 * @param args Pnpm arguments relative to the invoking directory.
 * @returns Pnpm exit code.
 */
export async function runPlugin(profile: string, args: readonly string[]): Promise<number> {
  const result = await runPluginCommand({ profile, installAnchor: INSTALL_ANCHOR, cwd: process.cwd() }, args, {
    execution: 'cli',
    outputBytes: 16384,
    lockWaitMs: 120000,
    onOutput: (text, stream) => { process[stream].write(text) },
  })
  if (result.exitCode === 127) process.stderr.write('dsh: pnpm was not found; install pnpm and make it available on PATH.\n')
  if (result.exitCode !== 0) process.stderr.write(`dsh: pnpm failed; diagnostics: ${result.logPath}\n`)
  if (result.exitCode !== 0 && args.some(argument => /^git\+|^github:|\.git(?:#|$)/.test(argument))) {
    process.stderr.write(`dsh: git-hosted plugins build on install via their prepare script, which pnpm blocks until allowed — add the exact key pnpm printed above under allowBuilds in ${join(resolveProfileDir(profile), 'pnpm-workspace.yaml')}, then re-run\n`)
  }
  return result.exitCode
}
