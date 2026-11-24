import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** 同目录临时文件 + rename：进程中断时不会留下半截 JSON / YAML。 */
export function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* 临时文件可能还没创建 */ }
    throw e;
  }
}
