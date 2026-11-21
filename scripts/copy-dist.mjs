import fs from 'node:fs';
import path from 'node:path';

/**
 * 清理单文件 HTML 中的 crossorigin 属性，并复制为中文文件名供直接上传网盘。
 */
const distDir = path.resolve(process.cwd(), 'dist');
const indexHtmlPath = path.join(distDir, 'index.html');
const namedHtmlPath = path.join(distDir, '备考复盘本.html');

if (!fs.existsSync(indexHtmlPath)) {
  console.error(`未找到构建产物: ${indexHtmlPath}`);
  process.exit(1);
}

const rawHtml = fs.readFileSync(indexHtmlPath, 'utf8');
// 移除 crossorigin 属性，避免部分手机浏览器或 file:// 协议下触发无意义的 CORS 限制
const cleanedHtml = rawHtml.replace(/\s+crossorigin(?:="[^"]*")?/gi, '');

if (cleanedHtml !== rawHtml) {
  fs.writeFileSync(indexHtmlPath, cleanedHtml, 'utf8');
}

fs.copyFileSync(indexHtmlPath, namedHtmlPath);
console.log(`单文件构建已完成:\n- ${indexHtmlPath}\n- ${namedHtmlPath}`);
