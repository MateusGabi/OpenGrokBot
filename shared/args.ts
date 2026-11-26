/** Split an editable argument string into argv, honouring single and double quotes. */
export function parseArgs(input: string): string[] {
  const out: string[] = []
  const tokens = /"([^"]*)"|'([^']*)'|(\S+)/g
  for (const match of input.matchAll(tokens)) out.push(match[1] ?? match[2] ?? match[3] ?? '')
  return out
}

/** Render argv back into an editable string, quoting arguments that contain spaces. */
export function formatArgs(args: string[]): string {
  return args.map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg)).join(' ')
}
