import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from 'node:child_process';
import { isOwnedListener, sameListener, windowsPowerShellArgs, windowsArgs, windowsListeners, nativeRecoveryAdapter, recoverDesktopPorts, type ListenerProcess, type RecoveryContext } from '../services/desktop-port-recovery.js';

const context: RecoveryContext = {platform:'win32', nodePath:'C:\\Program Files\\支点课堂\\server\\node.exe', serverDir:'C:\\Program Files\\支点课堂\\server', owner:'S-1-test', dedicatedRuntime:true};
const own: ListenerProcess = {pid:1234, executable:context.nodePath, commandLine:`"${context.nodePath}" dist/index.js`, started:'123456789', owner:context.owner, ports:[3001,3002]};

test('PowerShell transport preserves multiline Unicode scripts without shell quoting or stdin', () => {
  const script = '\n$label="支点课堂"\nWrite-Output \'{"path":"C:\\Program Files\\node.exe"}\'\n';
  const args = windowsPowerShellArgs(script);
  assert.deepEqual(args.slice(0, -1), ['-NoLogo', '-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand']);
  assert.equal(Buffer.from(args.at(-1)!, 'base64').toString('utf16le'), script);
  let queried = false;
  nativeRecoveryAdapter('win32', (file, actualArgs, options) => {
    if (file.endsWith('netstat.exe')) return `TCP 0.0.0.0:3001 0.0.0.0:0 LISTENING ${process.pid}`;
    queried = true;
    assert.equal(actualArgs.at(-2), '-EncodedCommand');
    assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
    assert.equal(options.timeout, 60000);
    return '{"owner":"","processes":[]}';
  }).inspect();
  assert.equal(queried, true);
});

test('Windows command parsing preserves quoted paths and rejects malformed input', () => {
  assert.deepEqual(windowsArgs('"C:\\Program Files\\node.exe" "dist/index.js"'), ['C:\\Program Files\\node.exe','dist/index.js']);
  assert.deepEqual(windowsArgs('node.exe   "a b"'), ['node.exe','a b']);
  assert.equal(windowsArgs('node.exe "unterminated'), null);
  assert.equal(windowsArgs('node.exe\nother'), null);
  assert.deepEqual(windowsArgs(String.raw`node.exe "a\"b"`), ['node.exe','a"b']);
});

test('Windows netstat parsing selects only target TCP listeners and deduplicates IPv4/IPv6', () => {
  assert.deepEqual(windowsListeners(`
活动连接
  协议  本地地址  外部地址  状态  PID
  TCP    0.0.0.0:3001    0.0.0.0:0    LISTENING    1234
  TCP    [::]:3001       [::]:0       LISTENING    1234
  TCP    127.0.0.1:3002  0.0.0.0:0    LISTENING    5678
  TCP    127.0.0.1:3001  127.0.0.1:90 ESTABLISHED  9999
  TCP    0.0.0.0:13001   0.0.0.0:0    LISTENING    9999
  UDP    0.0.0.0:3001    *:*                       9999
  TCP    0.0.0.0:3001    0.0.0.0:0    LISTENING    nope
  TCP    0.0.0.0:3001    0.0.0.0:0    LISTENING    0
`), [{ pid: 1234, port: 3001 }, { pid: 5678, port: 3002 }]);
  assert.deepEqual(windowsListeners(''), []);
});

test('Windows inspection skips PowerShell when target ports are free', () => {
  const adapter = nativeRecoveryAdapter('win32', (file, args) => {
    assert.match(file, /netstat\.exe$/);
    assert.deepEqual(args, ['-ano', '-p', 'TCP']);
    return 'TCP 0.0.0.0:8080 0.0.0.0:0 LISTENING 1111';
  });
  assert.deepEqual(adapter.inspect(), { owner: '', processes: [] });
});

test('Windows inspection sends only target listeners for identity checks and propagates query failures', async () => {
  let changed = false;
  const adapter = nativeRecoveryAdapter('win32', (file, args, options) => {
    if (file.endsWith('netstat.exe')) return 'TCP 0.0.0.0:3001 0.0.0.0:0 LISTENING 1234';
    assert.equal(file, 'powershell.exe');
    assert.equal(args.at(-2), '-EncodedCommand');
    assert.ok(!Buffer.from(args.at(-1)!, 'base64').toString('utf16le').includes('Get-NetTCPConnection'));
    assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
    assert.equal(options.timeout, 60000);
    assert.deepEqual(JSON.parse(options.env!.CLASSNODE_RECOVERY_LISTENERS!), [{ OwningProcess: 1234, LocalPort: 3001 }]);
    return JSON.stringify({ owner: context.owner, processes: [{ ...own, started: changed ? 'replacement' : own.started }] });
  });
  const snapshot = adapter.inspect();
  assert.equal(isOwnedListener(snapshot.processes[0], { ...context, owner: snapshot.owner }), true);
  changed = true;
  await assert.rejects(adapter.stop(snapshot.processes[0]), /占用进程已变化/);
  assert.throws(() => nativeRecoveryAdapter('win32', () => { throw new Error('query timeout'); }).inspect(), /query timeout/);
});

