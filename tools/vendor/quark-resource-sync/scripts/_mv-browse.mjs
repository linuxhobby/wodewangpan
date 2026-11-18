import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { cfg } from './lib/config.mjs';
const run = promisify(execFile);
const CLI = cfg.QUARK_CLI;
const TASK = 'C:\\Users\\marco\\AppData\\Local\\Temp\\wdwp\\mv-move';
fs.mkdirSync(TASK, { recursive: true });

async function browse(parentFid) {
  const { stdout } = await run('node', [CLI, 'browse', '--parent-fid', parentFid, '--all', '--task-dir', TASK], { maxBuffer: 64e6 });
  // stdout is JSON result pointing at a JSONL file; find the newest .jsonl under TASK
  const files = [];
  (function walk(d){ for (const e of fs.readdirSync(d,{withFileTypes:true})) { const p=path.join(d,e.name); if(e.isDirectory())walk(p); else if(e.name.endsWith('.jsonl'))files.push(p);} })(TASK);
  files.sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs);
  const latest = files[0];
  const rows = fs.readFileSync(latest,'utf8').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);
  return { latest, rows, stdout };
}

const movieFid = '~1HfkzCL3HhMUKJtgOiGYWSSE4z41rww9G4Jk0c7Aa-JGxLLYIlY84ajnIX5NSLDC2KgIylEv-fLIJDD426hRqdQ|zfroHbVsjk8';
const dir = await browse(movieFid);
const hit = [];
for (const r of dir.rows) {
  const name = r.filename || r.name || r.file_name;
  if (name && /盗墓大案/.test(name)) hit.push({ name, fid: r.fid });
}
console.log('MOVIE DIR JSONL:', path.basename(dir.latest), 'rows:', dir.rows.length);
console.log('盗墓大案:', JSON.stringify(hit, null, 1));
fs.writeFileSync(path.join(TASK,'mv-fid.json'), JSON.stringify(hit));
