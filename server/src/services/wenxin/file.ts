// ============================================================
// 文心智能体 API — 文件/多模态模块
//
// 文心 API 没有独立的文件上传端点。多模态消息中的图片通过
// 可访问的 URL（http/https/data:）引用。本模块负责：
// - 构建多模态消息体
// - 本地文件 → 可访问 URL（base64 data URL 或服务端 URL）
// ============================================================
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import type { MessageContent, MultimodalValue } from './types.js';
import { wenxinMimeTypeMap } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 服务端 listening 端口 */
const SERVER_PORT = process.env.PORT || '3001';
/** 服务端基础 URL（供文心 API 回访图片，可被 WENXIN_SERVER_URL 覆盖） */
const SERVER_BASE_URL = process.env.WENXIN_SERVER_URL || `http://127.0.0.1:${SERVER_PORT}`;

/** 扩展名 → MIME */
const mimeMap: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
};

/** 本地文件 URL → 绝对路径 */
function resolveLocalPath(fileUrl: string): string {
  const relativePath = fileUrl.startsWith('/') ? fileUrl.slice(1) : fileUrl;
  if (process.env.CLASSNODE_DATA_DIR) {
    return path.join(process.env.CLASSNODE_DATA_DIR, relativePath);
  }
  return path.join(__dirname, '../../..', relativePath);
}

/** 判断文件 URL 是否为本地路径 */
function isLocalFileUrl(url: string): boolean {
  return url.startsWith('/');
}

/** 判断文件 URL 是否为图片 */
function isImageUrl(url: string): boolean {
  const ext = path.extname(url).toLowerCase();
  return !!wenxinMimeTypeMap[ext];
}

/** 获取文件字节大小 */
function getFileSize(filePath: string): number | undefined {
  try {
    const stat = fs.statSync(filePath);
    return stat.size;
  } catch {
    return undefined;
  }
}

/** 将本地图片文件转为 base64 data URL */
function fileToDataUrl(filePath: string): string | null {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const mime = mimeMap[ext] || 'image/png';
    const buf = fs.readFileSync(filePath);
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

export class FileAPI {
  /**
   * 将文件 URL 列表转为可在 MessageContent 中使用的信息
   * 返回 multimodal 的 value 数组片段
   *
   * 文心多模态中图片项使用 file* 前缀字段，详见文档：
   * 3.Conversation.md — message.content 参数说明
   */
  async resolveFileUrls(urls: string[]): Promise<MultimodalValue[number][]> {
    const items: MultimodalValue[number][] = [];

    for (const url of urls) {
      if (isLocalFileUrl(url)) {
        if (isImageUrl(url)) {
          const filePath = resolveLocalPath(url);
          const ext = path.extname(url).slice(1).toLowerCase() || 'png';
          const fileSize = getFileSize(filePath);

          // 优先使用 base64 data URL（开发环境无需公网地址）
          const dataUrl = fileToDataUrl(filePath);
          const imageUrl = dataUrl || `${SERVER_BASE_URL}${url}`;

          items.push({
            type: 'image',
            value: {
              fileId: `file-${crypto.randomUUID().slice(0, 8)}`,
              fileUrl: imageUrl,
              fileName: path.basename(url),
              fileType: ext,
              ...(fileSize !== undefined ? { fileSize } : {}),
            },
          });
        } else {
          // 非图片文件：文心不支持文件上传，跳过
          console.warn(`[WenxinFile] 非图片文件暂不支持: ${url}`);
        }
      } else if (url.startsWith('http://') || url.startsWith('https://')) {
        // 公网 URL（多模态图片）
        if (isImageUrl(url)) {
          const ext = path.extname(url).slice(1).toLowerCase() || 'png';
          items.push({
            type: 'image',
            value: {
              fileUrl: url,
              fileName: path.basename(url),
              fileType: ext,
            },
          });
        }
      }
    }

    return items;
  }

  /**
   * 构建完整的多模态消息内容（文本 + 附件图片）
   */
  async buildMultimodalContent(text: string, fileUrls?: string[]): Promise<MessageContent> {
    if (!fileUrls || fileUrls.length === 0) {
      return { type: 'text', value: { showText: text } };
    }

    const imageItems = await this.resolveFileUrls(fileUrls);
    if (imageItems.length === 0) {
      // 没有可识别的图片附件，退回纯文本
      return { type: 'text', value: { showText: text } };
    }

    const value: MultimodalValue = [
      { type: 'text', value: { showText: text, text } },
      ...imageItems,
    ];

    return { type: 'multimodal', value };
  }
}
