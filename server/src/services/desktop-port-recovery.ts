import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

export interface ListenerProcess {
  pid: number;
  executable: string;
  commandLine: string;
  started: string;
  owner: string;
  ports: number[];
  cwd?: string;
}
export interface RecoveryContext {
  platform: string;
  nodePath: string;
  serverDir: string;
  owner: string;
  dedicatedRuntime: boolean;
}

/** Decode Windows argument quoting, rejecting malformed input rather than guessing. */
export function windowsArgs(command: string): string[] | null {
  if (/[\0\r\n]/.test(command)) return null;
  const args: string[] = [];
  let i = 0;
  while (i < command.length) {
    while (/[ \t]/.test(command[i] ?? '') && i < command.length) i++;
    if (i === command.length) break;
    let value = '', quoted = false;
    while (i < command.length && (quoted || !/[ \t]/.test(command[i]))) {
      let slashes = 0;
      while (command[i] === '\\') { slashes++; i++; }
      if (command[i] === '"') {
        value += '\\'.repeat(Math.floor(slashes / 2));
        if (slashes % 2) { value += '"'; i++; }
        else if (quoted && command[i + 1] === '"') { value += '"'; i += 2; }
        else { quoted = !quoted; i++; }
      } else {
        value += '\\'.repeat(slashes);
        if (i < command.length && (quoted || !/[ \t]/.test(command[i]))) value += command[i++];
      }
    }
    if (quoted) return null;
    args.push(value);
  }
  return args;
}

function normalized(value: string, platform: string): string {
  return platform === 'win32' ? path.win32.normalize(value.replace(/^\\\\\?\\/, '')).toLowerCase() : path.posix.normalize(value);
}

/** Never classify by node.exe, a PID, a port, or an HTTP response alone. */
export function isOwnedListener(process: ListenerProcess, context: RecoveryContext): boolean {
  if (!context.dedicatedRuntime || !context.owner || process.owner !== context.owner || !process.started ||
      !Number.isSafeInteger(process.pid) || process.pid <= 0 || !process.ports.some(port => port === 3001 || port === 3002)) return false;
  const clean = (value: string) => normalized(value, context.platform);
  if (clean(process.executable) !== clean(context.nodePath)) return false;
  const expected = context.platform === 'win32' ? path.win32.join(context.serverDir, 'dist', 'index.js') : path.posix.join(context.serverDir, 'dist', 'index.js');
  if (context.platform === 'win32') {
    const args = windowsArgs(process.commandLine);
    return args?.length === 2 && clean(args[0]) === clean(context.nodePath) &&
      [clean(expected), clean('dist/index.js'), clean('./dist/index.js')].includes(clean(args[1]));
  }
  if (process.cwd !== context.serverDir) return false;
  return [`${context.nodePath} dist/index.js`, `${context.nodePath} ./dist/index.js`, `${context.nodePath} ${expected}`].includes(process.commandLine);
}

export function sameListener(a: ListenerProcess, b: ListenerProcess | null): boolean {
  return b !== null && a.pid === b.pid && a.started === b.started && a.owner === b.owner &&
    a.executable === b.executable && a.commandLine === b.commandLine && a.cwd === b.cwd &&
    a.ports.some(port => b.ports.includes(port));
}

