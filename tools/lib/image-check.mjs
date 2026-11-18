import fs from 'node:fs';

/**
 * 图片真实类型校验（读文件头，不依赖外部 file 命令）。
 * 下载到的 HTML / 占位文本即使体积够大也不能当海报写进站点。
 */
function header(file, bytes = 16) {
  try {
    if (!fs.statSync(file).isFile()) return null;
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    fs.closeSync(fd);
    return n >= 12 ? buf : null;
  } catch {
    return null;
  }
}

/** JPEG（.jpg 海报必须是 JPEG） */
export function isJpegFile(file, minBytes = 5000) {
  try { if (fs.statSync(file).size < minBytes) return false; } catch { return false; }
  const b = header(file);
  return !!b && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

/** PNG / JPEG / WebP / GIF（用于下载中的官方图标，之后会转成 .jpg） */
export function isImageFile(file, minBytes = 3000) {
  try { if (fs.statSync(file).size < minBytes) return false; } catch { return false; }
  const b = header(file);
  if (!b) return false;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true;
  const ascii = b.subarray(0, 6).toString('ascii');
  if (ascii === 'GIF87a' || ascii === 'GIF89a') return true;
  return b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP';
}
