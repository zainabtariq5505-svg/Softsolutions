export default [
  { ignores: ['dist/**','public/**','**/*-text.js'] },
  {
    files: ['**/*.js','**/*.mjs'],
    rules: {
      'no-dupe-args':'error','no-dupe-keys':'error','no-duplicate-case':'error',
      'no-unreachable':'error','no-unsafe-finally':'error','valid-typeof':'error'
    }
  }
];
