import fs from 'node:fs';
import path from 'node:path';

export function createWriter({ outDir, prevDir }) {
  const reused = { kept: 0, copied: 0, written: 0 };
  function write(file, content) {
    const rel = path.relative(outDir, file);
    const candidates = [file];
    if (prevDir && !rel.startsWith('..')) candidates.push(path.join(prevDir, rel));

    for (const target of candidates) {
      let old;
      try {
        old = fs.readFileSync(target, 'utf8');
      } catch {
        continue;
      }
      if (old !== content) continue;

      if (target !== file) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.copyFileSync(target, file);
        const st = fs.statSync(target);
        fs.utimesSync(file, st.atime, st.mtime);
        reused.copied++;
      } else {
        reused.kept++;
      }
      return;
    }

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    reused.written++;
  }
  return { write, reused };
}

// 清理遗留文件：keep(name) 返回 true 的保留，其余删掉。失败只计数不抛出。
export function prune(dir, keep) {
  let removed = 0;
  let failed = 0;
  if (!fs.existsSync(dir)) return { removed, failed };
  for (const name of fs.readdirSync(dir)) {
    if (keep(name)) continue;
    try {
      fs.rmSync(path.join(dir, name), { recursive: true, force: true });
      removed++;
    } catch {
      failed++;
    }
  }
  return { removed, failed };
}