// Querying CIM provides the real executable path and user identity, not just the image name.
const WINDOWS_QUERY = String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$current=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$rows=@()
$connections=@(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -in @(3001,3002) })
foreach($targetId in @($connections.OwningProcess | Sort-Object -Unique)) {
  try {
    $item=Get-CimInstance Win32_Process -Filter "ProcessId = $targetId"
    $native=[System.Diagnostics.Process]::GetProcessById([int]$targetId)
    try {
      $sid=(Invoke-CimMethod -InputObject $item -MethodName GetOwnerSid).Sid
      $rows+=@{pid=[int]$targetId;executable=[string]$item.ExecutablePath;commandLine=[string]$item.CommandLine;started=[string]$native.StartTime.ToUniversalTime().Ticks;owner=[string]$sid;ports=@($connections | Where-Object { $_.OwningProcess -eq $targetId } | Select-Object -ExpandProperty LocalPort -Unique)}
    } finally { $native.Dispose() }
  } catch { $rows+=@{pid=[int]$targetId;executable='';commandLine='';started='';owner='';ports=@($connections | Where-Object { $_.OwningProcess -eq $targetId } | Select-Object -ExpandProperty LocalPort -Unique)} }
}
@{owner=$current;processes=@($rows)} | ConvertTo-Json -Depth 5 -Compress
`;

const WINDOWS_STOP = String.raw`
$ErrorActionPreference='Stop'
$expected=$env:CLASSNODE_RECOVERY_PROCESS | ConvertFrom-Json
$targetId=[int]$expected.pid
$native=[System.Diagnostics.Process]::GetProcessById($targetId)
try {
  $null=$native.Handle
  if ([string]$native.StartTime.ToUniversalTime().Ticks -ne [string]$expected.started) { throw '进程已变化，取消回收' }
  $item=Get-CimInstance Win32_Process -Filter "ProcessId = $targetId"
  $sid=(Invoke-CimMethod -InputObject $item -MethodName GetOwnerSid).Sid
  $current=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  if ($sid -ne $current -or $sid -ne $expected.owner -or $item.ExecutablePath -cne $expected.executable -or $item.CommandLine -cne $expected.commandLine) { throw '进程身份已变化，取消回收' }
  $listeners=@(Get-NetTCPConnection -State Listen | Where-Object { $_.OwningProcess -eq $targetId -and $_.LocalPort -in @($expected.ports) })
  if ($listeners.Count -eq 0) { throw '进程已不占用目标端口，取消回收' }
  $native.Kill()
  if (-not $native.WaitForExit(5000)) { throw '等待旧服务退出超时' }
} finally { $native.Dispose() }
`;

function powershell(script: string, expected?: ListenerProcess): string {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024, windowsHide: true,
    env: { ...process.env, ...(expected ? { CLASSNODE_RECOVERY_PROCESS: JSON.stringify(expected) } : {}) },
  }).replace(/^\uFEFF/, '');
}

function macListeners(): { owner: string; processes: ListenerProcess[] } {
  const pids = new Map<number, number[]>();
  for (const port of [3001, 3002]) {
    let output: string;
    try { output = execFileSync('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], {encoding:'utf8', timeout:5000}); }
    catch (error) {
      const result = error as { status?: number; stdout?: string; stderr?: string };
      if (result.status === 1 && !result.stdout && !result.stderr) continue;
      throw error;
    }
    for (const line of output.split('\n')) if (/^p\d+$/.test(line)) {
      const pid = Number(line.slice(1)); pids.set(pid, [...(pids.get(pid) ?? []), port]);
    }
  }
  const processes = [...pids].map(([pid, ports]) => {
    try {
      const info = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'uid=', '-o', 'lstart=', '-o', 'command='], {encoding:'utf8', timeout:5000}).trim();
      const match = /^(\d+)\s+(\S+\s+\S+\s+\d+\s+[\d:]+\s+\d+)\s+(.+)$/.exec(info);
      const files = execFileSync('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'txt,cwd', '-Fn'], {encoding:'utf8', timeout:5000});
      let kind = '', executable = '', cwd = '';
      for (const line of files.split('\n')) {
        if (line.startsWith('f')) kind = line.slice(1);
        if (line.startsWith('n') && kind === 'cwd') cwd = line.slice(1);
        if (line.startsWith('n') && kind === 'txt' && !executable) executable = line.slice(1);
      }
      return {pid, ports, executable, cwd, owner:match?.[1] ?? '', started:match?.[2] ?? '', commandLine:match?.[3] ?? ''};
    } catch { return {pid, ports, executable:'', commandLine:'', started:'', owner:''}; }
  });
  return { owner:String(process.getuid?.() ?? ''), processes };
}

export interface RecoveryAdapter {
  inspect(): {owner:string; processes:ListenerProcess[]};
  stop(candidate: ListenerProcess): Promise<void>;
}
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export function nativeRecoveryAdapter(platform: string): RecoveryAdapter {
  if (!['win32', 'darwin'].includes(platform)) throw new Error('不支持此系统的旧服务回收');
  const inspect = () => platform === 'win32' ? JSON.parse(powershell(WINDOWS_QUERY)) as ReturnType<RecoveryAdapter['inspect']> : macListeners();
  return {
    inspect,
    async stop(candidate) {
      const latest = inspect().processes.find(row => row.pid === candidate.pid) ?? null;
      if (!sameListener(candidate, latest)) throw new Error('占用进程已变化，未结束该进程');
      if (platform === 'win32') { powershell(WINDOWS_STOP, candidate); return; }
      process.kill(candidate.pid, 'SIGTERM');
      for (let i = 0; i < 20; i++) {
        await delay(100);
        const current = inspect().processes.find(row => row.pid === candidate.pid) ?? null;
        if (!current) return;
        if (!sameListener(candidate, current)) throw new Error('进程身份变化，取消强制回收');
      }
      if (!sameListener(candidate, inspect().processes.find(row => row.pid === candidate.pid) ?? null)) throw new Error('进程身份变化，取消强制回收');
      process.kill(candidate.pid, 'SIGKILL');
      await delay(200);
    },
  };
}

export async function recoverDesktopPorts(context: Omit<RecoveryContext,'owner'>, adapter: RecoveryAdapter) {
  const snapshot = adapter.inspect();
  const fullContext = {...context, owner:snapshot.owner};
  const foreign = snapshot.processes.filter(row => !isOwnedListener(row, fullContext));
  const blocked = foreign.find(row => row.ports.includes(3001));
  if (blocked) return {stopped:0, blocked:`端口 3001 被${path.win32.basename(blocked.executable) || '无法确认身份的程序'}占用（PID ${blocked.pid}），未结束该进程。请关闭占用程序后重试。`};
  let stopped = 0;
  for (const candidate of snapshot.processes) {
    if (!isOwnedListener(candidate, fullContext)) continue;
    await adapter.stop(candidate);
    stopped++;
  }
  // The main port must actually be released; a replacement process is never killed.
  for (let i = 0; i < 20 && stopped; i++) {
    if (!adapter.inspect().processes.some(row => row.ports.includes(3001))) break;
    await delay(100);
  }
  if (stopped && adapter.inspect().processes.some(row => row.ports.includes(3001))) {
    return {stopped, blocked:'端口 3001 尚未释放或已被其他程序占用，请稍后重试。'};
  }
  return {stopped, blocked:null};
}

export function isDedicatedNode(nodePath: string, serverDir: string): boolean {
  try {
    const bundled = fs.realpathSync(path.join(serverDir, process.platform === 'win32' ? 'node.exe' : 'node'));
    return normalized(fs.realpathSync(nodePath), process.platform) === normalized(bundled, process.platform) &&
      normalized(path.dirname(bundled), process.platform) === normalized(fs.realpathSync(serverDir), process.platform);
  } catch { return false; }
}
