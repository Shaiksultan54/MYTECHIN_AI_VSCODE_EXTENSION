import * as path from 'node:path';
import { WorkspaceManager } from '../workspace/WorkspaceManager.js';
import { FileReader } from '../workspace/FileReader.js';
import { ContextAttachment } from '../../shared/types.js';

export interface VisionData {
  url: string;
}

export class VisionAdapter {
  constructor(
    private readonly workspace: WorkspaceManager,
    private readonly reader: FileReader
  ) {}

  async getImagesAsDataUrls(attachments: ContextAttachment[]): Promise<VisionData[]> {
    const images = attachments.filter(a => a.type === 'image' && a.uri);
    const results: VisionData[] = [];

    for (const img of images) {
      if (!img.uri) continue;
      
      if (img.uri.startsWith('data:')) {
        results.push({ url: img.uri });
        continue;
      }

      const resolved = this.workspace.resolve(img.relativePath || img.uri);
      
      try {
        const ext = path.extname(img.uri).toLowerCase();
        let mimeType = 'image/jpeg';
        if (ext === '.png') mimeType = 'image/png';
        else if (ext === '.gif') mimeType = 'image/gif';
        else if (ext === '.webp') mimeType = 'image/webp';
        else if (ext === '.svg') mimeType = 'image/svg+xml';
        
        const data = await this.reader.readBinary(resolved);
        const base64 = Buffer.from(data).toString('base64');
        results.push({ url: `data:${mimeType};base64,${base64}` });
      } catch (error) {
        // We log to console rather than throwing to avoid breaking the entire generation if one image is missing
        console.error(`Failed to read image ${img.uri}`, error);
      }
    }

    return results;
  }
}
