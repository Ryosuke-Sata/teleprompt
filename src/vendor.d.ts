declare module '*kuromoji.mjs' {
  const kuromoji: {
    builder(options: { dicPath: string }): { build(callback: (error: Error | null, tokenizer: { tokenize(text: string): import('./script').Token[] }) => void): void };
  };
  export default kuromoji;
}