test('Windows PowerShell reads singleton and multi-port JSON arrays, including failed identity queries', { timeout: 200000 }, t => {
  if (process.platform !== 'win32') return t.skip('requires Windows PowerShell 5.1');
  // Capture the exact production query. Stub CIM only; execute its JSON/array/port handling in powershell.exe.
  let query = '';
  let queryOptions: ExecFileSyncOptionsWithStringEncoding = { encoding: 'utf8' };
  nativeRecoveryAdapter('win32', (file, args, options) => {
    if (file.endsWith('netstat.exe')) return `TCP 0.0.0.0:3001 0.0.0.0:0 LISTENING ${process.pid}`;
    query = Buffer.from(args.at(-1)!, 'base64').toString('utf16le');
    queryOptions = options;
    return JSON.stringify({ owner: '', processes: [] });
  }).inspect();
  const stub = `
function Get-CimInstance {
  if ($env:CLASSNODE_TEST_IDENTITY_FAIL -eq '1') { throw 'simulated access denied' }
  return [pscustomobject]@{ExecutablePath='test-node.exe';CommandLine='test-node.exe dist/index.js'}
}
function Invoke-CimMethod { return [pscustomobject]@{Sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value} }
`;
  for (const [ports, fail] of [[[3001], false], [[3001, 3002], false], [[3001, 3002], true]] as const) {
    const result = execFileSync('powershell.exe', windowsPowerShellArgs(stub + query), {
      ...queryOptions,
      env: { ...process.env, CLASSNODE_TEST_IDENTITY_FAIL: fail ? '1' : '0',
        CLASSNODE_RECOVERY_LISTENERS: JSON.stringify(ports.map(port => ({ LocalPort: port, OwningProcess: process.pid }))) },
    });
    const snapshot = JSON.parse(result.replace(/^\uFEFF/, '')) as { owner: string; processes: ListenerProcess[] };
    assert.equal(snapshot.processes.length, 1);
    const row = snapshot.processes[0];
    assert.equal(row.pid, process.pid);
    assert.deepEqual(row.ports, ports);
    assert.equal(row.executable, fail ? '' : 'test-node.exe');
    assert.equal(row.owner, fail ? '' : snapshot.owner);
  }
});

test('requires installed dedicated executable, exact server entry, user and process identity', () => {
  assert.equal(isOwnedListener(own,context),true);
  assert.equal(isOwnedListener({...own, commandLine:`"${context.nodePath.toUpperCase()}" "${context.serverDir}\\dist\\index.js"`},context),true);
  for (const patch of [
    {executable:'C:\\other\\node.exe'}, {owner:'other-user'}, {started:''}, {pid:0}, {ports:[8080]},
    {commandLine:`"${context.nodePath}" --eval "anything"`},
    {commandLine:`"${context.nodePath}" dist/other.js`},
    {commandLine:`"${context.nodePath}" D:\\other\\dist\\index.js`},
    {commandLine:`"${context.nodePath}" dist/index.js --extra`},
  ]) assert.equal(isOwnedListener({...own,...patch},context),false,JSON.stringify(patch));
  assert.equal(isOwnedListener(own,{...context,dedicatedRuntime:false}),false);
  assert.equal(isOwnedListener(own,{...context,owner:''}),false);
});

test('macOS requires the same executable, server working directory and entry', () => {
  const ctx = {...context,platform:'darwin',nodePath:'/Applications/ClassNode.app/server/node',serverDir:'/Applications/ClassNode.app/server'};
  const row = {...own,executable:ctx.nodePath,cwd:ctx.serverDir,commandLine:`${ctx.nodePath} dist/index.js`};
  assert.equal(isOwnedListener(row,ctx),true);
  assert.equal(isOwnedListener({...row,cwd:'/tmp/another'},ctx),false);
  assert.equal(isOwnedListener({...row,commandLine:`${ctx.nodePath} other.js`},ctx),false);
});

test('PID reuse or changed identity never matches the inspected process', () => {
  assert.equal(sameListener(own,{...own,ports:[3001]}),true);
  for (const patch of [{started:'new'}, {owner:'other'}, {executable:'other'}, {commandLine:'other'}, {ports:[8080]}]) {
    assert.equal(sameListener(own,{...own,...patch}),false);
  }
  assert.equal(sameListener(own,null),false);
});

function fixture(initial: ListenerProcess[]) {
  let rows = initial;
  const stopped: number[] = [];
  const adapter = {
    inspect: () => ({owner:context.owner,processes:rows}),
    stop: async (candidate: ListenerProcess) => { stopped.push(candidate.pid); rows=rows.filter(row=>row.pid!==candidate.pid); },
  };
  return {adapter,stopped};
}

