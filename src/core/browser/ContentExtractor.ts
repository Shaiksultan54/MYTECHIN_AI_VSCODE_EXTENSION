import TurndownService from 'turndown';

export class ContentExtractor {
  private readonly turndown: TurndownService;

  constructor() {
    this.turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-'
    });

    // Strip out unnecessary tags that just clutter the markdown
    this.turndown.remove([
      'script',
      'style',
      'noscript',
      'iframe',
      'nav',
      'footer',
      'header',
      'aside'
    ]);
  }

  /**
   * Converts HTML to clean Markdown, stripping noise.
   */
  extractMarkdown(html: string): string {
    try {
      // Very basic pre-cleaning for standard noisy attributes (classes, ids)
      // Turndown handles HTML well, but removing large inline SVG or base64 images is helpful.
      const cleanedHtml = html.replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '')
                              .replace(/data:image\/[^;]+;base64,[a-zA-Z0-9+/=]+/gi, '');
      
      return this.turndown.turndown(cleanedHtml);
    } catch (e) {
      return `Failed to extract content: ${(e as Error).message}`;
    }
  }
}
