import obsidianmd from 'eslint-plugin-obsidianmd';
import ts from 'typescript-eslint';

// Run the Community-specific rules and the source safety checks reported by
// the directory scanner. TypeScript strict checking runs separately.
const communityRules = Object.assign({}, ...obsidianmd.configs.recommended.map(config =>
  Object.fromEntries(Object.entries(config.rules ?? {}).filter(([name]) => name.startsWith('obsidianmd/')))));
export default [
  { ignores: ['node_modules/**', 'work/**', 'dist/**', 'main.js'] },
  {
    files: ['src/**/*.ts'],
    languageOptions: { parser: ts.parser, parserOptions: { projectService: true } },
    plugins: { obsidianmd, '@typescript-eslint': ts.plugin },
    rules: {
      ...communityRules,
      'no-empty': 'error',
      'no-control-regex': 'error',
      'no-useless-escape': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/prefer-promise-reject-errors': 'error',
      '@typescript-eslint/no-require-imports': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unused-vars': 'error',
      'obsidianmd/ui/sentence-case': ['warn', {
        brands: ['OWLA', 'OWLA Butler', 'Codex', 'ChatGPT', 'OpenAI', 'OpenCode', 'Claude', 'Claude Code', 'Obsidian', 'Markdown', 'LaTeX', 'MathJax'],
        acronyms: ['PDF', 'PDFs', 'OCR', 'YAML', 'API', 'MB', 'PNG', 'JPEG', 'WebP']
      }]
    }
  }
];