test('one ClassNode process occupying both ports is terminated once', async () => {
  const f=fixture([own]);
  assert.deepEqual(await recoverDesktopPorts(context,f.adapter),{stopped:1,blocked:null});
  assert.deepEqual(f.stopped,[own.pid]);
});

test('foreign or unidentified main-port owner blocks recovery without terminating anyone', async () => {
  for (const executable of ['C:\\other\\node.exe','']) {
    const f=fixture([{...own,ports:[3002]}, {...own,pid:5678,ports:[3001],executable}]);
    assert.match((await recoverDesktopPorts(context,f.adapter)).blocked!,/3001/);
    assert.deepEqual(f.stopped,[]);
  }
});

test('unrelated 3002 listener is left alone while the ClassNode main server is reclaimed', async () => {
  const f=fixture([{...own,ports:[3001]}, {...own,pid:5678,ports:[3002],executable:'C:\\other.exe'}]);
  assert.deepEqual(await recoverDesktopPorts(context,f.adapter),{stopped:1,blocked:null});
  assert.deepEqual(f.stopped,[own.pid]);
});

test('inspection and termination errors propagate rather than allowing unsafe startup', async () => {
  await assert.rejects(recoverDesktopPorts(context,{inspect:()=>{throw new Error('inspection denied');},stop:async()=>{}}),/inspection denied/);
  await assert.rejects(recoverDesktopPorts(context,{inspect:()=>({owner:context.owner,processes:[own]}),stop:async()=>{throw new Error('identity changed');}}),/identity changed/);
});

test('replacement occupying the released main port is reported and never terminated', async () => {
  let rows=[own]; const stopped:number[]=[];
  const result=await recoverDesktopPorts(context,{
    inspect:()=>({owner:context.owner,processes:rows}),
    stop:async candidate=>{stopped.push(candidate.pid);rows=[{...own,pid:9999,executable:'other'}];},
  });
  assert.match(result.blocked!,/3001/);
  assert.deepEqual(stopped,[own.pid]);
});

test('native recovery identifies and stops an isolated bundled server, without accessing real application data', {timeout:process.platform === 'win32' ? 300000 : 45000}, async t => {
  if (!['darwin','win32'].includes(process.platform)) return t.skip('desktop platforms only');
  const fs=await import('node:fs/promises');
  const os=await import('node:os');
  const path=await import('node:path');
  const {spawn}=await import('node:child_process');
  const {nativeRecoveryAdapter,isDedicatedNode}=await import('../services/desktop-port-recovery.js');
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'classnode recovery 集成 ')));
  const node=path.join(root,process.platform==='win32'?'node.exe':'node');
  let child:ReturnType<typeof spawn>|undefined;
  try {
    await fs.copyFile(process.execPath,node);
    await fs.chmod(node,0o755);
    await fs.mkdir(path.join(root,'dist'));
    await fs.writeFile(path.join(root,'dist','index.js'), "const net=require('node:net'); const s=net.createServer(); s.on('error',e=>{console.error(e.code);process.exit(e.code==='EADDRINUSE'?77:1)}); s.listen(3001,'127.0.0.1',()=>console.log('READY'));");
    child=spawn(node,['dist/index.js'],{cwd:root,stdio:['ignore','pipe','pipe'],windowsHide:true});
    let stderr=''; child.stderr!.on('data', data=>{stderr+=String(data);});
    const ready=await new Promise<boolean>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('fixture startup timed out')),5000);
      child!.stdout!.once('data',()=>{clearTimeout(timer);resolve(true);});
      child!.once('error',error=>{clearTimeout(timer);reject(error);});
      child!.once('exit',code=>{clearTimeout(timer);if(code===77)resolve(false);else reject(new Error(`fixture exited ${code}: ${stderr}`));});
    });
    if (!ready) return t.skip('main port already occupied; no existing process touched');
    assert.equal(isDedicatedNode(node,root),true);
    const adapter=nativeRecoveryAdapter(process.platform);
    const snapshot=adapter.inspect();
    const row=snapshot.processes.find(p=>p.pid===child!.pid);
    assert.ok(row,'native inspection finds fixture PID');
    const ctx={platform:process.platform,nodePath:node,serverDir:root,dedicatedRuntime:true};
    assert.equal(isOwnedListener(row,{...ctx,owner:snapshot.owner}),true,JSON.stringify({row,ctx}));
    const result=await recoverDesktopPorts(ctx,adapter);
    assert.deepEqual(result,{stopped:1,blocked:null});
    assert.equal(adapter.inspect().processes.some(p=>p.pid===child!.pid),false);
  } finally {
    if (child && child.exitCode===null && child.signalCode===null) {
      const exited=new Promise<void>(resolve=>child!.once('exit',()=>resolve()));
      child.kill('SIGKILL');
      await exited;
    }
    await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
});
