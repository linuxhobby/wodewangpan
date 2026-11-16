import fs from 'node:fs';
import path from 'node:path';
import { prune } from './buildfs.js';

export function patchAppCardVersion(outDir, assetVersion) {
  const appFile = path.join(outDir, 'assets', 'app.js');
  try {
    const src = fs.readFileSync(appFile, 'utf8');
    const patched = src.replace(/from\s+(['"])\.\/card\.js(\?[^'"]*)?\1/g, `from './card.js?v=${assetVersion}'`);
    if (patched === src) {
      console.log('  ! app.js 里没找到可识别的 ./card.js import，卡片模板改版后可能不会破缓存');
    }
    fs.writeFileSync(appFile, patched);
  } catch (e) {
    console.log(`  ! 未能为 app.js 打卡片模块版本号：${e.message}`);
  }
}

function copyStaticFileIfExists(staticDir, outDir, name, { missingLog, okLog }) {
  const src = path.join(staticDir, name);
  const dest = path.join(outDir, name);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    if (okLog) console.log(okLog);
  } else if (missingLog) {
    console.log(missingLog);
  }
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) copyDirRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

export function copyExtraStaticFiles({ staticDir, outDir, write }) {
  copyStaticFileIfExists(staticDir, outDir, 'qq-group.png', {
    missingLog: '  ! 未找到 static/qq-group.png，关于本站页将不显示 QQ 群二维码',
  });
  copyStaticFileIfExists(staticDir, outDir, 'quark-group.png', {
    missingLog: '  ! 未找到 static/quark-group.png，关于本站 / 联系我们页将不显示夸克网盘群二维码',
  });
  copyStaticFileIfExists(staticDir, outDir, 'indexnow-key.txt', {
    okLog: '  · 已复制 IndexNow key 文件',
    missingLog: '  ! 未找到 static/indexnow-key.txt，IndexNow 推送所需的验证文件缺失',
  });
  const adsSrc = path.join(staticDir, 'ads.txt');
  if (fs.existsSync(adsSrc)) {
    write(path.join(outDir, 'ads.txt'), fs.readFileSync(adsSrc, 'utf8'));
    console.log('  · 已生成 ads.txt');
  } else {
    console.log('  ! 未找到 static/ads.txt，AdSense 的 ads.txt 验证与程序化广告将失效');
  }
  const promoSrc = path.join(staticDir, 'promo');
  if (fs.existsSync(promoSrc)) {
    copyDirRecursive(promoSrc, path.join(outDir, 'promo'));
    console.log('  · 已复制联盟推广素材 static/promo -> public/promo');
  } else {
    console.log('  ! 未找到 static/promo，推广位图片将 404（站点的 promo.enabled 应设为 false）');
  }
}

export function pruneOldOgVersions(outDir, ogVersion) {
  const ogRoot = path.join(outDir, 'og');
  const { removed: staleOg } = prune(ogRoot, (name) => name === ogVersion);
  if (staleOg) console.log(`  · 已清理 ${staleOg} 个旧 OG 版本目录（保留 og/${ogVersion}/）`);
}
