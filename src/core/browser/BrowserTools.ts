import { TOOL_RISK } from '../../shared/schemas/tools.js';
import type { ToolDefinition } from '../tools/ToolTypes.js';
import { fail, ok, requireString } from '../tools/ToolTypes.js';
import { ContentExtractor } from './ContentExtractor.js';

const extractor = new ContentExtractor();

export const webSearchTool: ToolDefinition = {
  name: 'web_search',
  description: 'Searches the web for a given query using DuckDuckGo HTML version.',
  risk: TOOL_RISK.web_search,
  source: 'browser',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search term or phrase'
      }
    },
    required: ['query']
  },
  title: (input) => `Search web for "${input.query}"`,
  async execute(input, ctx) {
    if (!ctx.browser) {
      return fail(this.name, 'BrowserService is not available in the context.');
    }
    const query = requireString(input, 'query', this.name);
    const available = await ctx.browser.ensureAvailable();
    if (!available) {
      return fail(this.name, 'Browser is not available. User needs to install Chromium first.');
    }

    ctx.report(`Searching for "${query}"...`);
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    
    try {
      await ctx.browser.navigate(searchUrl, 15000);
      const html = await ctx.browser.getHtml();
      
      // Simple regex-based extraction from DuckDuckGo HTML structure
      const results: Array<{ title: string; snippet: string; url: string }> = [];
      const resultRegex = /<a class="result__url" href="([^"]+)".*?>(.*?)<\/a>.*?<a class="result__snippet[^>]*>(.*?)<\/a>/gis;
      let match;
      while ((match = resultRegex.exec(html)) !== null && results.length < 10) {
        let url = match[1];
        if (url.startsWith('//duckduckgo.com/l/?uddg=')) {
          url = decodeURIComponent(url.split('uddg=')[1].split('&')[0]);
        }
        const snippet = match[3].replace(/<[^>]+>/g, '').trim();
        const title = match[2].replace(/<[^>]+>/g, '').trim();
        results.push({ title, snippet, url });
      }

      if (results.length === 0) {
        return ok(this.name, `No results found for "${query}".`);
      }
      
      const formatted = results.map((r, i) => `${i + 1}. **[${r.title}](${r.url})**\n   ${r.snippet}`).join('\n\n');
      return ok(this.name, `Found ${results.length} results for "${query}"`, formatted);
    } catch (e) {
      return fail(this.name, `Search failed: ${(e as Error).message}`);
    }
  }
};

export const browsePageTool: ToolDefinition = {
  name: 'browse_page',
  description: 'Navigates to a URL and returns the page title and top content. Useful for quick checks.',
  risk: TOOL_RISK.browse_page,
  source: 'browser',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to navigate to'
      }
    },
    required: ['url']
  },
  title: (input) => `Browse to ${input.url}`,
  async execute(input, ctx) {
    if (!ctx.browser) {
      return fail(this.name, 'BrowserService is not available in the context.');
    }
    const url = requireString(input, 'url', this.name);
    const available = await ctx.browser.ensureAvailable();
    if (!available) {
      return fail(this.name, 'Browser is not available. User needs to install Chromium first.');
    }

    ctx.report(`Loading ${url}...`);
    try {
      await ctx.browser.navigate(url);
      const title = await ctx.browser.getTitle();
      const html = await ctx.browser.getHtml();
      
      const markdown = extractor.extractMarkdown(html);
      // Return first 1000 characters as a preview
      const preview = markdown.slice(0, 1000) + (markdown.length > 1000 ? '...\n[Content truncated]' : '');
      
      return ok(this.name, `Loaded ${url}`, `# ${title}\n\n${preview}`);
    } catch (e) {
      return fail(this.name, `Navigation failed: ${(e as Error).message}`);
    }
  }
};

export const extractContentTool: ToolDefinition = {
  name: 'extract_content',
  description: 'Navigates to a URL and extracts the full readable content as clean Markdown.',
  risk: TOOL_RISK.extract_content,
  source: 'browser',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to extract content from'
      }
    },
    required: ['url']
  },
  title: (input) => `Extract content from ${input.url}`,
  async execute(input, ctx) {
    if (!ctx.browser) {
      return fail(this.name, 'BrowserService is not available in the context.');
    }
    const url = requireString(input, 'url', this.name);
    const available = await ctx.browser.ensureAvailable();
    if (!available) {
      return fail(this.name, 'Browser is not available. User needs to install Chromium first.');
    }

    ctx.report(`Extracting from ${url}...`);
    try {
      await ctx.browser.navigate(url);
      const title = await ctx.browser.getTitle();
      const html = await ctx.browser.getHtml();
      
      const markdown = extractor.extractMarkdown(html);
      
      return ok(this.name, `Extracted ${url}`, `# ${title}\n\n${markdown}`);
    } catch (e) {
      return fail(this.name, `Extraction failed: ${(e as Error).message}`);
    }
  }
};
