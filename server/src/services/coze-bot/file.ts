// ============================================================
// Coze 文件 API 模块
// 上传文件 + 查看文件详情
// ============================================================
import { CozeHttpClient } from './client.js';
import type { CozeResponse, FileData } from './types.js';
import fs from 'fs';
import path from 'path';

/** 扩展名到 MIME 映射 */
const mimeMap: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.mp4': 'video/mp4',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.zip': 'application/zip',
  '.rar': 'application/vnd.rar',
};

export class FileAPI {
  constructor(private client: CozeHttpClient) {}

  /**
   * 上传文件到 Coze
   * POST /v1/files/upload (multipart/form-data)
   *
   * @param filePath 本地文件路径
   * @param fileName 文件名（可选，默认取 basename）
   * @returns file_id
   */
  async upload(filePath: string, fileName?: string): Promise<FileData> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`文件不存在: ${filePath}`);
    }

    const fileBuffer = fs.readFileSync(filePath);
    const name = fileName || path.basename(filePath);
    const ext = path.extname(name).toLowerCase();
    const mimeType = mimeMap[ext] || 'application/octet-stream';

    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: mimeType });
    formData.append('file', blob, name);

    const res = await this.client.upload<CozeResponse<FileData>>(
      '/v1/files/upload',
      formData
    );
    return res.data!;
  }

  /**
   * 通过 Buffer 上传文件
   */
  async uploadBuffer(
    buffer: Buffer,
    fileName: string
  ): Promise<FileData> {
    const ext = path.extname(fileName).toLowerCase();
    const mimeType = mimeMap[ext] || 'application/octet-stream';

    const formData = new FormData();
    const blob = new Blob([buffer], { type: mimeType });
    formData.append('file', blob, fileName);

    const res = await this.client.upload<CozeResponse<FileData>>(
      '/v1/files/upload',
      formData
    );
    return res.data!;
  }

  /**
   * 查看文件详情
   * GET /v1/files/retrieve?file_id=xxx
   */
  async retrieve(fileId: string): Promise<FileData> {
    const res = await this.client.get<CozeResponse<FileData>>(
      '/v1/files/retrieve',
      { file_id: fileId }
    );
    return res.data!;
  }
}
