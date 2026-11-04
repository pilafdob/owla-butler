import obsidianmd from 'eslint-plugin-obsidianmd';
import ts from 'typescript-eslint';

// Run every Community-specific recommended rule. TypeScript strict checking is
// a separate gate; Codex wire messages and Obsidian PDF.js have dynamic shapes.
const communityRules = Object.assign({}, ...obsidianmd.configs.recommended.map(config =>
  Object.fromEntries(Object.entries(config.rules ?? {}).filter(([name]) => name.startsWith('obsidianmd/')))));
export default [
  { ignores: ['node_modules/**', 'work/**', 'dist/**', 'main.js'] },
  {
    files: ['src/**/*.ts'],
    languageOptions: { parser: ts.parser, parserOptions: { projectService: true } },
    plugins: { obsidianmd },
    rules: {
      ...communityRules,
      'obsidianmd/ui/sentence-case': ['warn', {
        brands: ['OWLA', 'OWLA Butler', 'Codex', 'ChatGPT', 'OpenAI', 'Obsidian', 'Markdown', 'LaTeX', 'MathJax'],
        acronyms: ['PDF', 'PDFs', 'OCR', 'YAML', 'API', 'MB', 'PNG', 'JPEG', 'WebP']
      }]
    }
  }
];
