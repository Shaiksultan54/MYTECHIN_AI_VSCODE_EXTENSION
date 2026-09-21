import * as vscode from 'vscode';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { Logger } from '../logging/Logger.js';

export class BrowserService implements vscode.Disposable {
  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private isAvailable: boolean | undefined;

  constructor(private readonly logger: Logger) {}

  /**
   * Validates if Chromium is installed and available to Playwright.
   * If not, prompts the user to install it.
   */
  async ensureAvailable(): Promise<boolean> {
    if (this.isAvailable !== undefined) {
      return this.isAvailable;
    }

    try {
      // Test launch with no sandbox to quickly check if executable exists
      const testBrowser = await chromium.launch({ headless: true });
      await testBrowser.close();
      this.isAvailable = true;
      return true;
    } catch (e) {
      this.logger.error('BrowserService: Failed to launch browser', e);
      this.isAvailable = false;
      
      const install = await vscode.window.showInformationMessage(
        'Browser tools require Chromium to be installed. Do you want to install it now?',
        'Install'
      );
      
      if (install === 'Install') {
        const terminal = vscode.window.createTerminal('Playwright Install');
        terminal.show();
        terminal.sendText('npx playwright install chromium');
        vscode.window.showInformationMessage('Please wait for the installation to finish in the terminal, then try again.');
      }
      return false;
    }
  }

  private async getPage(): Promise<Page> {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: true });
      this.context = await this.browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 }
      });
      this.page = await this.context.newPage();
      
      // Prevent dialogs from blocking execution
      this.page.on('dialog', dialog => dialog.dismiss());
    }
    return this.page!;
  }

  /**
   * Navigates to a URL and waits for it to load.
   */
  async navigate(url: string, timeoutMs = 30000): Promise<void> {
    const page = await this.getPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  }

  /**
   * Extracts the full HTML of the current page.
   */
  async getHtml(): Promise<string> {
    const page = await this.getPage();
    return await page.content();
  }

  /**
   * Gets the page title.
   */
  async getTitle(): Promise<string> {
    const page = await this.getPage();
    return await page.title();
  }

  /**
   * Gets the current URL.
   */
  async getUrl(): Promise<string> {
    const page = await this.getPage();
    return page.url();
  }

  /**
   * Closes the browser if open.
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = undefined;
      this.context = undefined;
      this.page = undefined;
    }
  }

  dispose() {
    void this.close();
  }
}
