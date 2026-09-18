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
import { applyPatchTool, createFileTool, deleteFileTool, writeFileTool } from './writeTools.js';
import { runCommandTool } from './commandTools.js';

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
  openFileTool,
  openDiffTool,
  applyPatchTool,
  writeFileTool,
  createFileTool,
  deleteFileTool,
  runCommandTool,
  askUserTool
];
