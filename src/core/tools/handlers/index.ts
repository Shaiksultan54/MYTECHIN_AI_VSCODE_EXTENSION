import type { ToolDefinition } from '../ToolTypes.js';
import { getFileMetadataTool, listDirectoryTool, readFileTool, readFilesTool } from './readTools.js';
import { openDiffTool, openFileTool, searchCodeTool } from './searchTools.js';
import {
  askUserTool,
  getCurrentFileTool,
  getProblemsTool,
  getSelectionTool,
  getTerminalOutputTool
} from './editorTools.js';
import { applyPatchTool, createFileTool, deleteFileTool, writeFileTool, multiApplyPatchTool } from './writeTools.js';
import { runCommandTool } from './commandTools.js';
import { getImpactTool } from './graphTools.js';
import { gitBranchTool, gitCommitTool, gitDiffTool, gitLogTool, gitStatusTool } from './gitTools.js';
import { webSearchTool, browsePageTool, extractContentTool } from '../../browser/BrowserTools.js';
import {
  getDocumentSymbolsTool,
  getWorkspaceSymbolsTool,
  getDefinitionTool,
  getReferencesTool,
  getHoverTool
  ,findDefinitionTool
  ,findReferencesTool
  ,workspaceSymbolsTool
  ,documentSymbolsTool
} from './lspTools.js';

export const ALL_TOOLS: ToolDefinition[] = [
  readFileTool,
  readFilesTool,
  searchCodeTool,
  listDirectoryTool,
  getFileMetadataTool,
  getCurrentFileTool,
  getSelectionTool,
  getProblemsTool,
  getTerminalOutputTool,
  getDocumentSymbolsTool,
  getWorkspaceSymbolsTool,
  getDefinitionTool,
  getReferencesTool,
  getHoverTool,
  findDefinitionTool,
  findReferencesTool,
  workspaceSymbolsTool,
  documentSymbolsTool,
  getImpactTool,
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  gitCommitTool,
  gitBranchTool,
  openFileTool,
  openDiffTool,
  applyPatchTool,
  multiApplyPatchTool,
  writeFileTool,
  createFileTool,
  deleteFileTool,
  runCommandTool,
  askUserTool,
  webSearchTool,
  browsePageTool,
  extractContentTool
];
