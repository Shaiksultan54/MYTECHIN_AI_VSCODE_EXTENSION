export const EXTENSION_ID = 'mytechin';
export const EXTENSION_NAME = 'Mytechin AI';
export const VIEW_ID = 'mytechin.chat';
export const OUTPUT_CHANNEL = 'Mytechin AI';

/** Directories that are never indexed, on top of .gitignore. */
export const DEFAULT_EXCLUDES = [
  '**/.git/**',
  '**/node_modules/**',
  '**/bower_components/**',
  '**/vendor/**',
  '**/bin/**',
  '**/obj/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/target/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/.angular/**',
  '**/.svelte-kit/**',
  '**/coverage/**',
  '**/__pycache__/**',
  '**/.venv/**',
  '**/venv/**',
  '**/.mypy_cache/**',
  '**/.pytest_cache/**',
  '**/.gradle/**',
  '**/.idea/**',
  '**/.vs/**',
  '**/*.min.js',
  '**/*.map',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml'
];

/**
 * Files that are never indexed or auto-included. The user can still attach one
 * explicitly, which triggers a warning before it reaches a cloud provider.
 */
export const SENSITIVE_PATTERNS = [
  /(^|\/)\.env($|\..*)/i,
  /(^|\/)secrets?\.[^/]*$/i,
  /(^|\/)credentials?\.[^/]*$/i,
  /\.(pem|key|pfx|p12|jks|keystore|ppk)$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.pypirc$/i,
  /(^|\/)\.aws\//i
];

/** Lightweight project markers read during workspace discovery. */
export const PROJECT_MARKERS = [
  'package.json',
  'tsconfig.json',
  'angular.json',
  'nx.json',
  'next.config.js',
  'vite.config.ts',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'requirements.txt',
  'pyproject.toml',
  'setup.py',
  'Pipfile',
  'go.mod',
  'Cargo.toml',
  'composer.json',
  'Gemfile',
  'Makefile',
  'CMakeLists.txt',
  'Dockerfile',
  'docker-compose.yml',
  'README.md'
];

export const MARKER_GLOBS = ['**/*.csproj', '**/*.sln', '**/*.fsproj', '**/*.vbproj'];

export const MAX_ATTACHMENT_BYTES = 1024 * 1024;
export const MAX_TOOL_OUTPUT_CHARS_IN_UI = 4000;
export const MAX_TOOL_OUTPUT_CHARS_TO_MODEL = 24000;

/** The @mentions that do not need a path argument. */
export const SPECIAL_MENTIONS: { label: string; detail: string }[] = [
  { label: '@workspace', detail: 'Project map: languages, frameworks, source roots' },
  { label: '@currentFile', detail: 'The file open in the active editor' },
  { label: '@selection', detail: 'The code you have selected' },
  { label: '@problems', detail: 'Errors and warnings from the Problems panel' },
  { label: '@terminal', detail: 'Output of the last command the agent ran' },
  { label: '@file', detail: 'A file by path or name' },
  { label: '@folder', detail: 'Every indexed file under a folder' }
];

/** Slash commands expanded in the composer into a structured agent intent. */
export const SLASH_COMMANDS: { command: string; detail: string; expand: (rest: string) => string }[] =
  [
    {
      command: '/explain',
      detail: 'Explain code',
      expand: (rest) => `Explain the following, in depth but without restating the obvious. ${rest}`
    },
    {
      command: '/fix',
      detail: 'Fix an error',
      expand: (rest) =>
        `Find and fix the problem. Inspect the relevant code before proposing a change. ${rest}`
    },
    {
      command: '/review',
      detail: 'Review code',
      expand: (rest) =>
        `Review this code for correctness, edge cases, security and clarity. List concrete findings. ${rest}`
    },
    {
      command: '/test',
      detail: 'Generate tests',
      expand: (rest) =>
        `Write tests. Match the test framework and conventions already used in this project. ${rest}`
    },
    {
      command: '/refactor',
      detail: 'Refactor code',
      expand: (rest) =>
        `Refactor this while preserving behaviour. Explain each change before applying it. ${rest}`
    },
    {
      command: '/document',
      detail: 'Add documentation',
      expand: (rest) =>
        `Document this in the style already used in the project. Do not add noise comments. ${rest}`
    },
    {
      command: '/search',
      detail: 'Search the repository',
      expand: (rest) => `Search the repository and report where this appears. ${rest}`
    }
  ];
