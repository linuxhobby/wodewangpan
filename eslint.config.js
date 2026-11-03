import globals from 'globals';

/**
 * 扁平配置（ESLint v9）。
 * 目标：在 CI 里拦住「引入即死」的代码——未定义变量、重复声明、重复 import、
 * 以及未被使用的变量/参数（死代码）。规则以 warn 起步，现有代码不阻断 CI，
 * 但每次提交都会在 CI 日志里把死代码亮出来，形成「只减不增」的约束。
 */
export default [
  {
    files: ['scripts/**/*.js', 'theme/assets/**/*.js', 'tools/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // 死代码：CI 硬性拦截——任何新提交只要引入未使用变量/参数，流水线直接失败
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // 真错误：未定义引用 / 重复声明 / 重复 import / 不可达代码
      'no-undef': 'error',
      'no-redeclare': 'error',
      'no-duplicate-imports': 'error',
      'no-unreachable': 'error',
    },
  },
];
